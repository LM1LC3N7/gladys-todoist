// -----------------------------------------------------------------------------
// Tasks dated, sorted, filtered, found and changed (src/tasks.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSync } from '../src/todoist/model.js';
import {
  applyOwnChange,
  dueInfo,
  dueText,
  dueTodayOrBefore,
  findProject,
  findTask,
  fold,
  isLocalFilter,
  isOverdue,
  sortTasks,
  taskLine,
} from '../src/tasks.js';
import { FIXTURE_NOW, IDS, fixture } from './helpers/fakeTodoist.js';

const { store } = mergeSync(undefined, fixture('sync-full.json'), FIXTURE_NOW);
const ctx = { timeZone: 'Europe/Paris', dueHour: 9, now: FIXTURE_NOW, projects: store.projects };
const task = (id) => store.tasks.get(id);
const all = [...store.tasks.values()];

test('when a task is due: a time, a fixed instant, a date at the configured hour', () => {
  const bins = dueInfo(task(IDS.BINS), ctx);
  assert.equal(bins.at, Date.parse('2026-10-14T17:00:00Z'), '19:00 in Paris');
  assert.equal(bins.allDay, false);
  const meeting = dueInfo(task(IDS.MEETING), ctx);
  assert.equal(meeting.at, Date.parse('2026-10-14T08:30:00Z'));
  assert.deepEqual([meeting.date, meeting.time], ['2026-10-14', '10:30'], 'shown in Paris time');
  const bread = dueInfo(task(IDS.BREAD), ctx);
  assert.equal(bread.at, Date.parse('2026-10-14T07:00:00Z'), '09:00 in Paris');
  assert.equal(bread.sortAt, Date.parse('2026-10-13T22:00:00Z'), 'sorted at the start of its day');
  assert.equal(bread.allDay, true);
  assert.equal(dueInfo(task(IDS.READ), ctx), null);
  assert.equal(isOverdue(dueInfo(task(IDS.PLUMBER), ctx), ctx), true, 'yesterday');
  assert.equal(isOverdue(bread, ctx), false, 'a date-only task of today is not overdue');
  assert.equal(isOverdue(meeting, { ...ctx, now: Date.parse('2026-10-14T09:00:00Z') }), true);
});

test('"today | overdue" is evaluated locally, sorted with the overdue on top', () => {
  assert.equal(isLocalFilter('today | overdue'), true);
  assert.equal(isLocalFilter('  Overdue|TODAY '), true);
  assert.equal(isLocalFilter('today'), false);
  assert.equal(isLocalFilter('#Courses'), false);
  const today = sortTasks(dueTodayOrBefore(all, ctx), ctx);
  assert.deepEqual(
    today.map((t) => t.content),
    ['Appeler le plombier', 'Acheter du pain', "Réunion d'équipe", 'Sortir les poubelles'],
  );
  assert.equal(sortTasks(all, ctx).at(-1).due, null, 'the tasks without a date come last');
});

test('a project and a task named loosely (case, accents, a leading #, a part)', () => {
  assert.equal(findProject(store.projects, 'maison').id, IDS.HOME);
  assert.equal(findProject(store.projects, '#COURSES').id, IDS.SHOP);
  assert.equal(findProject(store.projects, 'trav').id, IDS.WORK);
  assert.equal(findProject(store.projects, IDS.WORK).name, 'Travail');
  assert.equal(findProject(store.projects, 'Archive 2025'), undefined);
  assert.equal(findProject(store.projects, ''), undefined);
  const sorted = sortTasks(all, ctx);
  assert.equal(findTask(sorted, "REUNION D'EQUIPE").id, IDS.MEETING);
  assert.equal(findTask(sorted, 'poubelles').id, IDS.BINS);
  assert.equal(findTask(sorted, 'week-end'), undefined, 'an uncompletable task is never closed');
  assert.equal(findTask(sorted, 'nothing like it'), undefined);
  assert.equal(fold('  Équipe   Été '), 'equipe ete');
});

test('the text of a due date and of a task line', () => {
  assert.equal(dueText(dueInfo(task(IDS.BINS), ctx), ctx, 'en'), '19:00');
  assert.equal(dueText(dueInfo(task(IDS.BREAD), ctx), ctx, 'fr'), 'Aujourd’hui');
  assert.equal(dueText(dueInfo(task(IDS.PLUMBER), ctx), ctx, 'en'), 'Yesterday');
  assert.equal(dueText(dueInfo(task(IDS.CANTEEN), ctx), ctx, 'en'), 'Tue 20 Oct');
  assert.equal(
    taskLine(task(IDS.PLUMBER), ctx, 'fr'),
    '• Hier Appeler le plombier (Maison) (en retard)',
  );
  assert.equal(taskLine(task(IDS.READ), ctx, 'en'), "• Lire l'article (Inbox)");
});

test('a change made through Gladys is applied to the store before the next sync', () => {
  const added = { ...task(IDS.BREAD), id: 'new', content: 'Acheter du lait' };
  assert.equal(applyOwnChange(store, { added }).tasks.get('new').content, 'Acheter du lait');
  const closed = applyOwnChange(store, { closed: task(IDS.BREAD) });
  assert.equal(closed.tasks.has(IDS.BREAD), false);
  const recurring = applyOwnChange(store, { closed: task(IDS.BINS) });
  assert.equal(recurring.tasks.get(IDS.BINS).completedCount, 13, 'one more completion');
  assert.equal(store.tasks.get(IDS.BINS).completedCount, 12, 'the store given is untouched');
});
