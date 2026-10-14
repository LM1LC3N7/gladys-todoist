# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ (and 5.2 for the widget forms) with a real
      Todoist account: the token, the widget (today, a project, a filter,
      check off, add), the three scene actions, the three triggers while
      someone uses the Todoist apps, a recurring task completed in the app.
- [ ] Watch the request count of a day (Test button: "requests in the last
      15 minutes") with two widgets and a few scenes.
- [ ] Reserve "Todoist" in the forum thread t/10385, then add the
      `gladys-assistant-integration` topic to publish in the store.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).

## To confirm with a real account (built blind)

- [ ] The incremental `/sync` answer carries the changed `items` with
      `checked`, `is_deleted` and `completed_count` (the "task completed"
      trigger of a recurring task relies on `completed_count`, documented on
      `ItemSyncView`); without it, a recurring completion fires nothing.
- [ ] The `user` resource comes back in an incremental sync only when it
      changed, and `tz_info.timezone` is always an IANA name.
- [ ] A floating due time comes as `date: "2026-10-14T19:00:00"` (the v1
      documentation) and not in a separate `datetime` (the TypeScript SDK
      allows both; both are parsed).
- [ ] The priority of `POST tasks`: the OpenAPI text says "1 is highest",
      every other page (and `ItemSyncView`) says 4 is the p1 of the apps.
      The code sends 4 for p1.
- [ ] `POST tasks/quick` answers the task object (the official SDK validates
      it as a `Task`).
- [ ] What Todoist answers to a sync token it no longer accepts (assumed
      400: the integration then does one full sync).
- [ ] The `lang` of `tasks/filter` accepts the 17 due-date languages offered
      in "Language of your filters", and `today | overdue` keeps working in
      English whatever the account language.
- [ ] `today | overdue` evaluated locally gives the same tasks as Todoist
      (sub-tasks, tasks assigned to someone else in a shared project).
- [ ] The scene filters compare strings exactly (case included): if users
      struggle with project names, offer a folded variable.
- [ ] A widget `select` with 50 tasks stays usable in the card.

## Ideas

- A `calendar`-type sibling (Gladys 5.2): the dated tasks in the Gladys
  calendar (`publishCalendarEvents`), one calendar per project.
- Sections in the widget and in "complete a task" (`/section`).
- A "deadline reached" trigger (the `deadline` object, separate from `due`).
- Reminders: the reminders of the account as a trigger (`reminders`
  resource), for the users who prefer them to due times.
- Webhooks through Gladys Plus would need an OAuth app registered with
  Doist: worth it only if the 2-minute sync proves too slow.
