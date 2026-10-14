// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Todoist.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TodoistApp } from '../src/app.js';
import {
  ACTIONS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  WIDGETS,
  WIDGET_ACTIONS,
} from '../src/constants.js';
import {
  FIXTURE_NOW,
  IDS,
  addInApp,
  change,
  fixture,
  installTodoist,
  json,
  todoistState,
} from './helpers/fakeTodoist.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const TOKEN = 'f00dbabe0123456789abcdef0123456789abcdef';
const CONFIG = { api_token: TOKEN };
const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const outputsOf = (key) =>
  manifest.scene_actions
    .find((a) => a.key === key)
    .outputs.map((o) => o.key)
    .sort();
const variablesOf = (key) =>
  manifest.scene_triggers
    .find((t) => t.key === key)
    .variables.map((v) => v.key)
    .sort();

let todoist;
afterEach(() => todoist?.restore());

async function setup({ config = CONFIG, tweak = () => {} } = {}) {
  const clock = { now: FIXTURE_NOW };
  const state = todoistState({ now: () => clock.now });
  tweak(state);
  todoist = installTodoist(state);
  const gladys = createFakeGladys({ selector: 'todoist', config });
  const timers = createFakeTimers();
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.join(' ')}`),
    ]),
  );
  const app = new TodoistApp({ gladys, logger, now: () => clock.now, timers });
  // What index.js wires.
  gladys.onSceneAction(SCENE_ACTIONS.ADD, (f) => app.addTask(f));
  gladys.onSceneAction(SCENE_ACTIONS.COMPLETE, (f) => app.completeTask(f));
  gladys.onSceneAction(SCENE_ACTIONS.GET, (f) => app.getTasks(f));
  gladys.onWidgetGet(WIDGETS.TASKS, (request) => app.getWidget(request));
  gladys.onWidgetAction(WIDGETS.TASKS, (key, params, ctx) => app.widgetAction(key, params, ctx));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onConfigUpdated((c) => app.configUpdated(c));
  await gladys.connect();
  /** Run the sync timer (`poll`) or the minute tick (`due`). */
  const tick = async (which) => {
    const ms = which === 'due' ? 60_000 : app.config.pollMinutes * 60_000;
    await timers
      .intervals()
      .find((t) => t.ms === ms)
      ?.fn();
  };
  return { app, gladys, timers, clock, state, logs, tick };
}

const closes = () => todoist.calls.filter((c) => /\/close$/.test(c.path)).map((c) => c.path);

test('not configured: the status says so and nothing is sent', async () => {
  const { app, gladys, timers } = await setup({ config: {} });
  await app.start({});
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Collez le jeton d’API/);
  assert.equal(todoist.calls.length, 0);
  assert.equal(timers.intervals().length, 0);
  const widget = (await gladys.fake.widgetGet(WIDGETS.TASKS, { settings: {} })).data.content;
  assert.match(widget.components[1].text.en, /Configure your Todoist API token/);
  assert.equal((await gladys.fake.sceneAction(SCENE_ACTIONS.GET, {})).success, false);
});

test('first start: one full sync, the status, nothing fired, the sync and due timers', async () => {
  const { app, gladys, timers } = await setup();
  await app.start(CONFIG);
  assert.deepEqual(todoist.syncTokens(), ['*']);
  const [sync] = todoist.calls;
  assert.equal(sync.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(sync.form.resource_types, '["items","projects","user"]');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /synced every 2 min/);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'nothing on the first reading');
  assert.deepEqual(
    timers
      .intervals()
      .map((t) => t.ms)
      .sort(),
    [120_000, 60_000],
  );
});

test('tasks added and completed in the app fire their triggers at the next sync', async () => {
  const { app, gladys, clock, state, tick } = await setup();
  await app.start(CONFIG);
  clock.now += 60_000;
  addInApp(state, {
    content: 'Réserver le restaurant',
    project_id: IDS.HOME,
    priority: 3,
    due: null,
    labels: [],
  });
  change(state, IDS.BREAD, { checked: true, completed_count: 1 });
  change(state, IDS.BINS, {
    due: { ...state.items.get(IDS.BINS).due, date: '2026-10-21T19:00:00' },
    completed_count: 13,
  });
  clock.now += 60_000;
  await tick('poll');
  assert.deepEqual(todoist.syncTokens(), ['*', 'tok-1']);
  const events = gladys.fake.sceneEvents;
  assert.deepEqual(
    events.map((e) => [e.key, e.data.content]),
    [
      [SCENE_TRIGGERS.ADDED, 'Réserver le restaurant'],
      [SCENE_TRIGGERS.COMPLETED, 'Sortir les poubelles'],
      [SCENE_TRIGGERS.COMPLETED, 'Acheter du pain'],
    ],
  );
  assert.deepEqual(events[0].data, {
    content: 'Réserver le restaurant',
    project: 'Maison',
    priority: 'p2',
    due: null,
    all_day: false,
    labels: '',
    url: events[0].data.url,
  });
  assert.equal(events[1].data.recurring, true);
  assert.equal(events[2].data.recurring, false);
  // Every key an event carries is a declared variable (the core drops the others).
  for (const event of events) {
    assert.deepEqual(Object.keys(event.data).sort(), variablesOf(event.key), event.key);
  }
  await tick('poll');
  assert.equal(gladys.fake.sceneEvents.length, 3, 'one event per transition');
});

test('"task due" fires once at the due time, a date-only task at the configured hour', async () => {
  const { app, gladys, clock, tick } = await setup();
  await app.start({ ...CONFIG, due_hour: 11 });
  const requests = todoist.calls.length;
  clock.now = Date.parse('2026-10-14T08:30:30Z'); // 10:30 in Paris
  await tick('due');
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.content, e.data.due]),
    [[SCENE_TRIGGERS.DUE, "Réunion d'équipe", '2026-10-14 10:30']],
  );
  assert.deepEqual(
    Object.keys(gladys.fake.sceneEvents[0].data).sort(),
    variablesOf(SCENE_TRIGGERS.DUE),
  );
  await tick('due');
  assert.equal(gladys.fake.sceneEvents.length, 1, 'once');
  clock.now = Date.parse('2026-10-14T09:00:30Z'); // 11:00 in Paris
  await tick('due');
  const bread = gladys.fake.sceneEvents[1];
  assert.equal(bread.data.content, 'Acheter du pain');
  assert.equal(bread.data.all_day, true);
  assert.equal(bread.data.due, '2026-10-14');
  assert.equal(todoist.calls.length, requests, 'the minute tick sends nothing');
});

test('add_task: the fields as Todoist wants them, and no "task added" loop', async () => {
  const { app, gladys, clock, tick } = await setup();
  await app.start(CONFIG);
  const added = await gladys.fake.sceneAction(SCENE_ACTIONS.ADD, {
    content: 'Acheter du lait',
    due_string: 'demain à 18h',
    due_lang: 'fr',
    project: 'courses',
    priority: 'p1',
    labels: 'courses, @urgent, courses',
    quick_add: false,
  });
  assert.equal(added.success, true);
  const post = todoist.calls.find((c) => c.path === '/api/v1/tasks');
  assert.deepEqual(post.json, {
    content: 'Acheter du lait',
    project_id: IDS.SHOP,
    due_string: 'demain à 18h',
    due_lang: 'fr',
    priority: 4,
    labels: ['courses', 'urgent'],
  });
  const outputs = added.data.outputs;
  assert.deepEqual(Object.keys(outputs).sort(), outputsOf(SCENE_ACTIONS.ADD));
  assert.equal(outputs.project, 'Courses');
  assert.equal(outputs.due, '2026-10-15 18:00');
  assert.equal(outputs.url, `https://app.todoist.com/app/task/${outputs.id}`);
  assert.deepEqual(todoist.syncTokens(), ['*', 'tok-1'], 'read back right away');
  assert.ok(gladys.fake.widgetRefreshes.includes(WIDGETS.TASKS));
  clock.now += 120_000;
  await tick('poll');
  assert.equal(gladys.fake.sceneEvents.length, 0, 'a task added through Gladys fires nothing');

  const quick = await gladys.fake.sceneAction(SCENE_ACTIONS.ADD, {
    content: 'Appeler maman demain 18h #Maison p2',
    project: 'ignored',
    quick_add: true,
  });
  assert.equal(quick.success, true);
  assert.deepEqual(todoist.calls.find((c) => c.path === '/api/v1/tasks/quick').json, {
    text: 'Appeler maman demain 18h #Maison p2',
  });
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.ADD, {
    content: 'x',
    project: 'Atlantis',
  });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /The projects are: Inbox, Maison, Courses, Travail/);
});

