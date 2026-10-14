// -----------------------------------------------------------------------------
// Wall times in a time zone, without a library. Pure.
//
// Todoist stores a "floating" due time as a wall time of the user's time zone
// ("2026-10-14T19:00:00", no offset) and a date-only due as a bare date: both
// are turned into instants with the time zone of the account (the `tz_info`
// of the sync `user`), never with the container's, which runs in UTC.
// -----------------------------------------------------------------------------

const formatters = new Map();

function formatter(timeZone) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** The IANA zone when the runtime knows it, else UTC. */
export function validTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) {
    return 'UTC';
  }
  try {
    formatter(timeZone);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function wallParts(instant, timeZone) {
  const parts = {};
  for (const { type, value } of formatter(timeZone).formatToParts(new Date(instant))) {
    parts[type] = value;
  }
  return parts;
}

/** The offset of the zone at an instant, in ms (Paris in October: +2 h). */
function offsetAt(instant, timeZone) {
  const p = wallParts(instant, timeZone);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - (instant - (((instant % 1000) + 1000) % 1000));
}

/** "2026-10-14" + "19:00" in Europe/Paris -> the instant (ms). */
export function zonedToInstant(date, time, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = String(time ?? '00:00')
    .split(':')
    .map(Number);
  const wall = Date.UTC(y, m - 1, d, h || 0, min || 0);
  // Two passes: the offset at the guessed instant, then at the corrected one
  // (a DST change between them moves the answer by an hour).
  const guess = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(guess, timeZone);
}

/** An instant as the wall date and time of a zone: { date: '2026-10-14', time: '19:00' }. */
export function localParts(instant, timeZone) {
  const p = wallParts(instant, timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** The date of the day after `date` ("2026-10-31" -> "2026-11-01"). */
export function nextDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
