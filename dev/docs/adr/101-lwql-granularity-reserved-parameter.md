# ADR-101: Datapoint granularity is a fourth reserved LangWatchQL parameter, bound and budgeted server-side

**Date:** 2026-08-24

**Status:** Accepted

**Relates to:** [ADR-081](./081-lwql-table-function-and-ssrf-policy.md) (submitted SQL is never rewritten — the same rule this decision extends to granularity), [ADR-084](./084-lwql-postgres-mapping-tenant-predicate.md) (the same reserved-parameter shape applied to `period_start`/`period_end`).

Behavioural contract: [specs/analytics/lwql-workbench.feature](../../../specs/analytics/lwql-workbench.feature).

## Context

A saved LangWatchQL chart placed on a dashboard needs to bucket its datapoints
at a size the member controls — per-second, per-minute, per-hour — windowed by
the dashboard's own date range. The statement's SQL text is fixed at save
time; the bucket size is a per-render choice made by whatever surface renders
the chart next.

Two things collide when a caller controls both the window and the granularity of
the same query. First, bucket count is the actual cost driver of a chart query,
independent of the window's span: `INTERVAL 1 SECOND` over a seven-day range is
604,800 buckets from a completely ordinary pairing, already past a workable
ceiling. Second, ClickHouse compiles the unit half of an `INTERVAL` expression
to a function name — `INTERVAL 1 HOUR` becomes `toIntervalHour(1)` — so the unit
cannot itself be a bound value; only the multiplier can. A caller who could set
that multiplier without the server capping it at a fixed unit could ask for
whatever bucket count they wanted, self-serve, in every request.

The `period_start`/`period_end` reserved-parameter contract (predates this
decision) already solved the adjacent problem of a surface varying a value
inside an otherwise-fixed statement text without rewriting the statement.
Granularity extends the same shape rather than inventing a second one.

## Decision

**`period_granularity_seconds` joins `period_start` and `period_end` as a
reserved LangWatchQL parameter name**, declared in a statement as
`{period_granularity_seconds:UInt32}` and used as the seconds multiplier of a
fixed-unit interval: `INTERVAL {period_granularity_seconds:UInt32} SECOND`.
Fixing the unit at seconds and making only the multiplier bindable is what
lets ClickHouse's compile-time unit requirement and a caller-set bucket size
coexist at all — the surface has exactly one value left to inject, and it is a
value, not a function name.

The three reserved names share one refusal: **a request carrying a value for
any of them is refused**, whether or not the statement declares it. Each name is
set by whatever is showing the chart; a caller who supplies one is pinning
something that will then ignore its own surface. Declaration-time and run-time
are policed by the same validator (`resolveTimeWindow.ts`) so tRPC, REST and
anything added later cannot drift from each other.

Granularity carries a second contract the window pair does not: **a server-side
bucket-count budget**, `LWQL_GRANULARITY_MAX_BUCKETS = 10_000`, enforced as
`ceil(window_seconds / step_seconds) <= budget`. The offered steps are fixed at
`[1, 60, 3_600]` seconds — one second, one minute, one hour — and only a step
from that list is ever accepted; day-scale is out of scope for now (a fixed
86,400-second interval has no notion of a local day and drifts off midnight on
a DST-transition date, measured against ClickHouse 25.10 over the
Europe/Amsterdam fallback night). Overflow has two designed outcomes, chosen by
the caller of the resolver rather than by the request:

- **Refuse** — the workbench and the REST route, where the caller chose the
  step, get `LangWatchQLGranularityTooFineError` and must pick a coarser one
  themselves.
- **Coarsen** — the dashboard, which owns the range but not the caller's
  original step choice, gets silently bumped to the finest offered step that
  fits the budget, with `coarsenedFromSeconds` set so the widget can name
  requested and effective side by side rather than changing a shared control's
  meaning without saying so.

A window that overflows even the coarsest offered step (one hour) refuses in
both modes — the budget is a hard cap, not a preference coarsening may trade
away.

**Declaring granularity without both period bounds is refused at save time**,
not run time: without a window there is nothing to compute the budget against,
and refusing at save means an author learns their statement is unrunnable
before it is anywhere a caller can hit it.

## Rationale / Trade-offs

**Granularity is a cost dial, and the budget is what keeps a caller from moving
it past a workable size.** Nothing about the statement's SQL text changes
between a fine and a coarse render — same submitted string, same
`system.query_log` entry pattern the "never rewritten" guard already protects.
Only the bound multiplier changes, which is the mechanism the reserved-parameter
contract exists for.

