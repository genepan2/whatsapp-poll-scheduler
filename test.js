'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, localTime, preview, validate, due, nextRun } = require('./core');
test('Vietnam midnight, scheduling, date generation and restart duplicate protection', () => {
  const c = validate({ ...defaults, enabled: true, groupId: '123456@g.us', time: '00:00', days: ['thu'] });
  const before = new Date('2026-09-30T16:59:59Z'), midnight = new Date('2026-09-30T17:00:00Z');
  assert.equal(preview(c, before).question, 'today (30.09) I ship from ...');
  assert.equal(preview(c, midnight).question, 'today (01.10) I ship from ...');
  assert.deepEqual(localTime(midnight), { day: 'thu', date: '01.10', key: '2026-10-01', time: '00:00' });
  assert.equal(due(c, {}, before), null);
  const key = due(c, {}, midnight); assert.equal(key, '123456@g.us:2026-10-01');
  for (const state of ['pending', 'sent', 'uncertain']) assert.equal(due(c, JSON.parse(JSON.stringify({ [key]: { state } })), midnight), null);
  assert.equal(due(c, { [key]: { state: 'not_sent' } }, midnight), key);
  assert.equal(due(c, { [key]: { state: 'not_sent' } }, new Date('2026-09-30T17:01:00Z')), null);
  assert.equal(due(c, {}, new Date('2026-09-30T17:01:00Z')), null);
  assert.equal(due({ ...c, enabled: false }, {}, midnight), null);
  assert.equal(due({ ...c, days: ['fri'] }, {}, midnight), null);
  assert.equal(nextRun(c, {}, before), midnight.toISOString());
  assert.equal(nextRun(c, { [key]: { state: 'sent' } }, midnight), '2026-10-07T17:00:00.000Z');
});
test('settings reject invalid inputs while preserving edited options', () => {
  assert.deepEqual(validate({ ...defaults, options: ['New café', 'Home'] }).options, ['New café', 'Home']);
  for (const patch of [{ enabled: true }, { groupId: '123@c.us' }, { time: '24:00' }, { days: [] }, { days: ['thu', 'thu'] }, { days: ['bad'] }, { options: ['a'] }, { options: ['a', ' A '] }, { options: Array(13).fill('x') }, { question: '' }, { allowMultipleAnswers: 'yes' }]) {
    assert.throws(() => validate({ ...defaults, ...patch }));
  }
});
test('real library chat lookup handles WhatsApp renamed message keys without losing chats', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const { patchSource } = require('./patch-whatsapp');
  const source = fs.readFileSync(require.resolve('whatsapp-web.js/src/util/Injected/Utils'), 'utf8');
  const patched = patchSource(source);
  assert.equal(patchSource(patched), patched);
  const chats = [
    { id: { _serialized: '123@g.us' }, groupMetadata: { serialize: () => ({ participants: [] }) }, lastReceivedKey: { $1: 'renamed-key' } },
    { id: { _serialized: '456@g.us' }, groupMetadata: { serialize: () => ({ participants: [] }) }, lastReceivedKey: { _serialized: 'old-key' } }
  ];
  chats.forEach(c => c.serialize = () => ({ id: c.id, msgs: ['message'] }));
  const window = { WWebJS: { getMessageModel: m => m }, require: name => {
    if (name === 'WAWebCollections') return { Chat: { getModelsArray: () => chats }, GroupMetadata: { update: async () => {} }, Msg: { get: key => { assert.ok(key, 'No undefined IndexedDB key'); return { key }; } } };
    if (name === 'WAWebWidFactory') return { createWid: id => id };
    if (name === 'WAWebLidMigrationUtils') return { toPn: id => id };
    throw Error(name);
  }};
  const start = patched.indexOf('window.WWebJS.getChats ='), end = patched.indexOf('window.WWebJS.getContactModel =');
  const broken = patched.slice(start, end).replaceAll('(chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1)', 'chat.lastReceivedKey._serialized');
  vm.runInNewContext(broken, { window });
  await assert.rejects(window.WWebJS.getChats(), /No undefined IndexedDB key/);
  vm.runInNewContext(patched.slice(start, end), { window });
  const result = await window.WWebJS.getChats();
  assert.equal(result.length, 2);
  assert.equal(result[0].lastMessage.key, 'renamed-key');
  assert.equal(result[1].lastMessage.key, 'old-key');
  assert.ok(result.every(c => c.isGroup));
  // Send results cross the Puppeteer boundary as plain objects; restore the ID expected by the app.
  window.require = name => { assert.equal(name, 'WALinkify'); return { findLinks: () => [] }; };
  const msgStart = patched.indexOf('window.WWebJS.getMessageModel ='), msgEnd = patched.indexOf('window.WWebJS.getChat =', msgStart);
  vm.runInNewContext(patched.slice(msgStart, msgEnd), { window });
  const message = { id: { $1: 'returned-key', remote: '123@g.us' }, serialize: () => ({ id: { $1: 'returned-key', remote: '123@g.us' } }) };
  assert.equal(window.WWebJS.getMessageModel(message).id._serialized, 'returned-key');
});
test('connection checks reject stale ready state and detached browser frames', async () => {
  const { checkConnection } = require('./connection');
  const client = {
    pupBrowser: { connected: true },
    pupPage: { isClosed: () => false, mainFrame: () => ({ detached: false }) },
    getState: async () => 'CONNECTED'
  };
  await checkConnection(client);
  await assert.rejects(checkConnection({ ...client, pupBrowser: { connected: false } }), /connection was lost/);
  await assert.rejects(checkConnection({ ...client, pupPage: { isClosed: () => true } }), /connection was lost/);
  await assert.rejects(checkConnection({ ...client, pupPage: { isClosed: () => false, mainFrame: () => ({ detached: true }) } }), /connection was lost/);
  await assert.rejects(checkConnection({ ...client, getState: async () => { throw Error('Attempted to use detached Frame'); } }), /detached Frame/);
  await assert.rejects(checkConnection({ ...client, getState: async () => 'TIMEOUT' }), /offline/);
});
test('lightweight group lookup does not wait for full chat metadata', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('whatsapp-web.js/src/util/Injected/Utils'), 'utf8');
  const target = { id: { server: 'g.us', _serialized: '123@g.us' }, formattedTitle: 'Test group' };
  const window = { WWebJS: { getChatModel: () => new Promise(() => {}) }, require: name => {
    if (name === 'WAWebWidFactory') return { createWid: id => id };
    if (name === 'WAWebCollections') return { Chat: { get: () => target } };
    throw Error(name);
  }};
  vm.runInNewContext(source.slice(source.indexOf('window.WWebJS.getChat ='), source.indexOf('window.WWebJS.getChats =')), { window });
  const full = window.WWebJS.getChat('123@g.us');
  assert.equal(await Promise.race([full, new Promise(r => setTimeout(() => r('blocked'), 10))]), 'blocked');
  const raw = await window.WWebJS.getChat('123@g.us', { getAsModel: false });
  assert.equal(raw, target);
  assert.equal(raw.id.server, 'g.us');
});
test('pinning success, denial, exception and timeout never resend an accepted poll', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const sendSource = source.slice(source.indexOf('async function send('), source.indexOf('function respond('));
  const now = new Date('2026-10-08T17:05:00Z');
  const config = validate({ ...defaults, enabled: true, groupId: '123@g.us', time: '00:05', days: ['fri'] });
  const key = due(config, {}, now);
  for (const mode of ['success', 'denied', 'exception', 'timeout', 'send_failed']) {
    let sends = 0, pins = 0, reconnects = 0, cleared = 0;
    const writes = [], ledger = {};
    const context = {
      busy: false, status: 'Connected', error: '', ledger, preview,
      checkConnection: async () => {}, reconnect: () => { reconnects++; },
      Poll: class { constructor(question, options) { this.question = question; this.options = options; } },
      write: (name, value) => { assert.equal(name, 'ledger'); writes.push(structuredClone(value)); },
      setTimeout: callback => setTimeout(callback, mode === 'timeout' ? 1 : 1000),
      clearTimeout: timer => { cleared++; clearTimeout(timer); },
      client: {
        pupPage: { evaluate: async () => ({ isGroup: true, name: 'Test group' }) },
        sendMessage: async () => {
          sends++;
          if (mode === 'send_failed') throw Error('Send failed');
          return { id: { _serialized: 'test-message' }, pin: async duration => {
            pins++; assert.equal(duration, 86400);
            assert.equal(writes.at(-1)[key].state, 'sent');
            if (mode === 'exception') throw Error('Pin rejected');
            if (mode === 'timeout') return new Promise(() => {});
            return mode === 'success';
          } };
        }
      }
    };
    vm.runInNewContext(sendSource, context);
    if (mode === 'send_failed') {
      await assert.rejects(context.send(key, config, now), /Send failed/);
      assert.equal(ledger[key].state, 'uncertain');
      assert.equal(pins, 0); assert.equal(reconnects, 1);
    } else {
      const result = await context.send(key, config, now);
      assert.equal(result.state, 'sent'); assert.equal(result.messageId, 'test-message');
      if (mode === 'success') assert.equal(result.pinned, true);
      else { assert.ok(result.pinError); assert.equal(result.pinned, undefined); }
      assert.equal(reconnects, 0); assert.equal(cleared, 1);
    }
    assert.equal(context.busy, false);
    assert.equal(due(config, ledger, now), null);
    await assert.rejects(context.send(key, config, now), /already been attempted/);
    assert.equal(sends, 1);
  }
});
