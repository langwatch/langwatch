# ADR-001: One aggregate per insight, reader state in its own projection

**Status:** Accepted

**Behavioural contract:** [Insights inbox](../specs/insight-inbox.feature)

## Context

An insight is a short finding about a project, filed for one person: by that
person saving a Langy answer, or by Langy on a run. The prototype shows an inbox
with Inbox, Stale and Archived folders, an unseen count in the sidebar and a bell
in the top bar. An insight is read by its owner alone
([ADR-003](./003-personal-insights.md)). This record first made it the project's,
with only seen, done and kept personal; ADR-003 replaced that.

A daily run will later renew insights (a new body, a new validity window), so
the record has a history worth keeping.

## Decision

The `insight_processing` pipeline holds one aggregate per insight, keyed by the
insight id and grouped by project. Four commands: `file`, `mark_seen`,
`archive` and `keep`. The api only sends; the worker folds.

Two Postgres projections:

- `InsightProjection`: the insight and whose it is (owner, title, body, tone,
  topic, validity, source). Folded from `filed` only.
- `InsightReaderProjection`: one row per insight and reader, keyed
  `insightId:userId`, holding `seenAt`, `archivedAt` and `keptAt`. An insight has
  one reader, its owner (ADR-003); the table stays apart so a later forward can
  add readers.

Folders are not stored. They are derived at read time from the entry, the
reader's row and the clock (`deriveInsightInbox` in the contract), so an
insight moves to Stale without a job.

The filer's own insight is marked seen when it is filed, so saving an answer
does not light up the filer's own badge.

## Consequences

- A read is two queries: the owner's insights in the project, then their reader
  rows for them. The list is capped at 500 per owner and project (ADR-003).
- The browser writes optimistically into the cached list, because the read
  hint arrives only after the worker folds.
- Renewal (slice 3) adds a `renewed` event to the same aggregate; the reader
  projection does not change.
- Permissions reuse `analytics:view` for every procedure, filing included
  (ADR-003), until the owner decides on a separate set.
