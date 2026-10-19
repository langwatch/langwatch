# ADR-004: A daily run is Langy reading one board for one person

**Status:** Accepted

**Behavioural contract:** [The daily insights run](../specs/insight-daily-run.feature),
[The daily insights run before a wider rollout](../specs/insight-daily-run-hardening.feature)
and [Unattended Langy turns](../../langy/specs/langy-unattended-turn.feature).

## Context

ADR-003 left one writer missing: "a scheduled run will file for a named person". This
ADR decides what that run is and what wakes it. A person turns the run on for a board,
and their schedule wakes it once a day; an operator asks for one run with a task. Both
start the same run.

A run reads customer trace text with nobody watching. That text may carry
instructions. So the run is built on two facts that do not depend on Langy behaving:
Langy holds no write permission but sending a trace, and nothing Langy says decides who
an insight is for.

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
turn's key holds only the short list of `view` permissions a board read needs, and
`traces:create` so the run's own turn reaches the person's project as a trace. Trace
ingest asks only the project and the permission, so the key cannot be held to the run's
own trace; a steered run could at most add a trace to that project. The key is never
borrowed from a running worker, and it carries no GitHub token. Every later turn
in the run's conversation keeps the same key ceiling. Filing is the
one write of a run, and the insight module does it.

**The method is Langy's own skill.** How a board is read and how the answer is shaped
lives in the skill `daily-insights` (`skills/daily-insights/SKILL.mdx`): the commands,
one query per command and on one line, the hourly steps before a total, what counts as
a finding, the key, when to use `renews`, no link, no file, ask nothing, write nothing.
The brief names the skill in one line and holds the facts of one run. The skill is
listed in `NATIVE_ONLY_SKILLS`, so it ships in the Langy image and never in the public
skills package, and its front matter says `internal: true`, so the composer's palette
never offers it. No skill chip can name it. An unattended turn withholds only the
flag-gated chart skills, so the skill reaches a run.

**The answer is untrusted.** Langy ends its answer with one insights card: a fenced
`langy-card` block of kind `insights` in its reply, which Langy's relay validates
against the card's schema and stamps as a typed part of the turn (Langy's ADR-060). The
card's schema is Langy's and the run maps it to its own finding schema, so Langy never
imports insight. The run reads the stamped part of the settled turn
(`LangyTurnSettlement.parts`) and never the prose. Writing a card is no command, so it
needs no permission the read-only key lacks. The module refuses the whole answer when
the turn holds no insights card, holds two, holds a card the relay had to repair from
JSON that was cut off, holds a key the card's strict schema does not list (the relay
then stamps no card), or hands back the example finding the skill shows. So an answer
cannot name an owner, a project or a board. A board and a window the card itself names
are for a person who saves a finding by hand; a run takes neither. For one release an
answer that carries no insights card at all may still end with the fenced block tagged
`langwatch-insights` holding `{ "findings": [...] }`, held to the same checks. The card
is read first: an answer with a card is never read for a block, and a card that fails a
check is not rescued by a block beside it.
A finding's title is at most 120 characters and its body 4,000,
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
a person wrote inside one marked block that it calls data. A renewal is stamped with
the slot too, and keeps an open insight open at that slot, so a repeat reads the same
open insights, writes the same brief and renews or files the same things. A new
insight's id is named by its finding's place in the answer, whatever the findings
before it did. The brief gives each window as the two flags a query is run with, the
step in seconds and the maximum, and names no command and no field of a finding.
A repeat whose brief differs is refused by Langy and recorded as `failed` with
`brief_changed`. The row keeps the first outcome a run recorded.

**A finding that repeats an insight renews it.** A finding may carry a `key`, a short
name for what was found that stays the same on a later day, and `renews`, the id of
the open insight it repeats. The brief lists the person's open insights for the board
by id, title and key, and the skill tells Langy to report a repeat with `renews`, not as new. The
key is kept in one spelling (lower case, words joined by hyphens) on the `filed` event
and the row, as `findingKey`. The run reads the person's insights again when Langy has
answered and matches each finding in this order: the insight `renews` names, then the
newest insight with the finding's key. Never by title. Only the person's own insights
for this board are candidates, filed before the run, and open at the run's slot or
marked done; so an id of another person, another board or no insight is ignored and the
finding is filed as new. A match that is open is renewed: one `renewed` event on the
insight's own stream with the run's body, tone, validity, window and source, stamped with
the run's slot. The insight keeps its id, title, pointer and query; a query it keeps
replays over the run's window with the values it was filed with. A match the person
marked done makes the run quiet for that finding: no renewal and no new insight. An
expired insight is no match, so finding it again is filed as news, unread. A second
finding for the same insight or the same key in one answer is dropped. Renewal changes
nobody's seen, done or kept state.

**Every run records an outcome.** `filed`, `nothing`, `failed` or `skipped`, each
with a reason where one applies. The outcome counts what was filed and what was renewed
apart; a run that only renewed is `nothing`, since seen again is not news. A failure is thrown for the outbox to retry; the
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

