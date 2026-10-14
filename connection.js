'use strict';
async function checkConnection(client) {
  if (!client?.pupBrowser?.connected || !client.pupPage || client.pupPage.isClosed() || client.pupPage.mainFrame().detached) {
    throw Error('WhatsApp browser connection was lost. Reconnecting.');
  }
  let timer;
  try {
    const state = await Promise.race([
      client.getState(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('WhatsApp connection check timed out.')), 10000); })
    ]);
    if (state !== 'CONNECTED') throw Error('WhatsApp is offline (' + state + '). Reconnecting.');
  } finally { clearTimeout(timer); }
}
async function closeClient(client) {
  if (!client) return;
  const child = client.pupBrowser?.process();
  let timer;
  try {
    await Promise.race([
      client.destroy(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Browser shutdown timed out.')), 5000); })
    ]);
  } finally {
    clearTimeout(timer);
    // The library skips browser.close() after a CDP disconnect. Its Chrome process can still hold the profile lock.
    // This is the child launched by this client, never the user's regular Chrome.
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => {
        const force = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => { clearTimeout(force); resolve(); });
        child.kill('SIGTERM');
      });
    }
  }
}
module.exports = { checkConnection, closeClient };
