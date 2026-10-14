// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  watch_tasks: true,
  poll_minutes: 2,
  due_hour: 9,
  filter_lang: 'en',
};

/** The bounds of the number fields: they MUST match `min` / `max` in the manifest. */
export const BOUNDS = {
  poll_minutes: [1, 60],
  due_hour: [0, 23],
};

const number = (value, key) => {
  const n = Number(value);
  const [min, max] = BOUNDS[key];
  return Number.isFinite(n) && value !== '' && value !== null && value !== undefined
    ? Math.min(max, Math.max(min, Math.round(n)))
    : DEFAULTS[key];
};

export function normalizeConfig(raw = {}) {
  const lang = String(raw.filter_lang ?? DEFAULTS.filter_lang).toLowerCase();
  return {
    /** Sent to Todoist only, in the Authorization header; never logged. */
    token: typeof raw.api_token === 'string' ? raw.api_token.trim().replace(/^Bearer\s+/i, '') : '',
    watchTasks: raw.watch_tasks !== false && raw.watch_tasks !== 'false',
    pollMinutes: number(raw.poll_minutes, 'poll_minutes'),
    dueHour: number(raw.due_hour, 'due_hour'),
    filterLang: LANGUAGES.includes(lang) ? lang : DEFAULTS.filter_lang,
  };
}

/**
 * What restarts the integration when it changes: every key, sorted. A
 * reconnection to Gladys with the same configuration keeps the sync state
 * (no new full sync, the triggers keep their memory).
 */
export function configFingerprint(raw = {}) {
  const value = raw ?? {};
  return JSON.stringify(value, Object.keys(value).sort());
}