**Server must vary the value against an immutable query text.** A saved chart's
identity is its SQL text; a dashboard that coarsens on overflow, a cache keyed
on the statement, and an audit trail reading `system.query_log` all depend on
that text staying byte-identical across every render at every granularity. If
granularity were expressed by rewriting the statement — splicing in a different
literal `INTERVAL` — the saved chart would carry as many effective identities as
it has been rendered at, and the "never rewritten" guard from ADR-081/084 would
have to carve out an exception for exactly the case those ADRs exist to close.
Binding a parameter, the same mechanism the window pair already uses, keeps one
statement and N bound values instead of N statements.

**Trust boundary: the server is the final author of the value, never the
caller.** The three refusals — reserved-name type check, caller-supplied
check, off-list step check — exist because the granularity multiplier is the
one part of the query the caller does not get to choose freely, even though it
looks, syntactically, like an ordinary bound parameter. Membership in
`LWQL_GRANULARITY_STEPS` is checked by list membership rather than "is a
positive integer", because coarsening picks its answer from that same list: an
off-list step admitted at the boundary (7,200 seconds, say) could be
"coarsened" to the one-hour step — finer than what was asked for — and reported
as a coarsening, which inverts the guarantee.

**Known deviation, tracked separately.** The tRPC run path currently forwards
the caller's `onBudgetOverflow` choice rather than fixing it server-side per
surface (workbench/REST refuse, dashboard coarsens, decided by which door the
request came through — not by a client-supplied flag). This is tracked as
[#7502](https://github.com/langwatch/langwatch/issues/7502) and is not resolved
by this ADR; it is recorded here so the gap is not silently normalized as the
design.

## Alternatives considered

**A per-request `LIMIT`-style clamp on returned rows, applied after the query
runs.** Rejected: it would not touch the actual query cost — ClickHouse still
computes every bucket the fine-grained `INTERVAL` produces — and it hides
exactly the overflow the budget exists to name. A member would get a
silently-truncated chart with no signal that the range they asked for was too
fine for the step they asked for.

**Let the caller pass any positive step, unbounded, and cap only the resulting
bucket count with a hard row limit at the client.** Rejected for the same
reason ADR-084 rejected `additional_table_filters` and statement rewriting for
the window pair: it moves the enforcement point to a place that does not
prevent the expensive read from happening, only from being displayed in full.
The budget has to sit where the query is bound, before ClickHouse executes it.

## Consequences

- `period_granularity_seconds` is reserved wherever `period_start`/`period_end`
  are: schema browser listings, the caller-supplied-parameter refusal, and the
  save-time validator. A statement can decline the contract entirely — an
  all-time, ungranulated total is a legitimate chart — but cannot declare it
  halfway (granularity without both period bounds refuses at save).
- Day-scale granularity remains unavailable until a reserved `period_timezone`
  parameter exists; the namespace (`period_` prefix) already anticipates it.
  Tracked as a follow-up, not part of this decision.
- `timeWindow.ts` keeps zero imports, including for granularity: the workbench
  reads the same module the database is bound with, and the policy — the
  handled errors, the budget arithmetic — stays in `resolveTimeWindow.ts`,
  which the browser never loads.
- The tRPC-forwarded-`onBudgetOverflow` deviation ([#7502](https://github.com/langwatch/langwatch/issues/7502))
  is open. Until it closes, a workbench-style caller reaching the run path
  through tRPC can, in principle, ask for `coarsen` instead of being refused —
  narrower than the REST/workbench contract this ADR describes, and worth
  re-reading this ADR against once it lands.

## References

- Issue [#6713](https://github.com/langwatch/langwatch/issues/6713) — saved-chart granularity, slice 3 of the saved-charts epic ([#6582](https://github.com/langwatch/langwatch/issues/6582))
- Issue [#7502](https://github.com/langwatch/langwatch/issues/7502) — tRPC run forwards client `onBudgetOverflow` instead of fixing it per surface
- PR [#7426](https://github.com/langwatch/langwatch/pull/7426) — ships the contract this ADR describes
- `platform/app/src/server/analytics/lwql/timeWindow.ts` — the reserved-parameter vocabulary, `LWQL_GRANULARITY_STEPS`
- `platform/app/src/server/analytics/lwql/resolveTimeWindow.ts` — `resolveLangWatchQLGranularity`, `assertLangWatchQLGranularityDeclaration`, the budget
- `specs/analytics/lwql-workbench.feature` — the behavioural contract
- [ADR-081](./081-lwql-table-function-and-ssrf-policy.md) — submitted SQL is never rewritten
- [ADR-084](./084-lwql-postgres-mapping-tenant-predicate.md) — the reserved-parameter shape this decision extends
