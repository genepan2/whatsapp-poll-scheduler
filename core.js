'use strict';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const defaults = {
  enabled: false, groupId: '', groupName: '', time: '08:00',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  question: 'today ({date}) I ship from ...',
  options: ['wink hotel', 'lighthouse og', 'hi4 v2', 'about us', 'solis', 'caphe commune', 'danasol', 'paradise', 'home'],
  allowMultipleAnswers: true
};
function localTime(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  return { day: parts.weekday.toLowerCase(), date: `${parts.day}.${parts.month}`,
    key: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function preview(settings, now = new Date()) {
  return { question: settings.question.replaceAll('{date}', localTime(now).date),
    options: settings.options, allowMultipleAnswers: settings.allowMultipleAnswers };
}
function validate(input) {
  if (!input || typeof input !== 'object') throw Error('Invalid settings.');
  const { enabled, groupId, time, days, question, options, allowMultipleAnswers } = input;
  if (typeof enabled !== 'boolean' || typeof allowMultipleAnswers !== 'boolean') throw Error('Invalid toggle.');
  if (typeof groupId !== 'string' || (groupId && !/^\d+(?:-\d+)?@g\.us$/.test(groupId))) throw Error('Select a WhatsApp group.');
  if (enabled && !groupId) throw Error('Select a group before enabling posting.');
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('Choose a valid posting time.');
  if (!Array.isArray(days) || !days.length || days.some(d => !DAYS.includes(d)) || new Set(days).size !== days.length) throw Error('Select at least one day.');
  if (typeof question !== 'string' || !question.trim() || question.length > 250) throw Error('Question must contain 1–250 characters.');
  if (!Array.isArray(options) || options.length < 2 || options.length > 12 || options.some(o => typeof o !== 'string' || !o.trim() || o.length > 100)) throw Error('Use 2–12 options, each 1–100 characters.');
  if (new Set(options.map(o => o.trim().toLowerCase())).size !== options.length) throw Error('Options must be different.');
  return { enabled, groupId, groupName: '', time, days, question: question.trim(),
    options: options.map(o => o.trim()), allowMultipleAnswers };
}
function due(settings, ledger, now = new Date()) {
  const t = localTime(now);
  const key = `${settings.groupId}:${t.key}`;
  // ponytail: send only in the chosen minute; missed schedules are skipped, never sent late.
  return settings.enabled && settings.groupId && settings.days.includes(t.day) &&
    settings.time === t.time && (!ledger[key] || ledger[key].state === 'not_sent') ? key : null;
}
function nextRun(settings, ledger, now = new Date()) {
  if (!settings.enabled || !settings.groupId) return null;
  const start = new Date(`${localTime(now).key}T${settings.time}:00+07:00`).getTime();
  for (let i = 0; i <= 8; i++) {
    const candidate = new Date(start + i * 86400000);
    if (candidate.getTime() < Math.floor(now.getTime() / 60000) * 60000) continue;
    if (due(settings, ledger, candidate)) return candidate.toISOString();
  }
  return null;
}
module.exports = { defaults, localTime, preview, validate, due, nextRun };
