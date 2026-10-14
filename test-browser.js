'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const puppeteer = require('puppeteer');
const { Client } = require('whatsapp-web.js');
const { closeClient } = require('./connection');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-browser-test-'));
const options = { headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', userDataDir: profile };
(async () => {
  let browser = await puppeteer.launch(options);
  const child = browser.process();
  const client = { pupBrowser: browser, authStrategy: { destroy: async () => {} }, destroy() { return Client.prototype.destroy.call(this); } };
  try {
    browser.disconnect();
    await closeClient(client);
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'Disconnected Chrome must exit before reopening its session folder');
    browser = await puppeteer.launch(options);
    await browser.close();
    console.log('PASS: disconnected Chrome exited; the same profile reopened without a lock conflict.');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM'); await ended;
    }
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(e => { console.error(e.message); process.exit(1); });
