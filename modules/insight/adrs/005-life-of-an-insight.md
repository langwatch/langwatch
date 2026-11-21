# ADR-005: The life of an insight, from found to retired

**Status:** Proposed

**Behavioural contract:** [Insights inbox](../specs/insight-inbox.feature) and
[The daily insights run](../specs/insight-daily-run.feature) hold the steps as they are
today. Each decision below lands with its own scenarios in those files.

## Context

ADR-001 to ADR-004 decide what an insight is made of, whose it is and how a daily run files
one. None of them says what an insight is for, or what happens to it after it is filed. The
owner of the product asked for that life cycle, and asked that an insight be more than "what
changed": it can be a trend, or a gap.

[#8998](https://github.com/langwatch/langwatch/issues/8998) already settled three things: no
insight types (one list, newest first), no labels beyond the verdict, and every filed insight
names a next step, so no "good news" insights. This ADR builds on those and does not reopen
them.

Today's code differs from the life cycle in four places: a run opens a new Langy conversation
each day, the skill compares one day with the day before, nothing enforces a next step, and
nothing counts what a person did with an insight.

## Decision

**An insight is a finding plus a next step.** It comes out of an analysis of the data.
Dashboards show the data; queries (LWQL) are how both a board and a run inspect it; an insight
says what was found and what to do about it. A next step is one of: run an experiment, start an
investigation, collect more or cleaner data, change the agent (a prompt, a model, a tool, an
evaluation), or add a widget or a check so it is seen next time. A finding with no next step is
not filed.

**The daily loop.** Each day, for each board a person turned on (ADR-004):

1. Langy runs the board's stored queries over the run's window and the window before it.
2. Langy compares the results with earlier windows and with the insights it filed before.
3. Langy decides whether something should be done.
4. If so, it files a new insight, or renews an open one it repeats.

A run on a project with no trace since the window's start ends as `nothing` (reason
`no_new_traces`) before Langy reads the board, and files nothing (ADR-004).

**Five life steps.** Code is cited by file and symbol.

| Step     | What happens                                                                                                 | Code today                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Found    | The run files a new insight or renews an open one (same id, new numbers).                                    | `modules/insight/process/src/services/insight-daily-run.service.ts` (`decideRunFindings` call), rule `decideRunFindings` in `modules/insight/process/src/rules/insight-daily-run.rules.ts`                                               |
| Shown    | The bell and the Insights entry in the menu show the count of unseen insights, behind `release_insights`.    | `deriveInsightInbox` in `modules/insight/contract/src/insight-inbox.ts`, `InsightsBell` in `modules/insight/browser/src/ui/sections/insights-bell.tsx`, `InsightsMenuLink` in `modules/navigation/browser/src/ui/sections/main-menu.tsx` |
| Read     | Showing an insight on the Insights page marks it seen, and the count goes down.                              | `useMarkShownSeen` in `modules/insight/browser/src/behavior/use-insight-actions.ts`, `markSeen` in `modules/insight/process/src/services/insight.service.ts`                                                                             |
| Acted on | The person marks it done, keeps it, chats with Langy about it, copies it or says it is not useful.           | `onDone`, `onKeep`, `onChat`, `onCopy` and `onNotUseful` in `modules/insight/browser/src/ui/sections/insights.screen.tsx`, `archive` and `keep` in `modules/insight/process/src/services/insight.service.ts`                             |
| Retired  | Mark done archives it. Unless kept or renewed, it goes stale after its valid days (default 7, from 1 to 90). | `insightFolder` and `insightExpiresAt` in `modules/insight/contract/src/insight-inbox.ts`, `insightValidDaysSchema` and `DEFAULT_INSIGHT_VALID_DAYS` in `modules/insight/contract/src/insight.ts`                                        |

The Insights page has three folders, Inbox, Stale and Archived, all derived by
`insightFolder`. Of what a person does in Acted on, only done and kept are recorded; a chat, a
copy or a "not useful" opens Langy or the clipboard and records nothing.

### Decisions

Each is a reversible default and ships behind the existing `release_insights` flag.

**D1: One Langy thread per board, kept day after day.** This amends ADR-004's rule "The run's
conversation is the person's own": it stays the person's own, but it is one conversation per
schedule (one person, one board), continued by every run, not a new one each day. The schedule
row holds the thread's conversation id. Today the run passes no conversation: `start` in
`modules/langy/process/src/features/turn/services/langy-unattended-turn.service.ts` sends
`requestedConversationId: null`, so `ensureConversation` in
`modules/langy/process/src/features/conversation/services/langy-conversation-lifecycle.service.ts`
mints a new one. Langy then remembers only the titles and keys of up to
`MAX_OPEN_INSIGHTS_IN_BRIEF` (20) open insights the brief lists, in
`modules/insight/process/src/rules/insight-daily-run-brief.rules.ts`. With one thread it can
see what it said yesterday and a trend over many days. A thread that is gone or archived is
replaced by a new one, and the schedule row then holds the new id.

