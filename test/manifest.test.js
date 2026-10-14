// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  DEFAULT_FILTER,
  LANGUAGES,
  PRIORITIES,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  WIDGETS,
} from '../src/constants.js';
import { BOUNDS, DEFAULTS, normalizeConfig } from '../src/config.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'provider');
  assert.equal(manifest.location, undefined, 'no house location needed');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-todoist:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['cloud']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
    assert.ok(manifest.config_schema[0].description[lang].length <= 1000, 'section text');
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  assert.match(manifest.config_schema[0].description.en, /not affiliated with Doist/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code; the token is a secret', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields.api_token.type, 'secret');
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  for (const [key, [min, max]] of Object.entries(BOUNDS)) {
    assert.deepEqual([fields[key].min, fields[key].max], [min, max], key);
  }
  assert.deepEqual(
    fields.filter_lang.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    normalizeConfig({
      api_token: ' Bearer abc123 ',
      watch_tasks: 'false',
      poll_minutes: 0,
      due_hour: 30,
      filter_lang: 'xx',
    }),
    { token: 'abc123', watchTasks: false, pollMinutes: 1, dueHour: 23, filterLang: 'en' },
    'a pasted "Bearer", and the bounds',
  );
  for (const link of manifest.config_schema[0].links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(index.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  assert.ok(index.includes('onWidgetAction(WIDGETS.TASKS'));
  for (const trigger of manifest.scene_triggers) {
    const fields = Object.fromEntries(trigger.fields.map((f) => [f.key, f]));
    assert.deepEqual(
      fields.priority.options.map((o) => o.value),
      PRIORITIES,
      trigger.key,
    );
    assert.equal(fields.project.type, 'string', 'compared by equality with the project name');
  }
  const actions = Object.fromEntries(manifest.scene_actions.map((a) => [a.key, a]));
  const field = (action, key) => actions[action].fields.find((f) => f.key === key);
  assert.deepEqual(
    field(SCENE_ACTIONS.ADD, 'priority').options.map((o) => o.value),
    PRIORITIES,
  );
  assert.deepEqual(
    field(SCENE_ACTIONS.ADD, 'due_lang').options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(field(SCENE_ACTIONS.GET, 'filter').default, DEFAULT_FILTER);
});
