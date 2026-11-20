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

**Five life steps.** Citations are at the commit this ADR lands on.

| Step | What happens | Code today |
| --- | --- | --- |
| Found | The run files a new insight or renews an open one (same id, new numbers). | `modules/insight/process/src/services/insight-daily-run.service.ts:306-311`, rule `modules/insight/process/src/rules/insight-daily-run.rules.ts:177` |
| Shown | The bell and the Insights entry in the menu show the count of unseen insights, behind `release_insights`. | `modules/insight/contract/src/insight-inbox.ts:77`, `modules/insight/browser/src/ui/sections/insights-bell.tsx:27`, `modules/navigation/browser/src/ui/sections/main-menu.tsx:98-112` |
| Read | Showing an insight on the Insights page marks it seen, and the count goes down. | `modules/insight/browser/src/ui/sections/insights.screen.tsx:171`, `modules/insight/process/src/services/insight.service.ts:87` |
| Acted on | The person marks it done, keeps it, chats with Langy about it, copies it or says it is not useful. | `modules/insight/browser/src/ui/sections/insights.screen.tsx:207-218`, `modules/insight/process/src/services/insight.service.ts:114-122` |
| Retired | Mark done archives it. Unless kept or renewed, it goes stale after its valid days (default 7, from 1 to 90). | `modules/insight/contract/src/insight-inbox.ts:33-42`, `modules/insight/contract/src/insight.ts:15-16` |

The Insights page has three folders, Inbox, Stale and Archived, all derived by
`insightFolder`. Of what a person does in Acted on, only done and kept are recorded; a chat, a
copy or a "not useful" opens Langy or the clipboard and records nothing.

### Decisions

Each is a reversible default and ships behind the existing `release_insights` flag.

**D1: One Langy thread per board, kept day after day.** This amends ADR-004's rule "The run's
conversation is the person's own": it stays the person's own, but it is one conversation per
schedule (one person, one board), continued by every run, not a new one each day. The schedule
row holds the thread's conversation id. Today the run passes no conversation
(`modules/langy/process/src/features/turn/services/langy-unattended-turn.service.ts:70-75`), so
Langy mints a new one
(`modules/langy/process/src/features/conversation/services/langy-conversation-lifecycle.service.ts:67-68`).
Langy then remembers only the titles and keys of up to 20 open insights the brief lists
(`modules/insight/process/src/rules/insight-daily-run-brief.rules.ts:18`). With one thread it
can see what it said yesterday and a trend over many days. A thread that is gone or archived
is replaced by a new one, and the schedule row then holds the new id.

**D2: The kinds live in the skill, and the window widens.** The kinds of finding (trend, gap,
data quality, outlier, risk, as well as a change) are named only in the `daily-insights`
skill's prompt. They are never a UI type, a field or a filter, which keeps #8998's "no types".
Today the skill says "A finding is what changed, got worse, got better or needs attention in
the window" (`skills/daily-insights/SKILL.mdx:48`), and the window is the last full day against
the day before (`modules/insight/process/src/rules/insight-daily-run.rules.ts:73-89`). The
look-back widens first to a rolling 7 days, later to 28. The run still files at most the
person's maximum.

**D3: "Names a next step" is a rule now, a field later.** The skill tells Langy that every
finding names a next step, and a finding without one is not filed, as
[PR 8880](https://github.com/langwatch/langwatch/pull/8880) built before it was parked. Today
neither the skill nor the finding schema asks for one. A schema field for the next step comes
after the rule has run for a while, so its shape follows what Langy actually writes.

**D4: Outcomes are counted, simplest first.** First count, per run and per board, how many
filed insights were seen, kept and marked done. The insight stream already holds those events
(`modules/insight/contract/src/insight.constants.ts:10-12`), so this needs no new write.
Whether the number an insight named recovered is measured only after D1 to D3 have landed.

**D5: No "good news" insights.** Settled by #8998 and restated here: an improvement with
nothing to do has no next step, so it is not filed. Today `good` is still a tone a finding and
a filing take (`modules/insight/contract/src/insight.ts:5`, `skills/daily-insights/SKILL.mdx:58`).
Stored `good` insights stay readable.

## Consequences

- ADR-004 is amended in part by D1. Its other rules hold: the run's key ceiling holds for
  every turn in the thread, the thread has the origin `run`, and it sends no push
  notification.
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