**Run now asks for the same run.** The board's dropdown offers Run now to a person who
holds `analytics:view` and `langy:create`, on a board that is on with no run in flight.
`runBoardDailyRunNow` sends the request an operator's task sends, for the caller alone,
so the run files into the same inbox. The server refuses it with `validation_error`
unless the caller's run on the board is on, its sentence in `meta.formErrors` for the
caller to show; an operator's request asks no setting. The request answers its
`requestId`, and the run it starts takes that id as its `runId`, so the board's read
names `runId` on both `runInFlight` and `lastRun`. The browser then waits for the run
with that id to show, with no poll: `run_started` and `run_settled` hint the board's
read, which is read again. A hint is published off the committed event, not after the
schedule row is folded, so it can outrun the row: a read a hint brought back without the
run is read once more after `REQUESTED_RUN_REREAD_MS`, and that read repeats nothing. In flight, it opens Langy on the run's conversation; settled
first, it ends the wait. Any other run is not this request's: a scheduled run that
settles after the click and before the next read is shown as the last run, and the wait
goes on. While a run is in flight, `runNow` requests nothing and answers that run's id,
so the browser follows it. A run that starts between that read and the request is a
narrow window we accept: the request starts nothing, and the wait ends at the deadline.
A run that shows neither within `INSIGHT_DAILY_RUN_EXPIRY_MS` is lost, and the browser
says the run could not be started. While a run is in flight the dropdown offers to open
it instead.

**The row names the run in flight.** `run_started` writes `runInFlightId`,
`runInFlightConversationId` and `runInFlightStartedAt`, and the `run_settled` of that run
clears them. The read names no run in flight once its start is older than
`INSIGHT_DAILY_RUN_EXPIRY_MS`, a run that is lost.

**Insights runs are exempt from the unattended-turn rate limit.** This is an owner
decision: what is worth running is not known yet. A run starts its turn with
`isExemptFromRateLimit`, so it is not counted against `langyUnattendedTurnsPerMinute`.

**A reconcile pass arms what lost its wake.** `dailyInsightsScheduleReconcile` is a
scheduled singleton on the same pipeline, hourly and once across the fleet, as topic
clustering's schedule seed is. A pass reads every row that is on, in every project, and
asks the process of each one with no wake armed to arm itself (`rearm_requested`). The
process arms from its own setting, takes the row's only when it never had one, and
stays off when the person turned it off since. A pass changes no setting.

**A project that took no trace costs no model call.** After the gate and before Langy,
a run asks the analytics module once for the project's newest trace since the start of
the run's window (`AnalyticsApi.findLastOccurredAt`). None ends the run as `nothing`
with the reason `no_new_traces`: Langy is never called. This is an assumption the owner
may overrule. It is `nothing` and not `skipped`, because a skipped day counts towards
turning the schedule off (below) and a quiet project is no fault of its person. The
control's last run line says "no new traces, so Langy was not asked". The gate comes
first, so a person without access is still skipped and the project's traces are not
asked for them.

**Seven skipped days in a row turn a schedule off.** A scheduled run that ends
`skipped` is a skipped day. The count is a fold over `run_settled`, one pure rule
(`foldSkipStreak`) that the process state and the row both use: it holds the count and
the slot of the newest run folded, so an outcome folded twice counts once and an
outcome older than the newest changes nothing. `filed`, `nothing` and `failed` start
the count over. An operator's run that is skipped is no skipped day, and neither is a
run skipped with `template_board`: a schedule on a From LangWatch board stays on.
Turning the run on starts the count over. A wake hands its run the skipped days before it
(`skippedDaysBefore` on the `runBoard` intent), and the run that records the seventh
turns the schedule off, by `system` with the reason `skipped_days`, on the path
`board_deleted` already took. No side counter exists, so a replay rebuilds the count.

**A person who left and a project that was archived turn their schedules off.** Two
peer subscribers on the pipeline hear the organisation's member removed fact and the
project's archived fact. Each reads the rows that are on (a member's in every project of
the organisation they left; every person's in the archived project) and sends the
existing turn-off command by `system`, with the reason `member_removed` or
`project_archived`, stamped with the fact's own instant. A fact delivered twice finds no
row that is on the second time. A schedule its person turned off is not touched and
keeps no reason.

**An off holds a reason only when the system did it.** `turned_off` carries one of
`board_deleted`, `skipped_days`, `member_removed` and `project_archived`, or none. The
row keeps it (`offReason`), the person's read hands it over, and the board's control
then keeps its dropdown: it says "turned off" and why, and its switch turns the run on
again with what they last chose. An off by the person shows the quiet switch.

**An off is never armed again by the reconcile pass.** The process state marks that an
off reached it (`turnedOff`). A request to arm takes the row's setting only for an
instance that never had one and that no off reached, and the pass counts such an
instance as settled. This also closes the same hole for an off by the person that
reached an instance with no setting.

