# Todoist

**Unofficial connector, not affiliated with Doist** (the makers of Todoist).
It brings your [Todoist](https://www.todoist.com/) tasks into Gladys: a
dashboard widget with the tasks of the day, scene actions to add, complete
and read tasks, and scene triggers when a task is due, added or completed.
It uses the official Todoist API v1 with your personal API token. Todoist is
a trademark of Doist.

## What you get

| Surface          | Content                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard widget | **Todoist tasks**: today's and overdue tasks (or a project, or any Todoist filter), with their priority colour, due time and overdue mark, a check-off button per task and an **Add** form |
| Scene actions    | **add a task** (text, due date, project, priority, labels, or Quick Add), **complete a task** (named loosely), **read tasks** (number, overdue, the list as text, the next task)           |
| Scene triggers   | **task due** (at its time, or at the hour you choose for a date without a time), **task added**, **task completed** (recurring tasks included), filtered by project and priority           |

No device is created: tasks are not devices.

## Setup

1. In Todoist, open **Settings → Integrations → Developer** and copy your
   **API token**.
2. Install the integration, open its configuration and paste the token. It is
   sent only to Todoist (`api.todoist.com`), in the Authorization header;
   Gladys stores it encrypted.
3. Click **Test the account**: it shows your number of tasks and projects,
   the tasks due today and overdue, and the time zone of your Todoist account
   (the one every due time is read in).
4. Put the **Todoist tasks** widget on a dashboard. Leave its settings empty
   for today and overdue, type a Todoist filter (`#Groceries`, `@errands`,
   `p1 & today`), or a project name: the **Add** form then puts the new tasks
   in that project.

### The widget

Each task shows its priority colour (red p1, orange p2, blue p3, grey p4),
its due time ("19:00", "Tomorrow", "Tue 20 Oct") and, when it is late,
"Overdue". A card holds four buttons at most: up to three tasks get their
own check-off button (Gladys asks for a confirmation first); with more
tasks, the first two keep theirs and **Check off…** opens a list of all of
them. **Add** opens a form (task, optional due date written as in Todoist).
The forms need Gladys 5.2; the check-off buttons work on 5.1.

## Scenes

- **Task due**: a task reached its due time. A task due on a day without a
  time fires at the hour set in the configuration (**Hour of the "task due"
  trigger**, 9 by default). It fires once per due time; the dues already
  passed when Gladys starts never fire.
- **Task added**: a task was added in Todoist (the apps, a shared project, an
  email to your Inbox).
- **Task completed**: a task was checked off in Todoist. A recurring task
  counts too: Todoist moves it to its next date, the `{{recurring}}`
  variable is then true.

Each trigger can be limited to a **project** (typed exactly as in Todoist,
case included) and to some **priorities**. Variables: `{{content}}`,
`{{project}}`, `{{priority}}` (p1 to p4), `{{due}}` ("2026-10-14 19:00"),
`{{labels}}`, `{{url}}` (the task in the Todoist web app), `{{all_day}}`.
The changes made through Gladys (a scene action, the widget) fire no "task
added" or "task completed", so a scene cannot loop through the integration.

The actions return values for the steps that follow:

- **Add a task** gives `{{id}}`, `{{url}}`, `{{project}}` and `{{due}}`. The
  due date is written as in Todoist ("tomorrow at 6pm", "every monday"); a
  project left empty is your Inbox. With **Quick Add**, the text is read like
  the Todoist apps do ("Call mum tomorrow 6pm #Home p2") and the other fields
  are ignored.
- **Complete a task** closes the open task whose text matches, case and
  accents ignored (else the first one containing the text, the one due first
  winning), optionally only in a project or a filter. `{{done}}` is false when
  no task matches.
- **Read tasks** takes a Todoist filter (`today | overdue` by default) and
  gives `{{count}}`, `{{overdue_count}}`, `{{list}}` (one line per task, in
  the language of your Todoist account) and the next task: `{{next_task}}`,
  `{{next_due}}`, `{{next_project}}`, `{{next_priority}}`, `{{next_url}}`.

Filters other than the default are evaluated by Todoist: write them in the
language chosen in **Language of your filters** (English by default).

## Pace

Todoist publishes its limits: per user and per 15 minutes, 1000 incremental
syncs and 100 full syncs. The integration does one full sync at start, then
one light incremental sync every 2 minutes (option **Sync interval**, 1
minute at least) while the tasks are watched, and one right after a change
made through Gladys. "Task due" is checked every minute on the synced tasks,
without any request. A filter Todoist evaluates is kept a minute. Every
request is counted: the integration never uses more than half of the
published limits and pauses when Todoist asks it to slow down. With
**Watch the tasks** off, nothing runs in the background: the widget and the
actions sync when they need it, and the triggers never fire.

## Troubleshooting

- **"Todoist refused the API token"**: copy the token again and save the
  configuration; the integration does not try again by itself.
- **"Todoist is unreachable"**: it tries again at the next sync.
- **A trigger does not fire**: check that the tasks are watched and that the
  project is spelled exactly like in Todoist.
- **The due times are one or two hours off**: the time zone of your Todoist
  account (Todoist: Settings → General) is the one used; **Test the account**
  shows it.
- Logs: the integration's log level is set with the `LOG_LEVEL` variable.

## Privacy

The API token is sent only to Todoist, never logged. Of your account, the
integration keeps in memory the tasks, the project names, the time zone and
the language; the email and the other settings Todoist sends are dropped at
once. Nothing is written on disk.
