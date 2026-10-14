'use strict';
const $ = id => document.getElementById(id);
let state, loaded = false, dirty = false, requesting = false;
function notice(message, bad = false) { $('notice').textContent = message; $('notice').className = bad ? 'error' : ''; }
async function api(endpoint, value = {}) {
  const response = await fetch('/api/' + endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Local-Token': state.token }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
function option(value) {
  const row = document.createElement('div'); row.className = 'row';
  const input = document.createElement('input'); input.value = value; input.maxLength = 100; input.required = true; input.setAttribute('aria-label', 'Café name');
  row.append(input);
  for (const [label, title, action] of [
    ['↑', 'Move option up', () => { if (row.previousElementSibling) row.previousElementSibling.before(row); }],
    ['↓', 'Move option down', () => { if (row.nextElementSibling) row.nextElementSibling.after(row); }],
    ['×', 'Remove option', () => row.remove()]
  ]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = label; button.setAttribute('aria-label', title);
    button.onclick = () => { action(); dirty = true; renderPreview(); }; row.append(button);
  }
  $('options').append(row);
}
for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
  const label = document.createElement('label'), box = document.createElement('input'); box.type = 'checkbox'; box.value = day;
  label.append(box, ' ' + day[0].toUpperCase() + day.slice(1)); $('days').append(label);
}
function config() {
  return { groupId: $('group').value, time: $('time').value, question: $('question').value,
    options: [...$('options').querySelectorAll('input')].map(i => i.value),
    days: [...$('days').querySelectorAll('input:checked')].map(i => i.value),
    allowMultipleAnswers: $('multiple').checked, enabled: $('enabled').checked };
}
function renderGroups() {
  const selected = loaded ? $('group').value : state.settings.groupId;
  const choices = [{ id: '', name: 'Choose a group' }, ...state.groups];
  if (selected && !state.groups.some(g => g.id === selected)) choices.push({ id: selected, name: state.settings.groupName || 'Saved group (not loaded yet)' });
  const existing = [...$('group').options];
  if (existing.length !== choices.length || choices.some((g, i) => existing[i].value !== g.id || existing[i].text !== g.name)) {
    $('group').replaceChildren(...choices.map(g => new Option(g.name, g.id)));
    $('group').value = selected;
  }
  $('groupHint').textContent = state.groups.length ? `${state.groups.length} groups loaded` : 'Groups appear after connecting WhatsApp.';
}
function renderPreview() {
  const c = config(), date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date()).replace('/', '.');
  $('previewQuestion').textContent = c.question.replaceAll('{date}', date);
  $('previewOptions').replaceChildren();
  c.options.forEach(name => { const div = document.createElement('div'); div.className = 'choice'; div.textContent = name; $('previewOptions').append(div); });
  $('previewHint').textContent = c.allowMultipleAnswers ? 'Multiple answers allowed' : 'One answer per person';
}
async function update() {
  const response = await fetch('/api/status');
  if (!response.ok) throw Error('Could not load sender status.');
  state = await response.json(); renderGroups();
  if (!loaded) {
    const s = state.settings;
    $('question').value = s.question; $('time').value = s.time;
    $('multiple').checked = s.allowMultipleAnswers; $('enabled').checked = s.enabled;
    $('days').querySelectorAll('input').forEach(i => i.checked = s.days.includes(i.value));
    s.options.forEach(option); loaded = true;
  }
  $('connection').textContent = state.status;
  $('qr').hidden = !state.qr; $('qrHint').hidden = !state.qr;
  if (state.qr) $('qr').src = state.qr; else $('qr').removeAttribute('src');
  $('connectionError').textContent = state.error;
  $('refresh').disabled = state.status !== 'Connected';
  $('send').disabled = state.status !== 'Connected' || state.busy || requesting;
  $('next').textContent = state.next ? 'Next saved posting: ' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(state.next)) + ' (Vietnam)' : state.settings.enabled ? 'No upcoming posting found.' : 'Scheduled posting is paused.';
  $('history').replaceChildren();
  for (const item of state.history) {
    const li = document.createElement('li');
    const timestamp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.at));
    li.textContent = `${item.state.toUpperCase()} · ${timestamp} · ${item.groupName}\n${item.question}${item.error ? ' · ' + item.error : ''}${item.pinned ? ' · Pinned for 24 hours after sending' : ''}${item.pinError ? ' · Pinning failed: ' + item.pinError : ''}`;
    li.style.whiteSpace = 'pre-wrap'; $('history').append(li);
  }
  if (!state.history.length) $('history').textContent = 'No polls sent yet.';
  renderPreview();
}
$('settings').addEventListener('input', () => { dirty = true; renderPreview(); notice('Unsaved changes.'); });
$('settings').addEventListener('change', () => { dirty = true; renderPreview(); });
$('add').onclick = () => {
  if ($('options').children.length >= 12) return notice('WhatsApp supports up to 12 poll options.', true);
  option(''); dirty = true; renderPreview(); $('options').lastElementChild.querySelector('input').focus();
};
$('settings').onsubmit = async event => {
  event.preventDefault();
  try { await api('settings', config()); dirty = false; notice('Settings saved.'); await update(); }
  catch (e) { notice(e.message, true); }
};
$('refresh').onclick = async () => { try { await api('groups'); await update(); } catch (e) { notice(e.message, true); } };
$('send').onclick = async () => {
  if (dirty) return notice('Save your changes before sending.', true);
  if (!state.settings.groupId) return notice('Select and save a group first.', true);
  if (!confirm(`Post this poll now to "${state.settings.groupName}"?\n\n${state.preview.question}\n${state.preview.options.join('\n')}\n\nThis is an extra poll; the schedule stays unchanged.`)) return;
  requesting = true; $('send').disabled = true;
  try {
    const result = await api('send');
    notice(result.pinned ? 'Poll sent and pinned for 24 hours.' : 'Poll sent. Pinning failed: ' + result.pinError, !result.pinned);
  } catch (e) { notice(e.message, true); }
  finally { requesting = false; await update(); }
};
update().catch(e => notice(e.message, true));
setInterval(() => update().catch(() => { $('connection').textContent = 'Sender unavailable'; $('send').disabled = true; }), 5000);
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