test('complete_task: named loosely, in a project or a filter; no "task completed" loop', async () => {
  const { app, gladys, clock, tick } = await setup();
  await app.start(CONFIG);
  const bins = await gladys.fake.sceneAction(SCENE_ACTIONS.COMPLETE, { task: 'POUBELLES' });
  assert.deepEqual(bins.data.outputs, {
    done: true,
    content: 'Sortir les poubelles',
    project: 'Maison',
    url: `https://app.todoist.com/app/task/${IDS.BINS}`,
    recurring: true,
  });
  assert.deepEqual(Object.keys(bins.data.outputs).sort(), outputsOf(SCENE_ACTIONS.COMPLETE));
  const bread = await gladys.fake.sceneAction(SCENE_ACTIONS.COMPLETE, {
    task: 'pain',
    project: 'Courses',
  });
  assert.equal(bread.data.outputs.content, 'Acheter du pain');
  const plumber = await gladys.fake.sceneAction(SCENE_ACTIONS.COMPLETE, {
    task: 'plombier',
    filter: '#Maison',
  });
  assert.equal(plumber.data.outputs.done, true);
  assert.equal(todoist.count('GET', /tasks\/filter$/), 1);
  const none = await gladys.fake.sceneAction(SCENE_ACTIONS.COMPLETE, { task: 'repeindre' });
  assert.equal(none.data.outputs.done, false);
  assert.deepEqual(closes(), [
    `/api/v1/tasks/${IDS.BINS}/close`,
    `/api/v1/tasks/${IDS.BREAD}/close`,
    `/api/v1/tasks/${IDS.PLUMBER}/close`,
  ]);
  clock.now += 120_000;
  await tick('poll');
  assert.equal(
    gladys.fake.sceneEvents.length,
    0,
    'the tasks completed through Gladys fire nothing',
  );
});

