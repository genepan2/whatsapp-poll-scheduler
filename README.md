# WhatsApp Poll Scheduler

A small local webpage for scheduling recurring WhatsApp group polls. Choose a group, edit the question and options, and choose the posting time and days. `{date}` inserts the day's date, and new polls are pinned for 24 hours when group permissions allow.

Runs on your own Mac with your own WhatsApp account. No Business API or paid scheduling service is needed. This version supports **macOS** and uses **Vietnam time, UTC+7**, for every posting regardless of your Mac's timezone. Timezone selection and Windows/Linux service installation are not included.

## Quick start

You need:

- A Mac with [Node.js 24 LTS](https://nodejs.org/en/download) and npm installed.
- [Google Chrome](https://www.google.com/chrome/) installed in `/Applications`.
- WhatsApp on your phone with access to the group you want to post in.
- Git, or download and unzip this repository from GitHub's **Code → Download ZIP** menu.

In Terminal:

```sh
git clone https://github.com/genepan2/whatsapp-poll-scheduler.git
cd whatsapp-poll-scheduler
PUPPETEER_SKIP_DOWNLOAD=true npm ci
npm start
```

If you downloaded a ZIP, open Terminal in the extracted folder and run the last two commands. Open [http://127.0.0.1:3210](http://127.0.0.1:3210) in your browser. Keep Terminal running during this first test.

1. Scan the QR code using WhatsApp's Linked devices screen on your phone.
2. Select your group. Edit the question, café options, time and days.
3. Choose time and days in Vietnam time, enable scheduled posting and save. A fresh installation starts paused and has no selected group.
4. Use **Send saved poll now** to test your setup. Confirm the destination and check WhatsApp for the poll and its pin. This posts a real extra poll.

`{date}` becomes today's `DD.MM` in Vietnam time, UTC+7. Changes apply when saved. “Send saved poll now” asks for confirmation and sends an extra poll immediately.

The included café names are examples; replace them with your own options. Polls can contain 2–12 different options. You can choose one answer per person or allow multiple answers.

## Behaviour

Each newly sent poll is automatically pinned for 24 hours. Your linked account must be a group admin, or an admin must enable Group permissions → Edit group settings for members. Pinning failures appear separately in send history and never resend the poll. A pinning timeout means the pin result needs checking in WhatsApp. Existing polls are not changed.

The local page can be closed while the sender runs. The Mac must be awake and online. The installed login service uses `caffeinate -i` to prevent idle system sleep while running, without keeping the display on. It starts after login, not before login after a reboot. Explicit sleep or shutdown still stops delivery.

Polls send only during the selected minute. Missed times are skipped rather than sent late. If the connection recovers within that minute, the poll can still post. Connection failures trigger reconnection every 15 seconds.

The sender checks the actual browser and WhatsApp connection every ten seconds and before posting. A closed, detached or disconnected browser triggers a new browser using the saved linked session. The page shows “Reconnecting” during recovery. Failures before sending appear as `not_sent` in history and may retry only within the selected minute; uncertain send results still never retry automatically.

Recovery and shutdown also terminate the Chrome child launched by the sender if its automation connection has detached. This releases the session lock before the next browser starts; it does not stop your regular Chrome or remove the saved WhatsApp session.

Each scheduled group/date is attempted at most once. The sender saves an attempt before calling WhatsApp. A timeout or crash leaves an uncertain/pending entry and is not retried automatically. Check the group; if needed, use “Send saved poll now” manually. A successful entry means WhatsApp returned a message ID, not that every member received it. Changing the time after a scheduled attempt does not post a second scheduled poll to that group on the same day.

Settings, send history and your linked WhatsApp session are stored in `data/`, excluded from Git. Keep that folder private. The server listens only on your Mac at `127.0.0.1:3210`.

This uses the unofficial `whatsapp-web.js` library. WhatsApp updates can break it and account blocking is possible. No Business API, hosted service or paid gateway is used.

The clean install checked on 14 October 2026 reports nine high-severity affected packages in the dependency audit, inherited through the WhatsApp library's Puppeteer dependencies. These remain unresolved. This is not a security-audited release. Keep it local; do not expose port 3210 to the internet. Review dependency upgrades and run the tests before changing the pinned library version, because the compatibility correction below depends on its source.

`patch-whatsapp.js` corrects the library's message-key lookup for WhatsApp's `_serialized` → `$1` field change. It runs before loading the library on every startup, including after dependency reinstalls. It preserves all chats instead of hiding ones that failed to load. The correction covers chat reads, send results and serialized message IDs; see upstream issue https://github.com/wwebjs/whatsapp-web.js/issues/201845.

## Login service

After testing, press **Control-C** in the Terminal running `npm start`, then run:

```sh
node install-login.js
```

This starts the sender and installs a service that starts automatically after you log in to your Mac. You can close Terminal afterwards. The service uses this exact folder and Node executable; keep both in place. It does not enable scheduled posting or send a poll. Run this command again after moving the folder or changing your Node installation. If a service already points to a different folder, stop and remove that old service first using the commands below.

Stop it with:

```sh
launchctl bootout gui/$(id -u)/local.indiehackers.whatsapp-polls
```

To remove autostart as well, delete `~/Library/LaunchAgents/local.indiehackers.whatsapp-polls.plist` after stopping it.

## Troubleshooting and moving to another Mac

- **QR code or no groups:** wait for WhatsApp to finish loading, then choose **Refresh groups**. If asked, link the phone again through **WhatsApp → Settings → Linked devices → Link a device**.
- **Poll sent but not pinned:** check the history entry. You need to be a group admin, or an admin must allow members to edit group settings. A failed pin does not resend the poll.
- **Sender unavailable:** start `npm start`, or reinstall the login service. Service logs are in `data/service.log` and `data/service-error.log`; they may contain private information, so redact them before sharing.
- **Port 3210 already in use:** stop the other copy of this scheduler. Run only one sender for the same group and schedule.
- **Chrome in another location:** run `CHROME_PATH='/full/path/to/the/Chrome/executable' npm start`. The login service uses the default `/Applications` Chrome location.
- **Moving to a Mac mini:** stop the old sender, install a fresh copy on the new Mac, link WhatsApp again, choose your group and save the schedule. New installs do not inherit send history, so move after the day's poll has posted and before the next posting time to avoid duplicates. Do not run both copies together or put your `data/` folder on GitHub.

## Check

```sh
npm test
npm run test:browser
```

Tests cover Vietnam date rollover, recurring scheduling, input validation and duplicate suppression. The browser test uses an isolated temporary Chrome profile to reproduce automation disconnection and verify the session can reopen. It never links WhatsApp or sends messages. Live delivery requires linking your phone and sending a test poll yourself.

## License

[MIT](LICENSE). You may use, modify and share the code. This project is not affiliated with WhatsApp or Meta.
