# ADR-004: A daily run is Langy reading one board for one person

**Status:** Accepted

**Behavioural contract:** [The daily insights run](../specs/insight-daily-run.feature) and
[Unattended Langy turns](../../langy/specs/langy-unattended-turn.feature).

## Context

ADR-003 left one writer missing: "a scheduled run will file for a named person". This
ADR decides what that run is and what wakes it. A person turns the run on for a board,
and their schedule wakes it once a day; an operator asks for one run with a task. Both
start the same run.

A run reads customer trace text with nobody watching. That text may carry
instructions. So the run is built on two facts that do not depend on Langy behaving:
Langy holds no write permission, and nothing Langy says decides who an insight is
for.

## Decision

**One aggregate per person and board.** `insight_daily_schedule`, in the pipeline
`insight_daily_run`. Its id is derived from the project, the person and the board
pointer, so there is one by construction. Its stream holds the schedule's setting
(`configured`, `turned_off`), each run (`run_requested`, `run_started`, `run_settled`)
and a reconcile pass's request to arm (`rearm_requested`).

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
on the board is dropped. A finding's query is never Langy's own text. It is kept only when it
is a stored query of the widget the finding names, compared with white space aside and with
the run's step read as the step parameter (the brief has Langy write the step into the copy
it runs), and the board's copy is what is filed: the text the widget itself runs, with its window as the reserved
`dashboard_context_*` parameters where its author used them
([ADR-002](./002-pointer-and-fixed-date-evidence.md)). A query Langy wrote may name a database
or a date, and such an insight replays on one deployment or for one day only. The board's copy
is kept only when the analytics module's validation door admits it for the person. A query
that fails either check is dropped and its finding is filed without it. The owner is the run's
person, the board is the run's board, and the window of a finding's query is the run's own
window.

**Delivery is at least once.** The outbox may carry a run out twice. Every id and
instant is derived from the run: the Langy idempotency key is the schedule and run
id, each insight id is a digest of the schedule, the run and the finding's position,
and each filing is stamped with the run's slot. The brief is built only from what is
fixed for the run, so a repeat sends the same words and Langy answers with the same
turn. It lists at most 40 widgets, stays within 12,000 characters, and holds every name
a person wrote inside one marked block that it calls data. It tells Langy to write no file,
to run one query per command and on one line, to start from a widget's stored query, to hand
that query back as stored, and to read the window's hourly steps before it reports a total.
A repeat whose brief differs is refused by Langy and recorded as `failed` with
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

**The setting is the person's own.** Per person and per board: `undecided` until they
choose, then `on` with an hour (0 to 23), an IANA time zone and a maximum (1, 3, 5 or
10), or `off`. Three procedures read it, turn it on or change it, and turn it off; "No
thanks" on the offer is the same off. Each takes `analytics:view` and names no person,
so a caller reaches their own setting alone, an administrator included. The writes are
refused on an aggregate, and all three while `release_insights` is off. Any board may be
turned on, a From LangWatch board too. A stored board is read as the person when they
turn it on, so one they cannot open answers `dashboard_not_found`, like one that does
not exist; a template's pointer is kept as sent, since no server reads the catalogue.
Turning off asks no board, so the run of a board that is gone can still be turned off.
The row keeps what they last chose while the run is off. There is no cap on how many
boards a person turns on.

**The control is lent to the board's header.** Analytics hosts and insight owns, so
analytics never imports insight: analytics' client declares an extension point,
`BoardHeaderActionToken`, with the board's kind, id, name and widget count, and its
board header draws every lender, on a stored board and on a From LangWatch board. Insight
lends "Daily insights" to it. `undecided` and `off` show a quiet switch; `on` shows one
dropdown with the schedule, how the last run ended, the way to Insights, the settings
and the switch that turns it off. The words say "around 09:00", because a slot is a
minute within the hour. The browser's defaults are 09, its own time zone and 3. Nothing
shows while `release_insights` is off, without `analytics:view`, or on an aggregate,
whose read answers `undecided` and whose writes are refused.

**The offer is one rule, and the answer is the server's.** A board that opened with at
least one widget offers the run in a dialog to a person who is `undecided`, once per
visit. Closing the dialog decides nothing; "No thanks" stores `off`. The rule is one
pure function, `shouldOfferDailyInsights`, so how often a board asks changes in one
place, and the browser stores no answer of its own.

**A write shows before it is folded.** A write is answered before the worker folds its
event, so the browser writes the new state into the cached read first, and puts the read
back and says so when the write is refused. The read hint then brings the folded row.

