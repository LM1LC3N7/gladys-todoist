// -----------------------------------------------------------------------------
// Tasks looked up, dated, sorted, filtered and changed. Pure.
//
// `ctx` is what a task needs to be read: { timeZone, dueHour, now, projects }
// where `projects` is the Map id -> project of the store. A date-only task is
// "due" at `dueHour` (the configuration) in the time zone of the account.
// -----------------------------------------------------------------------------

import { MAX_EVENT_TEXT, PRIORITIES } from './constants.js';
import { localParts, nextDate, zonedToInstant } from './time.js';

const pad = (n) => String(n).padStart(2, '0');
export const bounded = (text, max = MAX_EVENT_TEXT) => String(text ?? '').slice(0, max);

/** Lowercase, no accents, single spaces: how names are compared. */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * When a task is due: { at, sortAt, date, time, allDay }, null without a due
 * date. `at` is the instant of the "task due" trigger, `sortAt` the one the
 * lists sort on (a date-only task comes first in its day).
 */
export function dueInfo(task, ctx) {
  const due = task?.due;
  if (!due) {
    return null;
  }
  if (due.instant !== null) {
    const local = localParts(due.instant, ctx.timeZone);
    return { at: due.instant, sortAt: due.instant, ...local, allDay: false };
  }
  if (due.time) {
    const at = zonedToInstant(due.date, due.time, ctx.timeZone);
    return { at, sortAt: at, date: due.date, time: due.time, allDay: false };
  }
  return {
    at: zonedToInstant(due.date, `${pad(ctx.dueHour)}:00`, ctx.timeZone),
    sortAt: zonedToInstant(due.date, '00:00', ctx.timeZone),
    date: due.date,
    time: null,
    allDay: true,
  };
}

/** Today in the time zone of the account ("2026-10-14"). */
export const todayOf = (ctx) => localParts(ctx.now, ctx.timeZone).date;

/** Overdue as the apps show it: a past date, or a time already gone today. */
export function isOverdue(info, ctx) {
  if (!info) {
    return false;
  }
  return info.allDay ? info.date < todayOf(ctx) : info.at < ctx.now;
}

/** "2026-10-14 19:00" or "2026-10-14": the `due` variable of the events. */
export function dueLabel(info) {
  if (!info) {
    return null;
  }
  return info.time ? `${info.date} ${info.time}` : info.date;
}

export function projectName(task, ctx) {
  return ctx.projects?.get(task.projectId)?.name ?? '';
}

/** Due first (overdue on top), then by priority, then in the project order. */
export function sortTasks(tasks, ctx) {
  const key = (task) => dueInfo(task, ctx)?.sortAt ?? Number.POSITIVE_INFINITY;
  return [...tasks].sort(
    (a, b) =>
      key(a) - key(b) ||
      PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
      a.order - b.order ||
      a.content.localeCompare(b.content),
  );
}

/**
 * The filters evaluated on the synced tasks instead of asking Todoist: the
 * default "today | overdue" (every task due today or before, whatever the
 * time). Any other filter goes to Todoist's own parser.
 */
export function isLocalFilter(query) {
  const compact = fold(query).replace(/\s+/g, '');
  return compact === 'today|overdue' || compact === 'overdue|today';
}

export function dueTodayOrBefore(tasks, ctx) {
  const today = todayOf(ctx);
  return tasks.filter((task) => {
    const info = dueInfo(task, ctx);
    return info !== null && info.date <= today;
  });
}

/**
 * The project a scene or a widget names: by id, by name (any case, any
 * accent, an optional leading "#"), else the first one whose name contains it.
 */
export function findProject(projects, query) {
  const text = String(query ?? '').trim();
  const wanted = fold(text.replace(/^#/, ''));
  if (!wanted) {
    return undefined;
  }
  const list = [...projects.values()];
  return (
    list.find((p) => p.id === text) ??
    list.find((p) => fold(p.name) === wanted) ??
    list.find((p) => fold(p.name).includes(wanted))
  );
}

/**
 * The task a scene means: same text (folded), else the first one whose text
 * contains it; `tasks` is sorted, so the one due first wins.
 */
export function findTask(tasks, query) {
  const wanted = fold(query);
  if (!wanted) {
    return undefined;
  }
  const open = tasks.filter((t) => !t.uncompletable);
  return (
    open.find((t) => fold(t.content) === wanted) ??
    open.find((t) => fold(t.content).includes(wanted))
  );
}

/** The data of a scene event about a task (flat, bounded strings). */
export function eventData(task, ctx) {
  const info = dueInfo(task, ctx);
  return {
    content: bounded(task.content),
    project: bounded(projectName(task, ctx)),
    priority: task.priority,
    due: dueLabel(info),
    all_day: info ? info.allDay : false,
    labels: bounded(task.labels.join(', ')),
    url: task.url,
  };
}

/** "19:00", "Tomorrow 08:00", "Mon 20 Oct": when a task is due, for a person. */
export function dueText(info, ctx, language = 'en') {
  if (!info) {
    return '';
  }
  const today = todayOf(ctx);
  const words = {
    en: { today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday' },
    fr: { today: 'Aujourd’hui', tomorrow: 'Demain', yesterday: 'Hier' },
  }[language === 'fr' ? 'fr' : 'en'];
  let day;
  if (info.date === today) {
    day = info.time ? '' : words.today;
  } else if (info.date === nextDate(today)) {
    day = words.tomorrow;
  } else if (nextDate(info.date) === today) {
    day = words.yesterday;
  } else {
    const [y, m, d] = info.date.split('-').map(Number);
    day = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  return [day, info.time ?? ''].filter(Boolean).join(' ');
}

/** "• 19:00 Sortir les poubelles (Maison)": one line of the `list` output. */
export function taskLine(task, ctx, language = 'en') {
  const info = dueInfo(task, ctx);
  const when = dueText(info, ctx, language);
  const late = isOverdue(info, ctx) ? (language === 'fr' ? ' (en retard)' : ' (overdue)') : '';
  const project = projectName(task, ctx);
  return `• ${when ? `${when} ` : ''}${task.content}${project ? ` (${project})` : ''}${late}`;
}

/**
 * The store as it should be once a change made through Gladys is applied:
 * the next sync is compared with it, so the integration's own changes fire
 * no "task added" / "task completed" event (a scene bound to "task added"
 * that adds a task cannot loop through the integration), while the changes
 * made in the apps still do.
 */
export function applyOwnChange(store, { added, closed }) {
  const tasks = new Map(store.tasks);
  if (added) {
    tasks.set(added.id, added);
  }
  if (closed) {
    if (closed.due?.recurring) {
      // Todoist moves it to its next date and counts one more completion.
      const count = closed.completedCount === null ? null : closed.completedCount + 1;
      tasks.set(closed.id, { ...closed, completedCount: count });
    } else {
      tasks.delete(closed.id);
    }
  }
  return { ...store, tasks };
}
