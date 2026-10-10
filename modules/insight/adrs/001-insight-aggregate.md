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

## Public surfaces and transports

One tRPC router, `insight`, in `process/src/transport/insight.trpc.ts`. The inbox:
`getAll`, `file`, `markSeen`, `archive` and `keep`. A person's daily run on a board:
`getBoardDailyRun`, `configureBoardDailyRun` and `turnOffBoardDailyRun`
([ADR-004](./004-daily-run.md)). Each takes `analytics:view`
([ADR-003](./003-personal-insights.md)) and answers for the caller alone, and the six
writes are refused on the aggregate. There is no REST route: the action under a Langy
answer calls `file` from the browser. The browser half lends the shell a bell and a
sidebar count. The operator task `insight-daily-run-request` asks for one run.

## Dependencies

The contract depends on the handled-error and module packages. The process half
depends on the contracts of analytics, authz, dashboard, feature-flag, langy,
project and user, and on the eventing, process, task and Prisma packages. The
browser half depends on the analytics, langy and feature-flag clients. No module
depends on insight.

## Persistence

Three Postgres projections: `InsightProjection`, `InsightReaderProjection` and
`InsightDailyScheduleProjection` (ADR-004). The insight and reader tables are
folded from the `insight_processing` stream, and the schedule table from
`insight_daily_run`. Migrations `20261010120020` to `20261010120022` and
`20261010120031` create them and add the board pointer and the owner. ClickHouse is
not used. Nothing is deleted when a member leaves.

## Runtime and registration

`insightProcessModule` is listed for the api, the worker and the tasks runner. The
worker folds both pipelines and hosts the daily run pipeline's two process managers.
`dailyInsightsSchedule` is keyed by person and board: it arms each schedule's wake and
hands a run to its outbox, from a wake or from the operator task.
`dailyInsightsScheduleReconcile` is a scheduled singleton that arms, hourly, any
schedule that is on with no wake. There is no cron route and no timer. Every procedure
and command checks the `release_insights` flag for the project and throws
`insights_not_enabled` while it is off.

## Environment and configuration

None of its own. Module code reads no `process.env` value. The flag comes from the
feature-flag module, and the repositories and clients are handed in at composition.

## Errors

Two handled errors, both in the contract. `insight_not_found` (404) answers an
unknown insight and another person's insight alike (ADR-003).
`insights_not_enabled` (403) answers a call while the flag is off. Turning a daily run
on for a stored board the caller cannot open answers the dashboard module's own
`dashboard_not_found` (404).

## Contracts and validation

Zod schemas in `contract/src` define every input, output and event. An insight
title holds 1 to 200 characters and a body up to 20,000. The run holds a finding
to 120 and 4,000, and refuses the whole answer when its findings block does not
parse (ADR-004). A read returns at most 500 insights per owner and project
(ADR-003). Events carry calendar versions, and later fields are additive with
defaults.

## Consequences

- A read is two queries: the owner's insights in the project, then their reader
  rows for them. The list is capped at 500 per owner and project (ADR-003).
- The browser writes optimistically into the cached list, because the read
  hint arrives only after the worker folds.
- Renewal (slice 3) adds a `renewed` event to the same aggregate; the reader
  projection does not change.
- Permissions reuse `analytics:view` for every procedure, filing included
  (ADR-003), until the owner decides on a separate set.
