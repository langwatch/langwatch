# ADR-001: Analytics owns timeseries reads and the LangWatchQL web surface

**Status:** Accepted

**Behavioural contracts:** [Analytics timeseries](../specs/analytics-timeseries.feature)
and [LangWatchQL workbench](../specs/analytics-lwql-workbench.feature)

## Context

Analytics provides tenant-scoped timeseries reads and the reusable browser
surface for LangWatchQL. Dashboard owns graphs and saved charts; Topic, Trace,
and Evaluation own their distinct lifecycles.

## Decision

Analytics owns portable timeseries contracts, conservative table routing,
ClickHouse reads, LangWatchQL browser behaviour, and Vega-Lite policy. The
application owns routes, tRPC transport, saved-chart persistence, and browser
theme/lazy-render ports.

Server-side LangWatchQL execution remains a recorded migration residual under
`platform/app/src/server/analytics/lwql`; it does not define another owner.

## Public surfaces and transports

`@langwatch/analytics-contract` publishes Zod contracts. The server service is
called from composed application transports. `@langwatch/analytics-web` accepts
controlled query, schema, toolbar, error, and chart render ports; it imports no
application hooks or router clients.

## Dependencies

Analytics consumes ClickHouse through its private server repository. Other
features consume its contract, never its repositories or query builders.

## Persistence

Analytics reads ClickHouse. Saved workbench chart records belong to Dashboard;
the browser workbench itself persists nothing.

## Runtime and registration

The application composes one Analytics server service per process and installs
its transports. The web package is mounted by page composition and has no
import-time registration.

## Environment and configuration

The contract and web package read no environment. Deployment configuration is
resolved by application composition and injected into server adapters.

## Errors

Services throw named domain errors. The workbench receives transport failures
through its error render port and preserves their structured metadata.

## Contracts and validation

Timeseries and LangWatchQL response shapes are shared Zod 4 contracts. The
LangWatchQL query output is validated at the tRPC boundary; browser chart policy
validates member-authored Vega-Lite specifications before rendering.

## Consequences

`trace_analytics`, `trace_summaries`, and timeseries rollups remain distinct
server table boundaries. Moving the LangWatchQL workbench does not alter query
routes, response fields, authorization, or those table choices.
