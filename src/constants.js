// -----------------------------------------------------------------------------
// Constants of the Todoist integration: endpoints, pacing, limits and the
// manifest keys. Every Todoist field name lives in src/todoist/.
// -----------------------------------------------------------------------------

/** The Todoist API v1 (the REST v2 and Sync v9 answer 410 Gone since 2026). */
export const TODOIST_API_URL = 'https://api.todoist.com/api/v1/';
/** The documented web address of a task (migration guide, "Task URLs"). */
export const TASK_URL = 'https://app.todoist.com/app/task/';

/** Identifies the integration on every request. */
export const USER_AGENT = 'gladys-todoist/0.1 (+https://github.com/LM1LC3N7/gladys-todoist)';
/** Todoist's own processing timeout for a standard request is 15 s. */
export const HTTP_TIMEOUT = 15_000;

/**
 * The published limits ("Request limits"), per user and per 15 minutes:
 * 1000 partial (incremental) sync requests and 100 full syncs. The REST
 * endpoints publish no figure of their own: they are counted in the same
 * window. The integration keeps to half of each, the rest stays for the
 * user's other apps and scripts sharing the account.
 */
export const RATE_LIMITS = {
  WINDOW: 15 * 60_000,
  PUBLISHED_REQUESTS: 1000,
  PUBLISHED_FULL_SYNCS: 100,
  REQUESTS: 500,
  FULL_SYNCS: 50,
};
/** A 429 without `retry_after` pauses every call this long. */
export const RATE_LIMIT_PAUSE = 60_000;
/** Longest pause a `retry_after` can impose (a bogus value cannot freeze the integration). */
export const MAX_PAUSE = 15 * 60_000;

/** What the incremental sync reads: the tasks, the projects, the time zone of the account. */
export const SYNC_RESOURCES = ['items', 'projects', 'user'];
/** Page size of the paginated endpoints (Todoist: 50 by default, 200 at most). */
export const PAGE_LIMIT = 200;
/** A filter is read on at most this many pages (1000 tasks). */
export const MAX_PAGES = 5;

/** The local "task due" check, every minute: it makes no request. */
export const DUE_TICK = 60_000;
/** A widget or a scene action reuses a sync younger than this. */
export const READING_MAX_AGE = 30_000;
/** The answer of a filter Todoist evaluates is reused this long (per filter). */
export const FILTER_TTL = 60_000;
/**
 * A task first seen by an incremental sync counts as "added" only when Todoist
 * created it after the previous sync, minus this margin (clock skew): a
 * reopened task or the tasks of an unarchived project are not new.
 */
export const ADDED_MARGIN = 10 * 60_000;

/** The filter of the widget and of "get tasks" when none is typed. */
export const DEFAULT_FILTER = 'today | overdue';

/** Longest string a scene event carries (the core caps them at 1000). */
export const MAX_EVENT_TEXT = 1000;
/** Events of one kind fired by one reading at most (a template import adds 50 tasks). */
export const MAX_EVENTS_PER_READING = 20;
/** Longest text of the `list` output of "get tasks". */
export const MAX_LIST_TEXT = 2000;
/** Rows of the widget status list (the vocabulary allows 10). */
export const WIDGET_ROWS = 10;
/** Options of the widget "Check off…" form. */
export const WIDGET_PICK_OPTIONS = 50;

/** The priorities as the Todoist apps show them (p1 = urgent; the API says 4). */
export const PRIORITIES = ['p1', 'p2', 'p3', 'p4'];
/** The languages Todoist parses due dates (and filters) in. */
export const LANGUAGES = [
  'en',
  'fr',
  'de',
  'es',
  'it',
  'nl',
  'pt',
  'da',
  'sv',
  'nb',
  'fi',
  'pl',
  'ru',
  'ja',
  'ko',
  'zh',
  'tw',
];

/** Manifest keys (forever: stored in user scenes and dashboards). */
export const ACTIONS = { TEST: 'test_connection' };
export const SCENE_ACTIONS = { ADD: 'add_task', COMPLETE: 'complete_task', GET: 'get_tasks' };
export const SCENE_TRIGGERS = {
  DUE: 'task_due',
  ADDED: 'task_added',
  COMPLETED: 'task_completed',
};
export const WIDGETS = { TASKS: 'tasks' };
/**
 * The keys of the widget buttons (stored nowhere, but kept stable anyway).
 * The core wants one key per button: the check-off buttons are numbered
 * (`complete_1` to `complete_3`), the task id travels in their params.
 */
export const WIDGET_ACTIONS = { ADD: 'add', COMPLETE: 'complete', PICK: 'complete_pick' };
export const completeKey = (n) => `${WIDGET_ACTIONS.COMPLETE}_${n}`;
export const isCompleteKey = (key) => /^complete_[1-3]$/.test(String(key));
