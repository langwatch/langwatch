# ADR-004: A daily run is Langy reading one board for one person

**Status:** Accepted

**Behavioural contract:** [The daily insights run](../specs/insight-daily-run.feature) and
[Unattended Langy turns](../../langy/specs/langy-unattended-turn.feature).

## Context

ADR-003 left one writer missing: "a scheduled run will file for a named person". This
ADR decides what that run is, before any schedule exists. An operator asks for one run
with a task; a later slice wakes the same run on a schedule.

A run reads customer trace text with nobody watching. That text may carry
instructions. So the run is built on two facts that do not depend on Langy behaving:
Langy holds no write permission, and nothing Langy says decides who an insight is
for.

## Decision

**One aggregate per person and board.** `insight_daily_schedule`, in the pipeline
`insight_daily_run`. Its id is derived from the project, the person and the board
pointer, so there is one by construction. Its events are `run_requested`,
`run_started` and `run_settled`. The schedule's own events (on, off, hour) join the
same stream in the next slice.

**The board is a pointer.** `{ kind: "dashboard" | "template", id, name }`. A stored
board is read through the dashboard module, as the person. A From LangWatch board is
named by its template id, but its widgets are defined in the browser bundle alone, so
a run on one ends as `skipped` with the reason `template_board`. No second copy of
the catalogue is kept on the server.

**The run acts as the person, as they are when it runs.** Nothing about access is
stored. A gate asks, in this order: the project exists and takes writes, the
`release_insights` flag is on, the person exists and is active, they hold
`analytics:view`, the board exists and has widgets. Any "no" records `skipped` with
its reason and Langy is never called. Langy then asks again on its own side: its
unattended turn mints a key from the permissions the person holds at that moment.

**Langy only reads.** The run starts a turn with `LangyApi.startUnattendedTurn`. That
turn's key holds only the `view` permissions Langy may hold for the person, it is
never borrowed from a running worker, and it carries no GitHub token. Filing is the
one write of a run, and the insight module does it.

**The answer is untrusted.** Langy ends its answer with one fenced block tagged
`langwatch-insights` holding `{ "findings": [...] }`. The module refuses the whole
answer when the block is missing, repeated, not JSON, holds a key the schema does not
list, or hands back the example finding the brief shows. So an answer cannot name an
owner, a project or a board. What passes is cut to the run's maximum, and a widget id
that is not on the board is dropped. The owner is the run's person, the board is the
run's board, and the window of a finding's query is the run's own window.

**Delivery is at least once.** The outbox may carry a run out twice. Every id and
instant is derived from the run: the Langy idempotency key is the schedule and run
id, each insight id is a digest of the schedule, the run and the finding's position,
and each filing is stamped with the run's slot. The brief is built only from what is
fixed for the run, so a repeat sends the same words and Langy answers with the same
turn. A repeat whose brief differs is refused by Langy and recorded as `failed` with
`brief_changed`. The row keeps the first outcome a run recorded.

**Every run records an outcome.** `filed`, `nothing`, `failed` or `skipped`, each
with a reason where one applies. A failure is thrown for the outbox to retry; the
third attempt records `failed` first. One run is in flight per person and board. A
run that recorded no outcome within every attempt's lease stops holding the board.

**The run's conversation is the person's own.** It shows in their Langy history
under a title that names the board and the day, with the origin `run`, and it sends
no push notification.

## Consequences

- The module gains four peers: `LangyApi`, `DashboardApi`, `AuthzApi` and `UserApi`.
- `InsightDailyScheduleProjection` is created with the schedule's columns (`state`,
  `hour`, `timezone`, `maxInsights`) and `lastRunRenewed`, which nothing writes yet,
  so the next slices add no column to a projection table.
- A run reads calendar days in UTC until a schedule carries the person's timezone.
- A run's brief names custom chart widgets only. Builder graphs and saved charts
  placed on a board are not listed, so a board that holds only those is `board_empty`.
- Daily runs on From LangWatch boards need the template catalogue, or the part of it
  a brief needs, readable on the server. Until then they are skipped, visibly.
- The run events are per-run rows and age with the `traces` retention class.
