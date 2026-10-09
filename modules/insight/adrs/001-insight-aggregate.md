# ADR-001: One aggregate per insight, reader state in its own projection

**Status:** Accepted

**Behavioural contract:** [Insights inbox](../specs/insight-inbox.feature)

## Context

An insight is a short finding about a project, filed by Langy or by a member
saving a Langy answer. The prototype shows an inbox with Inbox, Stale and
Archived folders, an unseen count in the sidebar and a bell in the top bar.
Marking an insight done or keeping it is a personal act: one member clearing
their inbox must not clear it for the team.

A daily run will later renew insights (a new body, a new validity window), so
the record has a history worth keeping.

## Decision

The `insight_processing` pipeline holds one aggregate per insight, keyed by the
insight id and grouped by project. Four commands: `file`, `mark_seen`,
`archive` and `keep`. The api only sends; the worker folds.

Two Postgres projections:

- `InsightProjection`: the shared record (title, body, tone, topic, validity,
  source). Folded from `filed` only.
- `InsightReaderProjection`: one row per insight and reader, keyed
  `insightId:userId`, holding `seenAt`, `archivedAt` and `keptAt`.

Folders are not stored. They are derived at read time from the entry, the
reader's row and the clock (`deriveInsightInbox` in the contract), so an
insight moves to Stale without a job.

The filer's own insight is marked seen when it is filed, so saving an answer
does not light up the filer's own badge.

## Consequences

- A read is two queries: the project's insights, then the reader's rows for
  them. The list is capped at 500 per project.
- The browser writes optimistically into the cached list, because the read
  hint arrives only after the worker folds.
- Renewal (slice 3) adds a `renewed` event to the same aggregate; the reader
  projection does not change.
- Permissions reuse `analytics:view` (read, mark seen, archive, keep) and
  `analytics:manage` (file) until the owner decides on a separate set.
