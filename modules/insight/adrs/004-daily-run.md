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
board is read through the dashboard module, as the person: every read names the board
and the viewer, so the dashboard module's own scope rules answer it. An Only me board
is its author's alone, and to anyone else it reads as a board that was deleted. A From LangWatch board is
named by its template id, but its widgets are defined in the browser bundle alone, so
a run on one ends as `skipped` with the reason `template_board`. No second copy of
the catalogue is kept on the server.

**The run acts as the person, as they are when it runs.** Nothing about access is
stored. A gate asks, in this order: the project exists and takes writes, the
`release_insights` flag is on, the person exists and is active, they hold
`analytics:view`, the board exists and has widgets. Any "no" records `skipped` with
its reason and Langy is never called. Langy then asks again on its own side: its
unattended turn mints a key from the permissions the person holds at that moment. The
gate is asked a second time when Langy has answered, before anything is filed: a person
who lost access during the turn files nothing and the run ends `skipped`.

**Langy only reads.** The run starts a turn with `LangyApi.startUnattendedTurn`. That
turn's key holds only the short list of `view` permissions a board read needs, it is
never borrowed from a running worker, and it carries no GitHub token. Every later turn
in the run's conversation keeps the same key ceiling. Filing is the
one write of a run, and the insight module does it.

**The answer is untrusted.** Langy ends its answer with one fenced block tagged
`langwatch-insights` holding `{ "findings": [...] }`. The module refuses the whole
answer when the block is missing, repeated, not JSON, holds a key the schema does not
list, or hands back the example finding the brief shows. So an answer cannot name an
owner, a project or a board. A finding's title is at most 120 characters and its body 4,000,
and a finding that holds a web address refuses the answer with the reason
`finding_has_url`. What passes is cut to the run's maximum, and a widget id that is not
on the board is dropped. A finding's query is kept only when the analytics module's
validation door admits it for the person; otherwise the finding is filed without it. The owner is the run's person, the board is the
run's board, and the window of a finding's query is the run's own window.

**Delivery is at least once.** The outbox may carry a run out twice. Every id and
instant is derived from the run: the Langy idempotency key is the schedule and run
id, each insight id is a digest of the schedule, the run and the finding's position,
and each filing is stamped with the run's slot. The brief is built only from what is
fixed for the run, so a repeat sends the same words and Langy answers with the same
turn. It lists at most 40 widgets, stays within 12,000 characters, and holds every name
a person wrote inside one marked block that it calls data. A repeat whose brief differs is refused by Langy and recorded as `failed` with
`brief_changed`. The row keeps the first outcome a run recorded.

**Every run records an outcome.** `filed`, `nothing`, `failed` or `skipped`, each
with a reason where one applies. A failure is thrown for the outbox to retry; the
third attempt records `failed` first. One run is in flight per person and board. A
run that recorded no outcome within every attempt's lease stops holding the board. A
request is answered with a request id, never a run id: whether it starts a run is the
worker's call, made after the answer. An event is taken only on the schedule its own
project, person and board derive.

**The run's conversation is the person's own.** It shows in their Langy history
under a title that names the board and the day, with the origin `run`, and it sends
no push notification.

## Consequences

- The module gains five peers: `LangyApi`, `DashboardApi`, `AuthzApi`, `UserApi` and
  `AnalyticsApi` (the validation door for a finding's query).
- A run on an Only me board passes the gate for its author, and Langy's command line
  reads the board over REST as the author too. The run's key is a Langy session key the
  author owns, and the dashboard doors read a key a person owns as that person
  (dashboards-v2.feature AC196). It is not a key no person owns, which has no viewer.
- `InsightDailyScheduleProjection` is created with the schedule's columns (`state`,
  `hour`, `timezone`, `maxInsights`) and `lastRunRenewed`, which nothing writes yet,
  so the next slices add no column to a projection table.
- A run reads calendar days in UTC until a schedule carries the person's timezone.
- A run's brief names custom chart widgets only. Builder graphs and saved charts
  placed on a board are not listed, so a board that holds only those is `board_empty`.
- Daily runs on From LangWatch boards need the template catalogue, or the part of it
  a brief needs, readable on the server. Until then they are skipped, visibly.
- The run events are per-run rows and age with the `traces` retention class.
