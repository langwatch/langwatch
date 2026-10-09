# ADR-002: An insight points at its board, and keeps evidence as what to run

**Status:** Accepted

**Behavioural contract:** [Insights inbox](../specs/insight-inbox.feature), rules
"Where an insight came from" and "Evidence on fixed dates".

## Context

An insight often comes from a widget on a dashboard. The reader wants the way
back to it, and wants to see the numbers the insight talks about. Boards and
widgets are renamed and deleted, and a board's period slides with the clock.
An insight must read the same a month later.

## Decision

**A pointer, never a relation.** The filed event may carry `board`: the board's
id and name and, optionally, the widget's id and name, as they were when the
insight was filed. There is no foreign key and nothing checks that either
exists. The inbox row asks analytics to draw the pointer
(`DashboardPointerToken`): a link while the board or widget exists, the filed
name with "(deleted)" once it is gone.

**How it was filed is stored.** `filedVia` is `chat` (a member saved a Langy
answer) or `run` (a scheduled run). Only `chat` is written today. The row says
"Saved from a chat with Langy" or "Daily run". It says nothing about who else
sees the insight; that decision is open.

**Evidence is what to run, never a result.** An insight keeps its query
(`lwql`), a fixed window (`replay.start`, `replay.end`, `replay.granularitySeconds`)
and the values in force when it was filed (`replay.period`, `replay.parameters`).
The card replays the query through the LangWatchQL door as the reader
(`LwqlReplayChartToken`, lent by analytics). The window reaches the query only
through the reserved `dashboard_context_*` parameters, and the values through
bound parameters. Nothing is written into the query text. A reader the door
refuses, for example one without `cost:view`, sees the refusal and no number.

**One additive change.** The three fields have defaults on the filed event's
data schema (`null`, `chat`, `null`), so an event stored before them still
parses and folds. The projection table gains nullable columns and
`filedVia DEFAULT 'chat'`. The event version stays `2026-10-09`: a calendar
version cannot tell two shapes of the same day apart, and the eventing rule for
a new field with a default is the default, not an upcast.

## Consequences

- A deleted board or widget costs the row its link and nothing else.
- The evidence chart is the query's result drawn by the starter chart, not the
  widget's own code: the widget may be gone.
- A widget has no address of its own yet, so its name links to its board.
- The board's Source (which origins a board leaves out) is not kept yet,
  because no board has one on this branch. It joins `replayContext`, the JSON
  column beside the window, with no migration.
- Langy does not hand "Save as insight" a structured subject yet
  (`LangyAnswerActionProps.subject`), so no insight filed from the panel
  carries a pointer or a window until it does.
- An old image that folds a new filed event drops the three fields, because it
  does not know them. Replaying the insight projection restores them.