test('get_tasks: today and overdue from the synced tasks; another filter from Todoist, cached', async () => {
  const { app, gladys, clock } = await setup();
  await app.start(CONFIG);
  const today = await gladys.fake.sceneAction(SCENE_ACTIONS.GET, { filter: 'today | overdue' });
  assert.equal(todoist.count('GET', /tasks\/filter$/), 0, 'evaluated on the synced tasks');
  const outputs = today.data.outputs;
  assert.deepEqual(Object.keys(outputs).sort(), outputsOf(SCENE_ACTIONS.GET));
  assert.equal(outputs.count, 4);
  assert.equal(outputs.overdue_count, 1);
  assert.equal(outputs.next_task, 'Appeler le plombier');
  assert.equal(outputs.next_due, '2026-10-13');
  assert.equal(outputs.next_priority, 'p2');
  assert.equal(
    outputs.list,
    [
      '• Hier Appeler le plombier (Maison) (en retard)',
      '• Aujourd’hui Acheter du pain (Courses)',
      "• 10:30 Réunion d'équipe (Travail)",
      '• 19:00 Sortir les poubelles (Maison)',
    ].join('\n'),
    'in the language of the Todoist account',
  );
  const labelled = await gladys.fake.sceneAction(SCENE_ACTIONS.GET, { filter: '@courses' });
  assert.equal(labelled.data.outputs.count, 1);
  await gladys.fake.sceneAction(SCENE_ACTIONS.GET, { filter: '@courses' });
  assert.equal(todoist.count('GET', /tasks\/filter$/), 1, 'cached a minute');
  clock.now += 61_000;
  await gladys.fake.sceneAction(SCENE_ACTIONS.GET, { filter: '@courses' });
  assert.equal(todoist.count('GET', /tasks\/filter$/), 2);
});