**The schedule is a wake per person and board.** The aggregate's process manager,
`dailyInsightsSchedule`, is keyed by the schedule and arms `nextWakeAt` itself, as a
report's schedule does. A slot is the chosen hour and a minute fixed by a digest of the
schedule id, read in the stored zone with `nextCronFireAt`, so "09:00" is "around
09:00" and one hour's schedules spread over it. A schedule runs once per calendar date
in its zone: the state keeps the slot of the last wake that ran, and no slot is armed or
taken on that date again. The cron helper answers the wall clock: an hour the clocks
skip runs at the next valid time that day, and an hour they repeat names its first
occurrence only. Every handler re-derives the wake from the state, so a setting changed
during the day arms from that instant: today when the new hour is ahead and no run
happened today, else tomorrow, and never a run at once. A wake handled six hours or
more after its slot starts nothing and waits for the next day. Off cancels the wake.

**A wake and a request start a run the same way.** Both write the one `runBoard` intent
the outbox carries to the run. While a run for the board is in flight neither starts a
second, and for a wake the run in flight stands for that date. A run that outlived every
attempt's lease is superseded: the new run is handed its id, and records it as `failed`
with `timeout` before its own outcome. A scheduled run is named by its slot. An
operator's run is no scheduled run and takes no date from the schedule. A run that ends
`skipped` with `board_deleted` turns the schedule off (`turned_off` by `system`), for a
schedule that is on and no other; a run on a template keeps ending `skipped` with
`template_board` and the schedule stays on.

**A reconcile pass arms what lost its wake.** `dailyInsightsScheduleReconcile` is a
scheduled singleton on the same pipeline, hourly and once across the fleet, as topic
clustering's schedule seed is. A pass reads every row that is on, in every project, and
asks the process of each one with no wake armed to arm itself (`rearm_requested`). The
process arms from its own setting, takes the row's only when it never had one, and
stays off when the person turned it off since. A pass changes no setting.

## Consequences

- The module gains five peers: `LangyApi`, `DashboardApi`, `AuthzApi`, `UserApi` and
  `AnalyticsApi` (the validation door for a finding's query).
- A run on an Only me board passes the gate for its author, and Langy's command line
  reads the board over REST as the author too. The run's key is a Langy session key the
  author owns, and the dashboard doors read a key a person owns as that person
  (dashboards-v2.feature AC196). It is not a key no person owns, which has no viewer.
- `InsightDailyScheduleProjection` was created with the schedule's columns (`state`,
  `hour`, `timezone`, `maxInsights`), which the setting now writes, so the schedule
  needed no migration. Nothing writes `lastRunRenewed` yet.
- A run still reads calendar days in UTC. The schedule's zone decides when a run starts,
  not which day it reads.
- A setting changed while a slot is due replaces that slot: the next one is derived from
  the change, by the same rule as any change of hour.
- A schedule that a missing board turned off stays off when the board comes back, for
  instance when its author makes it Only me and then shares it again.
- A lost wake is armed again within the hour, for the next slot: the slot it missed is
  not run late by the pass.
- The process's state gained the schedule's fields, each with a default, so an instance
  written before them still reads.
- Langy's command line fills the window of a stored query (`langwatch query --start --end`)
  but not its step: `query` has no flag for `dashboard_context_granularity_seconds`, and a
  reserved name passed as `--param` is refused. The brief tells Langy to write the step into
  the copy it runs. A flag for the step would let Langy run a stored query unchanged.
- A finding from a query of Langy's own keeps no query, so its insight shows no evidence
  chart. Only a widget's stored query is evidence.
- A run's brief names custom chart widgets only. Builder graphs and saved charts
  placed on a board are not listed, so a board that holds only those is `board_empty`.
- Daily runs on From LangWatch boards need the template catalogue, or the part of it
  a brief needs, readable on the server. Until then they are skipped, visibly: the
  control says "Did not run" and that Langy cannot read From LangWatch boards yet. The
  offer and the schedule sentence on such a board still say Langy reads it.
- The browser counts every widget of a board, while a run reads custom chart widgets
  only. A board of builder graphs alone gets the offer, and its run ends `board_empty`.
- The control's "N new" tag counts the person's unseen insights whose pointer has the
  board's id. A From LangWatch board is pointed at by its template id in a run and by
  `curated/<template id>` in a chat, so chat insights from a template are not counted.
- The run events and a pass's request are per-run rows and age with the `traces`
  retention class. `configured` and `turned_off` are a person's setting and never expire.
