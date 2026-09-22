# ADR-142: LangWatchQL catalog inclusion is opt-in

**Date:** 2026-09-22

**Status:** Accepted

**Relates to:** [ADR-136](./136-lwql-postgres-catalog-derived-opt-out.md) (whose opt-out inclusion policy this amends — the derivation machinery it built stands unchanged) and [ADR-141](./141-the-app-owns-the-lwql-access-model.md) (the app now writes the catalog's grants on boot).

Behavioural contract: [specs/lwql/catalog-inclusion.feature](../../../specs/lwql/catalog-inclusion.feature), [specs/lwql/postgres-catalog.feature](../../../specs/lwql/postgres-catalog.feature).

## Context

ADR-136 made the PostgreSQL half of the LangWatchQL catalog derived from the
Prisma manifest, and it chose the same **opt-out** shape the ClickHouse half
already had: every tenant-scoped table becomes a view *unless* it is named, with
a reason, on a skip list (`postgresSkippedModels.ts` / `skippedTables.ts`). That
was the right call for closing the gap where a table like `Topic` was
unreachable only because nobody had hand-written its view — exposure by default
turned "why is this table missing" into "why is this one skipped."

[ADR-141](./141-the-app-owns-the-lwql-access-model.md) then made the application
write the access model — the approved views, the reader role, and the column
grants — straight from the catalog on boot, on every distribution. That changes
the risk calculus of opt-out. Under opt-out, a new Prisma model or ClickHouse
table with an owning tenant column is catalogued automatically, which now means
it is *granted* automatically: a table added for an unrelated feature becomes
readable through the analytics door the moment it ships, with no deliberate act
and no review of whether a project's `analytics:view` key should reach it. The
default failure mode flipped from "a table is silently unreachable" (annoying)
to "a table is silently reachable" (a data-exposure question).

[#8263](https://github.com/langwatch/langwatch/issues/8263) asks for the safer
default now that grants follow the catalog.

## Decision

We flip both halves of the catalog from opt-out to **opt-in**. Each store has
one include list — `catalog/postgresIncludedModels.ts`
(`LWQL_POSTGRES_INCLUDED_MODELS`) and `catalog/includedTables.ts`
(`LWQL_CLICKHOUSE_INCLUDED_TABLES`) — and presence on that list is the one and
only way a model or table enters the catalog. A model or table not on its list
is simply not queryable and needs no entry anywhere to stay off; the skip lists
and their reason-prefix machinery are deleted.

- **Unlisted is ignored, silently and safely.** No view, no approved view, no
  grant. There is no reason string to write for the thing you are *not*
  exposing, because absence is the default.
- **Listed-but-missing fails loudly.** An include entry that names no manifest
  model or table — or a duplicate, or (for ClickHouse) an entry that is also
  hand-written — throws from the derivation, naming the entry. An included model
  that has no owning tenant column and no `tenantVia` override still fails the
  build exactly as before.
- **Column-level skips stay override-level.** An override's `skipColumns` still
  strips individual columns from a view that is otherwise included. Whole
  models/tables are governed by the include list alone.
- **The derivation machinery of ADR-136 is unchanged.** Tenant-scope resolution,
  safe defaults (secrets/emails stripped, content and cost columns gated), the
  fan-out join chains, the parity manifests and the coverage guards all stay;
  only the gate at the front — "is this named on the include list" instead of
  "is this absent from the skip list" — changed. The include lists were seeded
  with exactly the set the opt-out derivation produced, so the shipped catalog,
  its grants, and the published query reference are byte-identical.

## Rationale / Trade-offs

Opt-out optimises for never forgetting to expose a table; opt-in optimises for
never exposing one by accident. With ADR-141 wiring the catalog directly to the
grants a customer API key can use, exposure-by-accident is the worse failure,
and it is the one an opt-out default actively invites: the reviewer of a routine
schema migration is not thinking about the analytics surface, yet under opt-out
their new tenant-scoped table joins it automatically.

The cost is real but small and one-directional: making a new model or table
queryable now takes a deliberate one-line addition to its include list, and a
reviewer who wants a table exposed has to say so. That is the same review
question opt-out asked ("should this be reachable?"), moved to the safe side of
the default. The coverage guards keep both directions honest — a model that
falls off the manifest, or an include entry that no longer resolves, still fails
CI rather than drifting.

## Consequences

- **Positive.** A new Prisma model or ClickHouse table is unreachable through
  LangWatchQL, and ungranted, until it is deliberately listed. The catalog and
  its grants only ever grow by an explicit act that shows up in a diff.
- **Positive.** The skip lists and their reason-prefix validators are gone; the
  only per-model/table artifact left is a name on an include list, grouped by
  domain for review.
- **Negative.** A table a project *should* be able to query is invisible until
  someone adds it — the ADR-136 gap (`Topic` unreachable) can recur for a genuinely
  new table if nobody lists it. The coverage guards make the split visible but do
  not decide inclusion; that judgment is now a required, deliberate step.
- **Neutral.** No runtime, provisioning, or wire behaviour changes on this flip:
  the include lists reproduce the exact catalogue ADR-136 shipped.

## References

- Issue: [#8263](https://github.com/langwatch/langwatch/issues/8263)
- Amends: [ADR-136](./136-lwql-postgres-catalog-derived-opt-out.md) (inclusion policy only; the derivation stands)
- Related: [ADR-141](./141-the-app-owns-the-lwql-access-model.md) — the app writes grants from the catalog
- Specs: [specs/lwql/catalog-inclusion.feature](../../../specs/lwql/catalog-inclusion.feature), [specs/lwql/postgres-catalog.feature](../../../specs/lwql/postgres-catalog.feature)
- `platform/app/src/server/analytics/lwql/catalog/postgresIncludedModels.ts` — the Postgres include list
- `platform/app/src/server/analytics/lwql/catalog/includedTables.ts` — the ClickHouse include list
