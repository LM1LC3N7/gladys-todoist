// -----------------------------------------------------------------------------
// The integration itself: the Todoist account, the synced tasks, the scene
// triggers, the scene actions, the widget and the test button. index.js only
// wires the SDK handlers to it.
//
// Pace: while the tasks are watched (default), one incremental sync every
// `poll_minutes` (2 by default) and right after a change made through
// Gladys; the "task due" check runs every minute on the synced tasks and
// makes no request. Without watching, nothing runs in the background: the
// widget and the scene actions sync when they need it. Every request is
// counted against the published limits (src/todoist/client.js).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { configFingerprint, normalizeConfig } from './config.js';
import {
  DEFAULT_FILTER,
  DUE_TICK,
  FILTER_TTL,
  LANGUAGES,
  MAX_LIST_TEXT,
  READING_MAX_AGE,
  SYNC_RESOURCES,
  WIDGETS,
  WIDGET_ACTIONS,
  isCompleteKey,
} from './constants.js';
import { T } from './i18n.js';
import {
  applyOwnChange,
  dueInfo,
  dueLabel,
  dueTodayOrBefore,
  findProject,
  findTask,
  isLocalFilter,
  isOverdue,
  projectName,
  sortTasks,
  taskLine,
  todayOf,
} from './tasks.js';
import { validTimeZone } from './time.js';
import { TodoistClient, TodoistError } from './todoist/client.js';
import { apiPriority, emptyStore, mergeSync, taskOf } from './todoist/model.js';
import { dueBaseline, dueEvents, pruneAnnounced, syncEvents } from './triggers.js';
import { messageWidget, tasksWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

/** Filters remembered at most (one per widget or scene typically). */
const MAX_CACHED_FILTERS = 20;

/** What the widget shows of the store: a change of it deserves a nudge. */
const signature = (store) =>
  store
    ? JSON.stringify(
        [...store.tasks.values()]
          .map((t) => [t.id, t.content, t.priority, t.projectId, t.due])
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      )
    : '';

const toast = (text) =>
  Object.fromEntries(Object.entries(text).map(([lang, value]) => [lang, value.slice(0, 200)]));

/** Whole lines up to `max` characters, "…" when some were left out. */
function joinLines(lines, max) {
  const kept = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > max - 2) {
      kept.push('…');
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  return kept.join('\n');
}

export class TodoistApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'todoist' }),
    now = Date.now,
    timers = defaultTimers,
    clientFactory = (options) => new TodoistClient(options),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.config = normalizeConfig();
    this.fingerprint = undefined;
    this.client = undefined;
    /** The synced account (see emptyStore), undefined before the first sync. */
    this.store = undefined;
    /** "task|instant" -> instant: the dues already announced. */
    this.announced = new Map();
    /** "lang|filter" -> { at, tasks }: the filters Todoist evaluated. */
    this.filters = new Map();
    this.syncTimer = undefined;
    this.dueTimer = undefined;
    this.refreshing = undefined;
    this.lastStatus = undefined;
    this.generation = 0;
    this.lock = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    const fingerprint = configFingerprint(raw);
    const same = fingerprint === this.fingerprint;
    if (same && this.client?.refused) {
      // A refused token is not tried again on a mere reconnection to Gladys.
      await this.setStatus(false, T.badToken);
      return;
    }
    // A reconnection to Gladys with the same configuration resumes: the next
    // sync is incremental and the triggers keep their memory.
    const resume = same && this.store !== undefined;
    this.fingerprint = fingerprint;
    this.config = normalizeConfig(raw);
    if (!resume) {
      this.store = undefined;
      this.announced = new Map();
      this.filters.clear();
      this.client = this.config.token
        ? this.clientFactory({ token: this.config.token, now: this.now })
        : undefined;
    }
    if (!this.client) {
      await this.setStatus(false, T.notConfigured);
      return;
    }
    try {
      await this.exclusive(() => this.syncNow());
      await this.reportOk();
    } catch (err) {
      await this.reportError(err);
      if (err.final) {
        return;
      }
    }
    if (generation !== this.generation || !this.config.watchTasks) {
      return;
    }
    this.syncTimer = this.timers.setInterval(
      () => this.refresh(),
      this.config.pollMinutes * 60_000,
    );
    this.dueTimer = this.timers.setInterval(
      () => this.checkDue().catch((err) => this.logger.warn(`Due check failed: ${err.message}`)),
      DUE_TICK,
    );
  }

  /** A configuration update: only a real change restarts (and resets the sync). */
  async configUpdated(raw = {}) {
    if (configFingerprint(raw) === this.fingerprint) {
      return;
    }
    this.logger.info('Configuration updated: restarting');
    await this.start(raw);
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.syncTimer);
    this.timers.clearInterval(this.dueTimer);
    this.syncTimer = undefined;
    this.dueTimer = undefined;
  }

  /** Todoist calls never overlap: a scene action waits for the sync in progress. */
  exclusive(fn) {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => {});
    return run;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async reportOk() {
    await this.setStatus(true, T.ok(this.config.watchTasks, this.config.pollMinutes));
  }

  async reportError(err) {
    const minutes = Math.max(1, Math.ceil(((err.retryAt ?? 0) - this.now()) / 60_000));
    if (err instanceof TodoistError && err.final) {
      // A refused token is not retried: the user fixes the configuration.
      this.logger.warn('Todoist refused the API token');
      this.timers.clearInterval(this.syncTimer);
      this.timers.clearInterval(this.dueTimer);
      this.syncTimer = undefined;
      this.dueTimer = undefined;
      await this.setStatus(false, T.badToken);
      return;
    }
    this.logger.warn(`Todoist: ${err.message}`);
    if (err instanceof TodoistError && err.code === 'rate_limited') {
      await this.setStatus(false, T.paused(minutes));
    } else if (err instanceof TodoistError && err.code === 'budget') {
      await this.setStatus(false, T.budget(minutes));
    } else {
      await this.setStatus(false, T.unreachable(err.message));
    }
  }

  requireClient() {
    if (!this.client) {
      throw new Error(T.notConfigured.en);
    }
    return this.client;
  }

  /** What a task needs to be read: the time zone of the account, the due hour, now. */
  ctx() {
    const store = this.store ?? emptyStore();
    return {
      timeZone: validTimeZone(store.user.timeZone),
      dueHour: this.config.dueHour,
      now: this.now(),
      projects: store.projects,
    };
  }

  /** The "task due" window: a poll interval and a tick (a task synced a little late still fires). */
  grace() {
    return this.config.pollMinutes * 60_000 + DUE_TICK;
  }

  // --- Sync ----------------------------------------------------------------------------

  /** One sync: incremental once a token is known, full the first time. */
  async syncNow() {
    const generation = this.generation;
    const previous = this.store;
    const client = this.requireClient();
    let answer;
    try {
      answer = await client.sync(previous?.syncToken ?? '*', SYNC_RESOURCES);
    } catch (err) {
      // A sync token Todoist no longer accepts: start over with a full sync,
      // still compared with what the store had.
      if (previous && err instanceof TodoistError && err.code === 'bad_request') {
        this.logger.warn(`Todoist refused the sync token (${err.tag || err.code}): full sync`);
        answer = await client.sync('*', SYNC_RESOURCES);
      } else {
        throw err;
      }
    }
    if (generation !== this.generation) {
      return; // stopped meanwhile: the next start syncs again
    }
    const { store, changes } = mergeSync(previous, answer, this.now());
    this.store = store;
    const ctx = this.ctx();
    if (!previous) {
      this.announced = dueBaseline(store.tasks.values(), ctx);
    } else if (this.config.watchTasks) {
      await this.publish(syncEvents(previous, changes, ctx), generation);
      await this.checkDue();
    }
    if (signature(previous) !== signature(store)) {
      this.gladys.requestWidgetRefresh(WIDGETS.TASKS);
    }
  }

  refresh() {
    if (!this.refreshing) {
      this.refreshing = this.exclusive(() => this.syncNow())
        .then(() => this.reportOk())
        .catch((err) => this.reportError(err))
        .finally(() => {
          this.refreshing = undefined;
        });
    }
    return this.refreshing;
  }

  /** The store when young enough, else synced first. */
  async freshStore(maxAge = READING_MAX_AGE) {
    if (!this.store || this.now() - this.store.syncedAt >= maxAge) {
      await this.syncNow();
    }
    if (!this.store) {
      // The integration stopped during the sync (Gladys disconnected).
      throw new Error('Todoist is not synced yet');
    }
    return this.store;
  }

  /** How old a store the widget accepts: while watching, the poll keeps it fresh. */
  widgetAge() {
    return this.config.watchTasks
      ? this.config.pollMinutes * 60_000 + READING_MAX_AGE
      : READING_MAX_AGE;
  }

  async publish(events, generation) {
    for (const event of events) {
      if (generation !== this.generation) {
        return;
      }
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
  }

  /** The minute tick: the dues the clock just crossed. No request. */
  async checkDue() {
    if (!this.store || !this.config.watchTasks) {
      return;
    }
    const ctx = this.ctx();
    const grace = this.grace();
    const { events, marks } = dueEvents(this.store.tasks.values(), ctx, {
      grace,
      announced: this.announced,
    });
    for (const [key, at] of marks) {
      this.announced.set(key, at);
    }
    pruneAnnounced(this.announced, ctx.now, grace);
    await this.publish(events, this.generation);
  }

  /**
   * A change made through Gladys: applied to the store first (it fires
   * nothing), then read back right away so the widget shows Todoist's truth.
   */
  async ownChange(change) {
    this.store = applyOwnChange(this.store ?? emptyStore(), change);
    this.filters.clear();
    try {
      await this.syncNow();
    } catch (err) {
      this.logger.warn(`Reading Todoist back failed: ${err.message}`);
    }
    this.gladys.requestWidgetRefresh(WIDGETS.TASKS);
  }

  // --- Projects and task lists -----------------------------------------------------------

  /** The project a scene or the widget names; a project created minutes ago syncs first. */
  async projectFor(query) {
    let project = findProject(this.store.projects, query);
    if (!project && this.now() - this.store.syncedAt >= READING_MAX_AGE) {
      await this.syncNow();
      project = findProject(this.store.projects, query);
    }
    if (!project) {
      const names = [...this.store.projects.values()].map((p) => p.name);
      throw new Error(T.unknownProject(String(query), names).en);
    }
    return project;
  }

  /** A filter Todoist evaluates, cached a minute per filter. */
  async remoteFilter(query) {
    const key = `${this.config.filterLang}|${query}`;
    const cached = this.filters.get(key);
    if (cached && this.now() - cached.at < FILTER_TTL) {
      return cached.tasks;
    }
    const tasks = await this.requireClient().filter(query, this.config.filterLang);
    this.filters.delete(key);
    this.filters.set(key, { at: this.now(), tasks });
    if (this.filters.size > MAX_CACHED_FILTERS) {
      this.filters.delete(this.filters.keys().next().value);
    }
    return tasks;
  }

  /**
   * The tasks a widget or a scene asks for, sorted: those of a project, those
   * of a filter (default "today | overdue", evaluated on the synced tasks), or
   * every active task (`all`).
   */
  async tasksFor({ project, filter, all = false }, maxAge) {
    await this.freshStore(maxAge);
    const active = [...this.store.tasks.values()];
    if (String(project ?? '').trim()) {
      const found = await this.projectFor(project);
      const ctx = this.ctx();
      const tasks = active.filter((t) => t.projectId === found.id);
      return { tasks: sortTasks(tasks, ctx), ctx, project: found };
    }
    const query = String(filter ?? '').trim();
    if (!query && all) {
      const ctx = this.ctx();
      return { tasks: sortTasks(active, ctx), ctx };
    }
    const wanted = query || DEFAULT_FILTER;
    const tasks = isLocalFilter(wanted)
      ? dueTodayOrBefore(active, this.ctx())
      : await this.remoteFilter(wanted);
    const ctx = this.ctx();
    return { tasks: sortTasks(tasks, ctx), ctx, query: wanted };
  }

  // --- Scene actions -------------------------------------------------------------------

  /** "Add a task": the structured fields, or the text through Quick Add. */
  addTask(fields = {}) {
    return this.exclusive(async () => {
      const client = this.requireClient();
      const content = String(fields.content ?? '').trim();
      if (!content) {
        throw new Error('No task to add');
      }
      await this.freshStore(this.widgetAge());
      let raw;
      if (fields.quick_add === true || fields.quick_add === 'true') {
        raw = await client.quickAdd(content);
      } else {
        const body = { content };
        if (String(fields.project ?? '').trim()) {
          body.project_id = (await this.projectFor(fields.project)).id;
        }
        const due = String(fields.due_string ?? '').trim();
        if (due) {
          body.due_string = due;
          if (LANGUAGES.includes(fields.due_lang)) {
            body.due_lang = fields.due_lang;
          }
        }
        const priority = apiPriority(fields.priority);
        if (priority) {
          body.priority = priority;
        }
        const labels = String(fields.labels ?? '')
          .split(',')
          .map((label) => label.trim().replace(/^@/, ''))
          .filter(Boolean);
        if (labels.length > 0) {
          body.labels = [...new Set(labels)];
        }
        raw = await client.addTask(body);
      }
      if (raw?.id === undefined || raw?.id === null) {
        throw new Error('Todoist answered without the new task');
      }
      const task = taskOf(raw);
      await this.ownChange({ added: task });
      const ctx = this.ctx();
      this.logger.info('Task added to Todoist');
      return {
        id: task.id,
        url: task.url,
        content: task.content,
        project: projectName(task, ctx),
        due: dueLabel(dueInfo(task, ctx)),
      };
    });
  }

  /** "Complete a task": the task named (folded), in a project, a filter or anywhere. */
  completeTask(fields = {}) {
    return this.exclusive(async () => {
      const client = this.requireClient();
      const query = String(fields.task ?? '').trim();
      if (!query) {
        throw new Error('No task given');
      }
      const { tasks, ctx } = await this.tasksFor(
        { project: fields.project, filter: fields.filter, all: true },
        READING_MAX_AGE,
      );
      const task = findTask(tasks, query);
      if (!task) {
        return { done: false, content: query, project: null, url: null, recurring: false };
      }
      await client.closeTask(task.id);
      await this.ownChange({ closed: task });
      this.logger.info('Task completed in Todoist');
      return {
        done: true,
        content: task.content,
        project: projectName(task, ctx),
        url: task.url,
        recurring: task.due?.recurring === true,
      };
    });
  }

  /** "Get tasks": the count, the list as text, the next task. */
  getTasks(fields = {}) {
    return this.exclusive(async () => {
      this.requireClient();
      const { tasks, ctx } = await this.tasksFor({ filter: fields.filter }, READING_MAX_AGE);
      const language = this.store.user.lang === 'fr' ? 'fr' : 'en';
      const next = tasks[0];
      const info = next ? dueInfo(next, ctx) : null;
      return {
        count: tasks.length,
        overdue_count: tasks.filter((t) => isOverdue(dueInfo(t, ctx), ctx)).length,
        list: joinLines(
          tasks.map((t) => taskLine(t, ctx, language)),
          MAX_LIST_TEXT,
        ),
        next_task: next?.content ?? null,
        next_due: dueLabel(info),
        next_project: next ? projectName(next, ctx) : null,
        next_priority: next?.priority ?? null,
        next_url: next?.url ?? null,
      };
    });
  }

  // --- Dashboard widget ----------------------------------------------------------------

  async getWidget({ settings = {}, language } = {}) {
    if (!this.client) {
      return messageWidget(T.widget.notConfigured);
    }
    const lang = language === 'fr' ? 'fr' : 'en';
    try {
      return await this.exclusive(async () => {
        const project = String(settings.project ?? '').trim();
        const {
          tasks,
          ctx,
          query,
          project: found,
        } = await this.tasksFor(
          project ? { project } : { filter: settings.filter },
          this.widgetAge(),
        );
        const title = found ? found.name : isLocalFilter(query) ? T.widget.today : query;
        return tasksWidget({
          title,
          tasks,
          ctx,
          language: lang,
          showProject: !found,
          ttl: this.config.watchTasks ? this.config.pollMinutes * 60 : 300,
        });
      });
    } catch (err) {
      return messageWidget(T.widget.failed(err.message), { ttl: 60 });
    }
  }

  async widgetAction(actionKey, params = {}, { settings = {}, values } = {}) {
    if (!this.client) {
      return T.widget.notConfigured;
    }
    try {
      if (isCompleteKey(actionKey)) {
        return toast(await this.closeById(params?.id));
      }
      // An older core drops the form and relays the tap without values.
      if (!values) {
        return T.widget.needsForm;
      }
      if (actionKey === WIDGET_ACTIONS.PICK) {
        return toast(await this.closeById(values.task));
      }
      if (actionKey === WIDGET_ACTIONS.ADD) {
        const added = await this.addTask({
          content: values.content,
          due_string: values.due,
          project: settings.project,
        });
        return toast(T.widget.added(added.content));
      }
      return undefined;
    } catch (err) {
      return toast(T.widget.failed(err.message));
    }
  }

  /** Close the task of a widget button (its id comes from our own content). */
  closeById(taskId) {
    return this.exclusive(async () => {
      const client = this.requireClient();
      await this.freshStore(READING_MAX_AGE);
      const task = this.store.tasks.get(String(taskId ?? ''));
      if (!task || task.uncompletable) {
        return T.widget.gone;
      }
      await client.closeTask(task.id);
      await this.ownChange({ closed: task });
      return T.widget.done(task.content);
    });
  }

  // --- Configuration screen button ------------------------------------------------------

  async testConnection() {
    if (!this.client) {
      return T.notConfigured;
    }
    try {
      return await this.exclusive(async () => {
        await this.syncNow();
        const ctx = this.ctx();
        const tasks = [...this.store.tasks.values()];
        const today = todayOf(ctx);
        const due = dueTodayOrBefore(tasks, ctx);
        await this.reportOk();
        return T.testOk({
          tasks: tasks.length,
          projects: this.store.projects.size,
          today: due.filter((t) => dueInfo(t, ctx).date === today).length,
          overdue: due.filter((t) => isOverdue(dueInfo(t, ctx), ctx)).length,
          timeZone: ctx.timeZone,
          requests: this.client.usage().requests,
        });
      });
    } catch (err) {
      await this.reportError(err);
      return T.testFailed(err.code ?? 'error', err.message);
    }
  }
}
