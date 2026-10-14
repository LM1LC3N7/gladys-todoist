# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-14

### Added

- Connection to a Todoist account with its personal API token (sent to
  Todoist only), through the Todoist API v1: one full sync at start, then a
  light incremental sync every 2 minutes (configurable, or off), within the
  limits Todoist publishes.
- Dashboard widget "Todoist tasks": today's and overdue tasks, a project or
  any Todoist filter, with the priority colour, the due time and the overdue
  mark, a check-off button per task (or a "Check off…" form beyond three
  tasks) and an "Add" form.
- Scene actions "add a task" (due date in words, project, priority, labels,
  or Todoist's Quick Add), "complete a task" (named loosely, in a project or
  a filter) and "read tasks" (count, overdue count, the list as text, the
  next task).
- Scene triggers "task due" (at its time, or at a configured hour for a date
  without a time), "task added" and "task completed" (recurring tasks
  included), filtered by project and priority; the changes made through
  Gladys fire none of them.
- "Test the account" button.

[Unreleased]: https://github.com/LM1LC3N7/gladys-todoist/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-todoist/releases/tag/v0.1.1
