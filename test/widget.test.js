// -----------------------------------------------------------------------------
// The "Todoist tasks" widget (src/widget.js): every content passes the SDK's
// own validation, so what ships is what the core renders.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIDGET_COLORS, validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_ACTIONS } from '../src/constants.js';
import { mergeSync } from '../src/todoist/model.js';
import { dueTodayOrBefore, sortTasks } from '../src/tasks.js';
import { messageWidget, tasksWidget } from '../src/widget.js';
import { FIXTURE_NOW, IDS, fixture } from './helpers/fakeTodoist.js';

const { store } = mergeSync(undefined, fixture('sync-full.json'), FIXTURE_NOW);
const ctx = { timeZone: 'Europe/Paris', dueHour: 9, now: FIXTURE_NOW, projects: store.projects };
const all = sortTasks([...store.tasks.values()], ctx);
const buttons = (content) => content.components.filter((c) => c.type === 'button');

test('four tasks: rows with priority colour, due time and overdue mark; 2 buttons, a form, Add', () => {
  const tasks = sortTasks(dueTodayOrBefore(all, ctx), ctx);
  const content = tasksWidget({ title: { en: 'Today', fr: 'Aujourd’hui' }, tasks, ctx });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.ttl_seconds, 120);
  assert.deepEqual(content.components[1].text, {
    en: '4 tasks · 1 overdue',
    fr: '4 tâches · 1 en retard',
  });
  const [plumber, bread, meeting, bins] = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(plumber, {
    label: 'Appeler le plombier',
    value: 'Overdue · Yesterday · Maison',
    icon: 'alert-circle',
    color: WIDGET_COLORS.WARNING,
  });
  assert.equal(bread.value, 'Today · Courses');
  assert.equal(bread.icon, 'calendar');
  assert.equal(bread.color, WIDGET_COLORS.NEUTRAL);
  assert.equal(meeting.value, '10:30 · Travail');
  assert.equal(meeting.color, WIDGET_COLORS.INFO);
  assert.equal(bins.color, WIDGET_COLORS.DANGER);
  const [first, second, pick, add] = buttons(content);
  assert.deepEqual(first.action, { key: 'complete_1', params: { id: IDS.PLUMBER }, confirm: true });
  assert.deepEqual(second.action.key, 'complete_2', 'one key per button');
  assert.equal(second.action.params.id, IDS.BREAD);
  assert.equal(pick.action.key, WIDGET_ACTIONS.PICK);
  assert.equal(pick.action.fields[0].options.length, 4);
  assert.equal(pick.action.fields[0].default, IDS.PLUMBER);
  assert.equal(add.action.key, WIDGET_ACTIONS.ADD);
  assert.deepEqual(
    add.action.fields.map((f) => f.key),
    ['content', 'due'],
  );
});

test('up to three tasks: one check-off button each; a heading is never offered', () => {
  const home = all.filter((t) => t.projectId === IDS.HOME);
  const content = tasksWidget({
    title: 'Maison',
    tasks: home,
    ctx,
    language: 'fr',
    showProject: false,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.equal(rows.length, 4, 'the heading is listed');
  assert.equal(rows[0].value, 'En retard · Hier', 'no project name in a project widget');
  assert.deepEqual(
    buttons(content).map((b) => b.action.params?.id ?? b.action.key),
    [IDS.PLUMBER, IDS.BINS, IDS.CANTEEN, WIDGET_ACTIONS.ADD],
  );
});

test('more than ten tasks: nine rows and a "more" row; nothing to do: a message and Add', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({
    ...all[0],
    id: `t${i}`,
    content: `Tâche ${i} avec un texte assez long pour être coupé au bon endroit`,
  }));
  const content = tasksWidget({ title: 'x'.repeat(60), tasks: many, ctx, ttl: 10_000 });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.ttl_seconds, 3600);
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[9].label, { en: '+ 5 more', fr: '+ 5 de plus' });
  assert.equal(rows[0].label.length, 40);
  assert.equal(buttons(content).length, 4);

  const empty = tasksWidget({ title: 'Courses', tasks: [], ctx });
  assert.deepEqual(validateWidgetContent(empty), []);
  assert.deepEqual(empty.components[1].text, { en: 'Nothing to do', fr: 'Rien à faire' });
  assert.equal(buttons(empty).length, 1);
  assert.deepEqual(validateWidgetContent(messageWidget({ en: 'Oops', fr: 'Oups' })), []);
});