**Every run leaves an audit line and is counted.** A subscriber on `run_settled`, in
its own lane, writes one line through `AuditLogApi`: the action
`insight.dailyRun.settled`, the project, the person the run acted for as its user, the
schedule as its target, and the run, slot, board, outcome, reason and counts filed and
renewed as metadata. Its key is an audit id derived from the schedule and the run and
stamped with the run's slot, so a repeat writes the same line. A run skipped at the
gate settles too, so it has a line. The run itself counts each outcome it records:
`insight_daily_run_total` by `outcome` and `reason` (`none` without one), and
`insight_daily_run_duration_milliseconds` by `outcome`. Neither names a project, a
person or a board.

**An operator reads every schedule.** `InsightApi.findOperatorDailySchedules` answers
the rows a person decided on, the ones that are on first, each with its off reason, its
skipped days, how its last run ended and the wake its process has armed. Ops lists them
on its Schedules page under the report schedules, behind `ops:view`, and adds the
project's and the owner's name. The list is read only. Ops depends on insight's
contract; insight knows nothing of ops.

## Consequences

- The module gains five peers: `LangyApi`, `DashboardApi`, `AuthzApi`, `UserApi` and
  `AnalyticsApi` (the validation door for a finding's query).
- A run on an Only me board passes the gate for its author, and Langy's command line
  reads the board over REST as the author too. The run's key is a Langy session key the
  author owns, and the dashboard doors read a key a person owns as that person
  (dashboards-v2.feature AC196). It is not a key no person owns, which has no viewer.
- `InsightDailyScheduleProjection` was created with the schedule's columns (`state`,
  `hour`, `timezone`, `maxInsights`), which the setting now writes, so the schedule
  needed no migration. `lastRunRenewed` is written by every outcome since renewal;
  an outcome stored before it reads as none renewed. `InsightProjection` gained the
  nullable `findingKey` (migration `20261012210111`).
- A brief written before renewal differs from one written after it, so a run in flight
  across that deploy that is retried ends `failed` with `brief_changed`, once. The same
  holds across the deploy that moved the method into the skill.
- The fenced block is still read for one release. It settles a run whose answer ends
  with the block and carries no card: a model that kept the older shape, or a turn a
  worker of the older release is still waiting on. Remove it, with
  `INSIGHT_RUN_FINDINGS_FENCE_TAG`, in the release after.
- A run names a skill the worker image must hold. An image older than the skill gives
  Langy a brief with no method, and such a run most likely ends `failed` with
  `bad_output`. Roll the Langy image out no later than the app.
- A card cut off mid-stream is repaired by the relay, as every card is, and marked
  `repaired` on its part. A run files nothing from a repaired card.
- The card's limits are Langy's and wider than a run's (a title of 200 characters, a
  body of 20,000). A card within them and over a run's draws in the panel and fails the
  run with `bad_output`.
- An insight saved from a chat holds no key. A run renews it only when Langy names its
  id, and it stays without a key after that.
- A renewed insight keeps the query it was filed with. The later finding's own query is
  validated and then not kept.
- Langy writes the key, so the same finding matches on a later day only as far as Langy
  names it the same way. `renews` does not depend on that.
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
  reserved name passed as `--param` is refused. The brief gives the step and the skill tells
  Langy to write it into the copy it runs. A flag for the step would let Langy run a stored
  query unchanged.
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
- Hardening adds one peer, `AuditLogApi`, and two fact types of other modules'
  contracts (the organisation's member removed, the project's archived). Ops gains
  `InsightApi` as a peer.
- `InsightDailyScheduleProjection` gained `offReason`, `consecutiveSkips` and
  `skipStreakSlot` (migration `20261012210112`). The projection's version did not
  change: a row folded before the migration reads no reason and no skipped day, and
  counts from its next run. A schedule a missing board turned off before the migration
  reads off with no reason, so its control shows the quiet switch.
- The pre-check asks for a trace since the window's start, with no upper bound. A
  trace that arrived after the window's end lets the run reach Langy, which may then
  find nothing. A project whose traffic stopped gets "no new traces" and never an
  insight about the stop.
- A member removed from an organisation who is added again finds their runs off, with
  the reason. Nothing turns them on again but the person.
- An archived project's schedules stay off when the project is restored.
- The count of skipped days is per schedule and reads scheduled runs only. Seven days
  of `failed` runs never turn a schedule off.
- A run the outbox carries out twice is counted twice by the metrics; its audit line
  and its outcome are written once.
- The operator's list asks the process store once per row for the armed wake, for at
  most 500 rows. It has no filter, no paging and no index of its own.
- The clean-up reads a member's rows per project of the organisation. The row has no
  index on the person; a project's rows that are on are few.
- There is still no cap on how many boards a person turns on.
- `InsightDailyScheduleProjection` gained `runInFlightId`, `runInFlightConversationId` and
  `runInFlightStartedAt` (migration `20261015120001`), all nullable. A row folded before the
  migration names no run in flight until its next run starts.
- With no rate limit, a person can start Insights runs as fast as they choose Run now; one
  run in flight per board is the only bound. Revisit once what is worth running is known.
- The run events and a pass's request are per-run rows and age with the `traces`
  retention class. `configured` and `turned_off` are a person's setting and never expire.