test('the widget: today by default or a project, check off and add from the card', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  const reads = todoist.calls.length;
  const today = (await gladys.fake.widgetGet(WIDGETS.TASKS, { settings: {}, language: 'fr' })).data
    .content;
  assert.deepEqual(validateWidgetContent(today), []);
  assert.equal(today.components[0].text.fr, 'Aujourd’hui');
  assert.equal(today.ttl_seconds, 120);
  assert.equal(todoist.calls.length, reads, 'the watched sync is reused');
  const home = (await gladys.fake.widgetGet(WIDGETS.TASKS, { settings: { project: 'maison' } }))
    .data.content;
  assert.equal(home.components[0].text, 'Maison');

  const one = await gladys.fake.widgetAction(
    WIDGETS.TASKS,
    'complete_1',
    { id: IDS.PLUMBER },
    { settings: {} },
  );
  assert.equal(one.data.message.fr, 'Terminée : Appeler le plombier');
  const picked = await gladys.fake.widgetAction(
    WIDGETS.TASKS,
    WIDGET_ACTIONS.PICK,
    {},
    { settings: {}, values: { task: IDS.BREAD } },
  );
  assert.equal(picked.data.message.en, 'Done: Acheter du pain');
  const again = await gladys.fake.widgetAction(
    WIDGETS.TASKS,
    'complete_2',
    { id: IDS.BREAD },
    { settings: {} },
  );
  assert.match(again.data.message.en, /no longer open/);
  const add = await gladys.fake.widgetAction(
    WIDGETS.TASKS,
    WIDGET_ACTIONS.ADD,
    {},
    { settings: { project: 'Maison' }, values: { content: 'Arroser les plantes', due: 'demain' } },
  );
  assert.equal(add.data.message.fr, 'Ajoutée : Arroser les plantes');
  const post = todoist.calls.find((c) => c.path === '/api/v1/tasks');
  assert.deepEqual(post.json, {
    content: 'Arroser les plantes',
    project_id: IDS.HOME,
    due_string: 'demain',
  });
  assert.deepEqual(closes(), [
    `/api/v1/tasks/${IDS.PLUMBER}/close`,
    `/api/v1/tasks/${IDS.BREAD}/close`,
  ]);
  // An older core drops the form: refused, nothing sent.
  const old = await gladys.fake.widgetAction(WIDGETS.TASKS, WIDGET_ACTIONS.ADD, {}, {});
  assert.match(old.data.message.en, /needs Gladys 5\.2/);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('a refused token: said once, nothing more sent until the configuration changes', async () => {
  const { app, gladys, timers, state } = await setup({
    tweak: (s) => {
      s.fail = () => json(fixture('sync-401.json'), 401, { 'retry-after': '4' });
    },
  });
  await app.start(CONFIG);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API token/);
  assert.equal(timers.intervals().length, 0);
  assert.equal((await gladys.fake.sceneAction(SCENE_ACTIONS.GET, {})).success, false);
  assert.match((await gladys.fake.action(ACTIONS.TEST)).data.message.en, /unauthorized/);
  await app.start(CONFIG); // a reconnection to Gladys
  assert.equal(todoist.calls.length, 1, 'never retried, not even on a reconnection');
  state.fail = () => undefined;
  await gladys.fake.configUpdated({ api_token: 'a-new-token' });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(todoist.calls.at(-1).headers.Authorization, 'Bearer a-new-token');
});

