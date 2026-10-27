# ADR-005: A daily run checks its board's widgets without a model call

**Status:** Accepted

**Behavioural contract:** [The daily run checks the board's widgets](../specs/insight-board-health.feature)
and [The daily insights run before a wider rollout](../specs/insight-daily-run-hardening.feature).
Issue: https://github.com/langwatch/langwatch/issues/8818.

## Context

A daily run asks Langy about a board only when the project took a new trace (ADR-004). A board
whose widget fails, or shows nothing, says so only to someone who opens it. The owner asked
that every run check the board's widgets first, cheaply, and tell the person. The question
"did the project take a new trace" also left out every Langy trace, so a project whose people
only chat with Langy never got a run.

## Decision

**The check runs on every run, after the gate and before the question of new traces.** It
never calls a model and never decides whether Langy is asked. Its cards are counted with
Langy's in the one outcome: a run with no new trace that filed a card is `filed` with the
reason `no_new_traces`. A run that fails after the check keeps the check's counts.

**It runs each widget's stored statements as the board shows them by default.** As the
person (`AnalyticsApi.resolveRunCaller`), over the 30 days that end where the run's window
ends, at a one-day step coarsened when too fine, with each declared parameter's default, and
leaving out Langy's traces unless the project is personal (`defaultBoardExcludedOrigins`, the
board's own rule). The 30 days are the owner's choice and the board's default range. Each
statement is validated with the eval gate open first, so a statement that calls an eval
function is admitted, recognised (`describeLangWatchQLJudgements`) and never run: it would
cost a model call. A statement whose declared parameter has no default, and one refused for a
missing parameter, are not checked: the widget's own code supplies the value. A widget with
no stored statement is not checked. Builder graphs on a board are not checked (ADR-004).

**Off where the board is off.** The board runs its widgets through the Workbench door, which
refuses a project the Workbench rollout does not admit. The check asks
`AnalyticsApi.isWorkbenchEnabled` once and runs nothing when it is off.

**Broken is an error the person can fix, or no data.** A refusal with `fault: customer`
below 500 is an `error` (tone bad). A widget whose every statement ran and came back
empty shows `no_data` (tone watch). A statement is empty only beside a completeness
report of `no_traffic` (no traffic in the period it read, what the board shows as "No
traces in this period") or `missing` (traffic, but a field it reads is never present).
Beside `no_traffic` any answer is empty; beside `missing`, no rows or rows whose every
value is null. Beside `complete` or `partial`, or with no report (a rollup view such as
`trace_metrics_by_minute`, a statement with its own range, a failed report), no rows,
rows of nulls and one row of zeros are `unchecked` and file nothing: a correct filter
can be empty, zero errors over a busy month is an answer, and a missed card costs less
than a false one renewed every day. An error on one statement outweighs empty ones.

**A failure of ours files nothing.** Every 5xx refusal, a transient refusal, an error that is
no refusal, and `query_memory_exceeded` and `query_scan_limit_exceeded`, are the platform's:
counted and logged, never filed. The memory and scan refusals declare no fault and read as the
customer's, but the server-wide memory cap raises the same code, and one incident would file a
card for every widget of every schedule. A widget that is too heavy still shows its error on
the board. When at least 3 statements fail with one code and they are more than half of the
statements that ran, the whole check is the platform's and files nothing: a view we renamed
breaks every board at once.

**The check leaves the project's query window to people.** Each execution goes through
`executeBackgroundLangWatchQL`: the analytics module refuses it once the project's shared
one-minute LWQL window holds a third of its bound, whoever used it, so people keep two thirds whatever else runs at that
hour, however many schedules share it. That refusal paces the check: it waits the window's
`retryAfterSeconds` and runs the same statement again. No statement starts after 3 minutes, so
the check plus Langy's 10 minutes stay inside the 20-minute lease. A wait that would outlast the
budget ends the check; the widgets left are counted `unchecked` and file nothing. Each refusal
is counted in the window too, at most a few per check, and in `rate_limit_exceeded_total` under
its own scope, `lwql_background`, so people's `lwql` count moves only for people. A run waiting
for the window holds one of its pod's 2 daily-run slots for up to the 3 minutes. Widgets are checked in board order, so a
board too big for one budget always leaves the same last widgets unchecked. The check does not
sleep between statements while the window is open: a fixed pause would hold the worker on every
run to guard a window the refusal already guards.

**One card per broken widget, renewed while it stays broken.** A card is an ordinary insight
filed by the run (`filedVia: run`, no source, no query, topic `health`, valid 3 days) with the
key `board-health:<widget id>:<error|no_data>`. Langy's keys are slugs without a colon, so they
never collide. Its id is a digest of the schedule, the run, the widget and the reason, the same
on a retry. Before writing, the check reads the person's insights by those keys
(`InsightRepository.findByFindingKeys`), not the newest 500, so a card renewed for weeks is
still found, and with no `filedAt < slot` test, so a card filed by Run now later in the day is
still found. The newest card with the key on this board decides: none, or one whose 3 days ran
out and that is not kept, files a new card; one with this run's own id files again under that
id (a retry); any other is renewed, with no reader named, so a card marked done stays done.
Marked done is not resolved: a widget is resolved when no run saw it broken for 3 days.

**At most 5 cards per board per run.** With more than 5 broken widgets, the first 4 in board
order get a card each and one card, keyed `board-health:more:<board id>`, names the rest. Its
title holds no count: a renewal keeps an insight's title, so only the body counts the rest. A
From LangWatch board, checked once the server can read its widgets, can hold many widgets for
sources a person does not use; the cap keeps that to 5 cards.

**Langy neither sees the cards nor reports the same widgets.** Health cards are left out of the
open insights a brief lists and of the insights a finding may renew, so Langy's `renews` never
lands on one. The brief names the widgets the check reported, inside the data block, and asks
Langy not to report them.

**New traces leave out daily-run conversations only.** Langy's relay stamps every trace of a
turn with its conversation id, and every unattended turn opens a conversation with origin
`run`. The run asks Langy for the project's run conversations active since the window's start
(`LangyApi.findRunConversationIds`, at most 1,000) and asks analytics for the newest trace
outside them (`excludeConversationIds`). A trace with no conversation counts. A person's own
Langy chat now counts as a new trace.

## Consequences

- Each run makes statement executions over 30 days, as the person, once a day per schedule,
  bounded by a third of the project's window per minute and 3 minutes; watch `insight_board_health_check_total{result}` (healthy, error, no_data, platform,
  unchecked, off) and ClickHouse load after rollout. Run now repeats the check.
- A run waiting for the query window holds one of the 2 daily-run slots a pod has for up to 3
  minutes, so at a popular hour runs queue behind it and cards and Langy's findings land later.
  Watch the daily run's duration after rollout.
- A failed read or write of the cards is logged; the run carries on, and the next run
  files or renews the rest. The cards written before the failure stand and are counted
  in the report, and their widgets are named to Langy as already reported.
- `InsightRenewed.source` became nullable, since a card has no conversation and every renewal
  needs one. A pod of the release before cannot fold a renewal without one, so this change
  ships alone, one release before the check: rolling back over it is then safe.
- `findRunConversationIds` has no index on `(projectId, Origin, LastActivityAt)` and scans the
  project's conversations once per run. Add one if a project's conversations grow large.
- The key read has no index on `findingKey`; it narrows by project and owner first.
- A retry whose check sees a different set of broken widgets than the first attempt, after the
  first attempt started Langy's turn, briefs Langy differently and ends `failed` with
  `brief_changed`, once.
- More than 1,000 run conversations since the window's start let the rest count as new, which
  costs one Langy turn and never a missed run.
- In a non-personal project whose only traffic is Langy chats, widgets show no data as the board
  does, and Langy is now asked.
- A widget whose statement reads its own range rather than the board's period is checked over
  that range.