D1 also reverses Langy's own unattended-turn rule. That service comments "Always a
conversation of its own: a run never writes into one the person is chatting in", and
`startUnattendedTurn` in `modules/langy/contract/src/langy.api.ts` documents "in a new
conversation marked as a run". Both change: the turn takes the schedule's conversation id when
it has one. The Langy module owner must agree before D1 lands, and the doc comment, the
service comment and their scenarios are amended with it. The person chatting in the thread is
the cost of this reversal (see the consequences).

The thread's title is `Daily insights - <board>`, with no day, because one thread cannot name
each day. This amends ADR-004's rule that the title "names the board and the day", and
`dailyRunConversationTitle` in `modules/insight/process/src/rules/insight-daily-run.rules.ts`
drops its day part. The title is a reversible default.

**D2: The kinds live in the skill, and the window widens.** The kinds of finding (trend, gap,
data quality, outlier, risk, as well as a change) are named only in the `daily-insights`
skill's prompt. They are never a UI type, a field or a filter, which keeps #8998's "no types".
Today the skill says "A finding is what changed, got worse, got better or needs attention in
the window" (the "What counts as a finding" section of `skills/daily-insights/SKILL.mdx`), and
the window is the last full day against the day before (`dailyRunWindows` in
`modules/insight/process/src/rules/insight-daily-run.rules.ts`). The look-back widens first to
a rolling 7 days, later to 28. The step widens with it: the last full day stays at hourly steps
(`DAILY_RUN_GRANULARITY_SECONDS`, one hour), and the wider window is read in daily steps, so a
28 day window is 28 points per query, not 672. The skill's rule "Before you report a total for
the whole window, read its hourly steps." then applies to the last day only: for the older days
Langy reads the daily steps, and when most of a change falls in one day it names that day and
its numbers. A filed insight's replay window keeps the step its evidence query was answered in,
so a finding from the daily part replays at the daily step. The step is a reversible default.
The run still files at most the person's maximum. A "gap" is a drop or hole in data Langy can
still read in the window, such as a widget, metric or segment going quiet while the project
still has traffic. A project's traffic stopping is ADR-004's `no_new_traces` gate, not a gap.

**D3: "Names a next step" is a rule now, a field later.** The skill tells Langy that every
finding names a next step, and a finding without one is not filed, as
[PR 8880](https://github.com/langwatch/langwatch/pull/8880) built before it was parked. Today
neither the skill nor the finding schema asks for one. A schema field for the next step comes
after the rule has run for a while, so its shape follows what Langy actually writes.

**D4: Outcomes are counted, simplest first.** First count, per run and per board, how many
filed insights were seen, kept and marked done. The insight stream already holds those events
(`INSIGHT_EVENT_TYPES` in `modules/insight/contract/src/insight.constants.ts`), so this needs
no new write.
Whether the number an insight named recovered is measured only after D1 to D3 have landed.

**D5: No "good news" insights.** Settled by #8998 and restated here: an improvement with
nothing to do has no next step, so it is not filed. Today `good` is still a tone a finding and
a filing take (`INSIGHT_TONES` in `modules/insight/contract/src/insight.ts`, the `tone` list in
`skills/daily-insights/SKILL.mdx`).
Stored `good` insights stay readable.

## Consequences

- ADR-004 is amended in part by D1: the run's conversation is one thread per schedule, and its
  title names the board and no day. Its other rules hold: the run's key ceiling holds for
  every turn in the thread, the thread has the origin `run`, and it sends no push
  notification.
- Langy's unattended-turn rule and its contract doc comment are amended by D1, with the Langy
  module owner's agreement.
- The wider window reads daily steps beyond the last day (D2), so the brief's single `Step:`
  line becomes one step per window.
- The handback check (`isHandedBack` in
  `modules/insight/process/src/rules/insight-daily-run-answer.rules.ts`) accepts a stored query
  only with the hourly step written in, and the filed replay window is pinned to
  `DAILY_RUN_GRANULARITY_SECONDS` (`dailyRunReplay` in `insight-daily-run.rules.ts`). Both
  change here: the check accepts the daily step as well, and the replay takes the answered
  step. Otherwise a daily-step query is dropped and the finding files without evidence.
- One thread per schedule means one conversation grows for as long as the run is on. Langy's
  own context handling decides how much of an older day it still reads.
- A person who writes in the thread writes into a conversation the next run continues. The run
  still files only from its own turn's stamped card.
- A wider window makes each run read more rows, and the brief's "window before it" grows with
  it. The 12,000 character limit on the brief is unchanged.
- Until D3's field exists, a next step is prose in the insight's body, and checking it is the
  skill's job, not the module's.
- D4 counts behaviour, not value: an insight marked done may have been done or dismissed.
- None of D1 to D4 adds an insight type, a label or a menu entry.
