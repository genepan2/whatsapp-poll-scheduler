'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
require('./patch-whatsapp').apply();
const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { defaults, localTime, preview, validate, due, nextRun } = require('./core');
const { checkConnection, closeClient } = require('./connection');
const ROOT = __dirname, DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
function read(name, fallback) {
  const file = path.join(DATA, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : structuredClone(fallback);
}
function write(name, value) {
  const file = path.join(DATA, `${name}.json`);
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
let settings = read('settings', defaults), ledger = read('ledger', {});
validate(settings); // Fail visibly rather than silently resetting a corrupt schedule.
const token = randomBytes(32).toString('hex');
let status = 'Connecting', qr = null, error = '', groups = [], busy = false, stopping = false;
let client, reconnectTimer, checking = false;
async function refreshGroups() {
  await checkConnection(client);
  groups = (await client.getChats()).filter(c => c.isGroup)
    .map(c => ({ id: c.id._serialized, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  error = '';
}
function reconnect() {
  if (stopping || reconnectTimer) return;
  status = 'Reconnecting'; qr = null;
  reconnectTimer = setTimeout(async () => {
    const previous = client; client = null;
    try { await closeClient(previous); } catch {}
    reconnectTimer = null;
    connect();
  }, 15000);
}
function connect() {
  status = 'Connecting'; qr = null;
  const instance = new Client({ authStrategy: new LocalAuth({ dataPath: path.join(DATA, 'session') }),
    puppeteer: { headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    deviceName: 'Mac mini poll scheduler', authTimeoutMs: 60000 });
  client = instance;
  instance.on('qr', async value => {
    if (client !== instance) return;
    status = 'Scan QR code';
    try { const image = await QRCode.toDataURL(value); if (client === instance && status === 'Scan QR code') qr = image; }
    catch (e) { error = e.message; }
  });
  instance.on('authenticated', () => { if (client === instance) { status = 'Loading WhatsApp'; qr = null; } });
  instance.on('ready', async () => {
    if (client !== instance || reconnectTimer) return;
    status = 'Connected'; qr = null; error = '';
    try { await refreshGroups(); } catch (e) { error = e.message; reconnect(); }
  });
  const lost = reason => { if (client === instance && !stopping) { error = String(reason); reconnect(); } };
  instance.on('auth_failure', lost);
  instance.on('disconnected', lost);
  instance.initialize().then(() => {
    if (client !== instance) return;
    instance.pupBrowser.on('disconnected', () => lost('WhatsApp browser disconnected.'));
    instance.pupPage.on('close', () => lost('WhatsApp browser page closed.'));
    instance.pupPage.on('error', e => lost(e.message));
  }).catch(e => lost(e.message));
}
async function send(key, config, now) {
  if (busy || status !== 'Connected') throw Error('WhatsApp is not ready to send.');
  let chat;
  try {
    await checkConnection(client);
    chat = await client.pupPage.evaluate(async id => {
      const target = await window.WWebJS.getChat(id, { getAsModel: false });
      return target ? { isGroup: target.id.server === 'g.us', name: target.formattedTitle } : null;
    }, config.groupId);
  }
  catch (e) {
    ledger[key] = { state: 'not_sent', at: now.toISOString(), groupName: config.groupName,
      question: preview(config, now).question, error: e.message };
    write('ledger', ledger); error = e.message; reconnect(); throw e;
  }
  if (!chat?.isGroup) throw Error('Target is not an available group.');
  if (busy || (ledger[key] && ledger[key].state !== 'not_sent')) throw Error('This posting has already been attempted.');
  busy = true;
  // Write BEFORE sending. A crash or timeout has an uncertain result; never automatically retry it.
  ledger[key] = { state: 'pending', at: now.toISOString(), groupName: chat.name, question: preview(config, now).question };
  try {
    let message;
    try {
      write('ledger', ledger);
      const poll = preview(config, now);
      message = await client.sendMessage(config.groupId, new Poll(poll.question, poll.options,
        { allowMultipleAnswers: poll.allowMultipleAnswers }), { sendSeen: false });
      if (!message?.id?._serialized) throw Error('WhatsApp did not return a message ID.');
      ledger[key].state = 'sent'; ledger[key].messageId = message.id._serialized;
      write('ledger', ledger); error = '';
    } catch (e) {
      if (status === 'Connected') reconnect();
      ledger[key].state = 'uncertain'; ledger[key].error = e.message;
      error = 'Posting needs review in WhatsApp: ' + e.message;
      write('ledger', ledger);
      throw e;
    }
    // Pinning failure must never turn an accepted send into an uncertain send.
    let pinTimer;
    try {
      const pinned = await Promise.race([message.pin(86400), new Promise((_, reject) => {
        pinTimer = setTimeout(() => reject(Error('Pinning timed out; check the poll in WhatsApp.')), 20000);
      })]);
      if (!pinned) throw Error('WhatsApp declined pinning. Check your group permissions.');
      ledger[key].pinned = true;
    } catch (e) {
      ledger[key].pinError = e.message;
    } finally { clearTimeout(pinTimer); }
    write('ledger', ledger);
    return ledger[key];
  } finally { busy = false; }
}
function respond(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}
async function body(req) {
  let bytes = 0, chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw Error('Request too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function authorized(req) {
  const supplied = Buffer.from(req.headers['x-local-token'] || '');
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
const server = http.createServer(async (req, res) => {
  // Loopback binding plus Host, Origin and token checks protect the linked account from other websites.
  if (!['127.0.0.1:3210', 'localhost:3210'].includes(req.headers.host)) return respond(res, 403, { error: 'Invalid host.' });
  if (req.headers.origin && !['http://127.0.0.1:3210', 'http://localhost:3210'].includes(req.headers.origin)) return respond(res, 403, { error: 'Invalid origin.' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, 'http://127.0.0.1:3210');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" });
      return res.end(fs.readFileSync(path.join(ROOT, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(ROOT, 'app.js')));
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const now = new Date();
      return respond(res, 200, { token, status, qr, error, groups, settings, busy,
        now: localTime(now), preview: preview(settings, now), next: nextRun(settings, ledger, now),
        history: Object.values(ledger).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20) });
    }
    if (req.method !== 'POST' || !authorized(req)) return respond(res, 403, { error: 'Reload the page and try again.' });
    if (url.pathname === '/api/settings') {
      if (busy) throw Error('A poll is sending. Try again in a moment.');
      const config = validate(await body(req));
      const group = groups.find(g => g.id === config.groupId);
      if (config.groupId && !group) throw Error('Refresh groups and select a current group.');
      config.groupName = group?.name || '';
      write('settings', config); settings = config;
      return respond(res, 200, { ok: true });
    }
    if (url.pathname === '/api/groups') {
      if (status !== 'Connected') throw Error('Connect WhatsApp first.');
      await refreshGroups(); return respond(res, 200, { ok: true });
    }
    if (url.pathname === '/api/send') {
      if (!settings.groupId) throw Error('Select and save a group first.');
      const now = new Date();
      const result = await send('manual:' + randomBytes(12).toString('hex'), structuredClone(settings), now);
      return respond(res, 200, { ok: true, pinned: result.pinned === true, pinError: result.pinError });
    }
    respond(res, 404, { error: 'Not found.' });
  } catch (e) { respond(res, 400, { error: e.message }); }
});
server.on('error', e => { console.error(e.message); process.exit(1); });
server.listen(3210, '127.0.0.1', () => {
  console.log('WhatsApp polls: http://127.0.0.1:3210'); connect();
});
setInterval(async () => {
  if (busy || status !== 'Connected') return;
  const now = new Date(), key = due(settings, ledger, now);
  if (key) try { await send(key, structuredClone(settings), now); } catch (e) { error = e.message; }
}, 5000);
setInterval(async () => {
  if (checking || busy || status !== 'Connected') return;
  checking = true;
  const instance = client;
  try { await checkConnection(instance); }
  catch (e) { if (client === instance) { error = e.message; reconnect(); } }
  finally { checking = false; }
}, 10000);
async function stop() {
  stopping = true; clearTimeout(reconnectTimer); server.close();
  setTimeout(() => process.exit(0), 15000).unref();
  if (client) try { await closeClient(client); } catch {}
  process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
