// -----------------------------------------------------------------------------
// Readings -> scene events (src/triggers.js): one event per transition,
// nothing on the first reading.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TRIGGERS } from '../src/constants.js';
import { mergeSync } from '../src/todoist/model.js';
import { dueBaseline, dueEvents, pruneAnnounced, syncEvents } from '../src/triggers.js';
import { FIXTURE_NOW, IDS, fixture } from './helpers/fakeTodoist.js';

const full = () => fixture('sync-full.json');
const raw = (id) => full().items.find((i) => i.id === id);
const first = mergeSync(undefined, full(), FIXTURE_NOW).store;
const ctxAt = (now) => ({ timeZone: 'Europe/Paris', dueHour: 9, now, projects: first.projects });

const incremental = (items, now = FIXTURE_NOW + 120_000) =>
  mergeSync(first, { full_sync: false, sync_token: 'tok-2', items }, now);

test('the first reading fires nothing', () => {
  const { changes } = mergeSync(undefined, full(), FIXTURE_NOW);
  assert.deepEqual(syncEvents(undefined, changes, ctxAt(FIXTURE_NOW)), []);
});

test('a task added in the app fires "task added" with its variables', () => {
  const item = {
    ...fixture('task-created.json'),
    id: 'fresh',
    added_at: new Date(FIXTURE_NOW + 60_000).toISOString(),
  };
  const { changes } = incremental([item]);
  const events = syncEvents(first, changes, ctxAt(FIXTURE_NOW + 120_000));
  assert.deepEqual(events, [
    {
      key: SCENE_TRIGGERS.ADDED,
      data: {
        content: 'Acheter du lait',
        project: 'Courses',
        priority: 'p1',
        due: '2026-10-15 18:00',
        all_day: false,
        labels: 'courses, urgent',
        url: 'https://app.todoist.com/app/task/fresh',
      },
    },
  ]);
});

test('a reopened task, or one of an unarchived project, is not "added"', () => {
  const old = { ...fixture('task-created.json'), id: 'old', added_at: '2026-09-01T10:00:00Z' };
  const { changes } = incremental([old]);
  assert.deepEqual(syncEvents(first, changes, ctxAt(FIXTURE_NOW)), []);
});

test('checked off, recurring moved to its next date, deleted', () => {
  const { changes } = incremental([
    { ...raw(IDS.BREAD), checked: true, completed_count: 1 },
    {
      ...raw(IDS.BINS),
      due: { ...raw(IDS.BINS).due, date: '2026-10-21T19:00:00' },
      completed_count: 13,
    },
    { ...raw(IDS.PLUMBER), is_deleted: true },
    { ...raw(IDS.CANTEEN), due: { ...raw(IDS.CANTEEN).due, date: '2026-10-22' } },
  ]);
  const events = syncEvents(first, changes, ctxAt(FIXTURE_NOW));
  assert.deepEqual(
    events.map((e) => [e.key, e.data.content, e.data.recurring]),
    [
      [SCENE_TRIGGERS.COMPLETED, 'Acheter du pain', false],
      [SCENE_TRIGGERS.COMPLETED, 'Sortir les poubelles', true],
    ],
    'a deletion and a postponed date fire nothing',
  );
  assert.equal(events[1].data.due, '2026-10-14 19:00', 'the occurrence completed, not the next');
});

test('a bulk import fires 20 "task added" at most', () => {
  const now = new Date(FIXTURE_NOW + 60_000).toISOString();
  const items = Array.from({ length: 30 }, (_, i) => ({
    ...fixture('task-created.json'),
    id: `bulk${i}`,
    added_at: now,
  }));
  const { changes } = incremental(items);
  assert.equal(syncEvents(first, changes, ctxAt(FIXTURE_NOW)).length, 20);
});

test('"task due" fires once when the clock crosses the due time', () => {
  const tasks = [...first.tasks.values()];
  const announced = dueBaseline(tasks, ctxAt(FIXTURE_NOW));
  // At 10:00 in Paris: yesterday's plumber and today's bread (09:00) are past.
  assert.equal(announced.size, 2);
  const grace = 3 * 60_000;
  const before = dueEvents(tasks, ctxAt(Date.parse('2026-10-14T08:29:00Z')), {
    grace,
    announced,
  });
  assert.deepEqual(before.events, []);
  const at = Date.parse('2026-10-14T08:30:20Z');
  const crossed = dueEvents(tasks, ctxAt(at), { grace, announced });
  assert.deepEqual(
    crossed.events.map((e) => [e.key, e.data.content, e.data.due, e.data.project]),
    [[SCENE_TRIGGERS.DUE, "Réunion d'équipe", '2026-10-14 10:30', 'Travail']],
  );
  for (const [key, value] of crossed.marks) {
    announced.set(key, value);
  }
  assert.deepEqual(dueEvents(tasks, ctxAt(at + 60_000), { grace, announced }).events, []);
  pruneAnnounced(announced, at + 10 * 60_000, grace);
  assert.equal(announced.size, 0, 'past the window, nothing to remember');
});

test('"task due" skips a task created after its due time, and dues too old', () => {
  const late = mergeSync(
    first,
    {
      items: [
        {
          ...fixture('task-created.json'),
          id: 'late',
          due: { date: '2026-10-14T09:55:00', is_recurring: false, string: '' },
          added_at: '2026-10-14T07:58:00Z',
        },
      ],
    },
    FIXTURE_NOW,
  ).store;
  const tasks = [...late.tasks.values()];
  const result = dueEvents(tasks, ctxAt(FIXTURE_NOW), { grace: 3 * 60_000, announced: new Map() });
  assert.deepEqual(
    result.events.map((e) => e.data.content),
    [],
    'the late task was created after 09:55; the bread (09:00) is out of the window',
  );
});