test('a reconnection with the same configuration resumes with an incremental sync', async () => {
  const { app, clock } = await setup();
  await app.start(CONFIG);
  app.stop();
  clock.now += 30_000;
  await app.start(CONFIG);
  await app.configUpdated(CONFIG);
  assert.deepEqual(todoist.syncTokens(), ['*', 'tok-1'], 'no new full sync');
  await app.configUpdated({ ...CONFIG, poll_minutes: 5 });
  assert.deepEqual(todoist.syncTokens(), ['*', 'tok-1', '*']);
  assert.equal(app.config.pollMinutes, 5);
});

test('not watching: nothing in the background, the widget syncs on demand, no trigger', async () => {
  const { app, gladys, timers, clock, state } = await setup();
  await app.start({ ...CONFIG, watch_tasks: false });
  assert.equal(timers.intervals().length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /not watched/);
  await gladys.fake.widgetGet(WIDGETS.TASKS, { settings: {} });
  assert.deepEqual(todoist.syncTokens(), ['*'], 'a fresh sync is reused');
  addInApp(state, { content: 'Nouvelle tâche' });
  clock.now += 31_000;
  const widget = (await gladys.fake.widgetGet(WIDGETS.TASKS, { settings: {} })).data.content;
  assert.equal(widget.ttl_seconds, 300);
  assert.deepEqual(todoist.syncTokens(), ['*', 'tok-1']);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('Todoist down or slowing down: the status says so, the paused loop sends nothing', async () => {
  const { app, gladys, timers, clock, state, tick } = await setup({
    tweak: (s) => {
      s.fail = () => json({ error: 'Service unavailable' }, 503);
    },
  });
  await app.start(CONFIG);
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable: Todoist answered 503/);
  assert.equal(timers.intervals().length, 2, 'the loop keeps going');
  state.fail = () => json({ error: 'Too many requests', error_extra: { retry_after: 300 } }, 429);
  await tick('poll');
  assert.match(gladys.fake.connectionStatus.message.en, /paused for 5 min/);
  const sent = todoist.calls.length;
  clock.now += 120_000;
  await tick('poll');
  assert.equal(todoist.calls.length, sent, 'nothing leaves during the pause');
  state.fail = () => undefined;
  clock.now += 200_000;
  await tick('poll');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(todoist.syncTokens().at(-1), '*', 'the first full sync, at last');
});

test('the test button, and the token in no log, status, event or output', async () => {
  const { app, gladys, clock, state, tick, logs } = await setup();
  await app.start(CONFIG);
  const result = await gladys.fake.action(ACTIONS.TEST);
  assert.match(
    result.data.message.en,
    /7 active tasks in 4 projects; 3 due today, 1 overdue\. Time zone of the account: Europe\/Paris\. Requests in the last 15 minutes: 2\./,
  );
  addInApp(state, { content: 'Encore une' });
  clock.now += 120_000;
  await tick('poll');
  await gladys.fake.sceneAction(SCENE_ACTIONS.GET, {});
  state.fail = () => json(fixture('rest-401.json'), 401);
  await gladys.fake.sceneAction(SCENE_ACTIONS.COMPLETE, { task: 'pain' });
  const seen = JSON.stringify([
    logs,
    gladys.fake.connectionStatuses,
    gladys.fake.sceneEvents,
    gladys.fake.requests,
    gladys.fake.wsMessages,
  ]);
  assert.ok(!seen.includes(TOKEN));
  assert.ok(!seen.includes('0123456789abcdef0123456789abcdef01234567'), 'nor the user token');
  assert.ok(!seen.includes('someone@example.org'), 'nor the email');
});
