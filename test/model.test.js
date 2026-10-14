// -----------------------------------------------------------------------------
// Todoist JSON -> tasks, projects, account (src/todoist/model.js) and the
// wall times of a time zone (src/time.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiPriority,
  dueOf,
  emptyStore,
  mergeSync,
  pageOf,
  priorityOf,
  taskOf,
  userOf,
} from '../src/todoist/model.js';
import { localParts, nextDate, validTimeZone, zonedToInstant } from '../src/time.js';
import { FIXTURE_NOW, IDS, fixture } from './helpers/fakeTodoist.js';

const full = () => fixture('sync-full.json');
const raw = (id) => full().items.find((i) => i.id === id);

test('a task: priority the apps way, Markdown links as text, the documented URL', () => {
  const bins = taskOf(raw(IDS.BINS));
  assert.equal(bins.priority, 'p1', 'the API says 4 for the p1 of the apps');
  assert.equal(bins.completedCount, 12);
  assert.equal(bins.url, `https://app.todoist.com/app/task/${IDS.BINS}`);
  assert.equal(bins.addedAt, Date.parse('2026-10-01T07:12:44.123Z'));
  assert.equal(taskOf(raw(IDS.READ)).content, "Lire l'article");
  const heading = taskOf(raw(IDS.HEADING));
  assert.equal(heading.uncompletable, true);
  assert.equal(heading.content, 'Idées de week-end');
  assert.deepEqual(taskOf(raw(IDS.BREAD)).labels, ['courses']);
  assert.deepEqual([4, 3, 2, 1, 0].map(priorityOf), ['p1', 'p2', 'p3', 'p4', 'p4']);
  assert.deepEqual(['p1', 'p4', 'x'].map(apiPriority), [4, 1, undefined]);
});

test('the three kinds of due dates, and the separate `datetime` some answers carry', () => {
  assert.deepEqual(dueOf({ date: '2026-10-14', string: "aujourd'hui", is_recurring: false }), {
    date: '2026-10-14',
    time: null,
    instant: null,
    recurring: false,
    string: "aujourd'hui",
  });
  const floating = dueOf({ date: '2026-10-14T19:00:00', is_recurring: true });
  assert.equal(floating.time, '19:00');
  assert.equal(floating.instant, null);
  assert.equal(floating.recurring, true);
  const fixed = dueOf({ date: '2026-10-14T08:30:00.000000Z', timezone: 'Europe/Paris' });
  assert.equal(fixed.instant, Date.parse('2026-10-14T08:30:00Z'));
  assert.equal(dueOf({ date: '2026-10-14', datetime: '2026-10-14T07:15:00Z' }).time, '07:15');
  assert.equal(dueOf({ date: 'tomorrow' }), null);
  assert.equal(dueOf(null), null);
});

test('a full sync, then an incremental one: the store keeps the active tasks only', () => {
  const first = mergeSync(undefined, full(), FIXTURE_NOW);
  assert.equal(first.full, true);
  assert.equal(first.store.tasks.size, 7);
  assert.deepEqual(
    [...first.store.projects.values()].map((p) => p.name),
    ['Inbox', 'Maison', 'Courses', 'Travail'],
    'the archived project is left out',
  );
  assert.deepEqual(first.store.user, {
    timeZone: 'Europe/Paris',
    lang: 'fr',
    inboxProjectId: IDS.INBOX,
  });
  assert.equal(first.store.syncToken, 'tok-1');

  const bread = { ...raw(IDS.BREAD), checked: true };
  const next = mergeSync(
    first.store,
    { full_sync: false, sync_token: 'tok-2', items: [bread], projects: [] },
    FIXTURE_NOW + 60_000,
  );
  assert.equal(next.full, false);
  assert.equal(next.store.tasks.has(IDS.BREAD), false);
  assert.equal(next.store.tasks.size, 6);
  assert.equal(next.changes.length, 1);
  assert.equal(next.changes[0].before.checked, false);
  assert.equal(next.changes[0].after.checked, true);
  assert.equal(next.store.user.timeZone, 'Europe/Paris', 'kept when the answer has no user');
  assert.equal(first.store.tasks.has(IDS.BREAD), true, 'the previous store is untouched');
  assert.equal(emptyStore().syncToken, '*');
});

test('the account settings never keep the token nor the email', () => {
  const user = userOf(full().user);
  assert.deepEqual(Object.keys(user).sort(), ['inboxProjectId', 'lang', 'timeZone']);
  const { store } = mergeSync(undefined, full(), FIXTURE_NOW);
  assert.doesNotMatch(JSON.stringify(store.user), /0123456789abcdef|example\.org/);
});

test('a page of tasks/filter', () => {
  const page = pageOf({ results: [raw(IDS.BREAD), { content: 'no id' }], next_cursor: 'c2.x' });
  assert.deepEqual(
    page.tasks.map((t) => t.id),
    [IDS.BREAD],
  );
  assert.equal(page.cursor, 'c2.x');
  assert.equal(pageOf({ results: [], next_cursor: null }).cursor, null);
});

test('wall times in a time zone, across the change to winter time', () => {
  assert.equal(
    zonedToInstant('2026-10-14', '19:00', 'Europe/Paris'),
    Date.parse('2026-10-14T17:00:00Z'),
  );
  // 25 October 2026: Paris goes back to UTC+1 at 03:00.
  assert.equal(
    zonedToInstant('2026-10-26', '09:00', 'Europe/Paris'),
    Date.parse('2026-10-26T08:00:00Z'),
  );
  assert.equal(
    zonedToInstant('2026-10-14', '09:00', 'America/Sao_Paulo'),
    Date.parse('2026-10-14T12:00:00Z'),
  );
  assert.deepEqual(localParts(Date.parse('2026-10-14T22:30:00Z'), 'Europe/Paris'), {
    date: '2026-10-15',
    time: '00:30',
  });
  assert.equal(validTimeZone('Mars/Olympus'), 'UTC');
  assert.equal(validTimeZone(undefined), 'UTC');
  assert.equal(nextDate('2026-12-31'), '2027-01-01');
});
