'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const label = 'local.indiehackers.whatsapp-polls';
const directory = path.join(os.homedir(), 'Library', 'LaunchAgents');
const target = path.join(directory, label + '.plist');
const domain = 'gui/' + process.getuid();
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const args = ['/usr/bin/caffeinate', '-i', process.execPath, path.join(__dirname, 'server.js')];
fs.mkdirSync(directory, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true, mode: 0o700 });
if (fs.existsSync(target) && fs.readFileSync(target, 'utf8').includes(xml(path.join(__dirname, 'server.js'))) === false) {
  throw Error('A service with this name already exists for another folder. It was not replaced.');
}
spawnSync('/bin/launchctl', ['bootout', domain + '/' + label]);
fs.writeFileSync(target, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(__dirname)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>${xml(path.join(__dirname, 'data', 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(__dirname, 'data', 'service-error.log'))}</string>
</dict></plist>`, { mode: 0o600 });
const result = spawnSync('/bin/launchctl', ['bootstrap', domain, target], { encoding: 'utf8' });
if (result.status !== 0) throw Error(result.stderr || 'Could not start login service.');
console.log('Installed and started: ' + target);
console.log('Open http://127.0.0.1:3210');
