# Spike #5670 — read-only, tenant-isolated user-facing trace query surface

**Type:** SPIKE (research + working prototype). **Owner:** Drew.
**Primary driver:** security & privacy. **Hard constraint:** READ-ONLY.
**Issue:** https://github.com/langwatch/langwatch/issues/5670

This document is the research deliverable. The companion prototype (compiler +
executor + endpoint + demo page) and its executed security tests live in the
same branch — see "Prototype & evidence" below.

---

## TL;DR — recommendation

**Build a structured, allowlist-validated read-only aggregation surface
(Option A→B phased), NOT raw SQL (Option C).** The safe core is a *compiler* that
takes a typed request object + a session-derived tenant and emits ClickHouse SQL
with the tenant predicate injected on the outer query **and** every subquery —
never supplied or removable by the caller — executed read-only under the
existing guardrails.

LangWatch already owns ~70% of this. The spike's real work is three provable
claims, and the prototype proves the load-bearing one:

1. **Isolation is structural, not a convention** — every table reference carries
   a compiler-injected `TenantId` bound to the session tenant. *(Proven: a
   two-tenant ClickHouse test returns zero foreign rows; removing the injection
   turns the test red.)*
2. **Read-only at two independent layers** — inexpressible-by-grammar + a
   read-only DB user/profile. *(Prototype: read-only-by-construction + `readonly`
   execution; production: the `langwatch_ops` SELECT-only user.)*
3. **Execution is governed** — per-query caps proven to fire, plus (production)
   a per-user concurrency cap and a dedicated read replica.

The single most important correction to the issue's framing: the outer-query
tenant predicate is **not** compiler-injected today — it is added by the
repository layer, one call site at a time. For a general query surface that
convention is a footgun; the prototype closes it.

---

## What already exists (verified against source, 2026-07-11)

Two halves of a safe query system exist but are not composed into a user-facing
surface.

### Half 1 — tenant-injecting liqe filter compiler (user-facing today)
`translateFilterToClickHouse(queryText, tenantId, timeRange)`
(`app-layer/traces/filter-to-clickhouse/ast.ts`) compiles the `liqe` filter DSL
to a ClickHouse **WHERE fragment** + bound params. It:
- injects `TenantId = {tenantId:String}` into **subqueries** it generates
  (`subqueries.ts` `boundedSubquery`, `scenarioRunSubquery`);
- parameterizes every value (`value-helpers.ts`), never interpolates;
- allowlists fields (`build-handlers.ts` `FIELD_HANDLERS`/`KNOWN_FIELDS`);
- caps complexity (`MAX_NODE_COUNT=20`, `MAX_PARAM_COUNT=50`,
  `MAX_VALUE_LENGTH=500`).

**⚠ Verified gap (the issue flagged it; confirmed true):** the **outer** query's
tenant predicate is *not* in the returned fragment. It is assembled by the
repository (`repositories/trace-list.clickhouse.repository.ts:59` `buildWhereClause`:
`["TenantId = {tenantId:String}", …timeBounds, filterWhere.sql].join(" AND ")`).
Outer-query scoping is therefore a **caller convention**, not a compiler
guarantee.

### Half 2 — read-only execution + guardrails (operator-only today)
`ops/explain-core.ts` + `routes/ops.ts` — the `/api/ops/clickhouse/explain`
endpoint. Has the dedicated `langwatch_ops` CH user (`GRANT SELECT`, **no
SOURCES grant** → table functions refused at the access layer), a
`readonly_safe` profile, per-query guardrails (`readonly=1`,
`max_execution_time=10`, `max_result_bytes=10MB`, `max_memory_usage=1GB`), a
CH-aware comment/string lexer, table-function + `system.*` + forbidden-keyword
deny-lists, and `redactQueryForAudit` (shape + sha256, literals stripped).
**But:** it is operator-only (ops API key), **EXPLAIN-only** (never executes the
inner query), and **deliberately not tenant-scoped** ("the optimizer agent
legitimately runs cross-tenant EXPLAINs").

### Half 1½ — the analytics aggregation engine (a second, incompatible filter path)
`analytics/clickhouse/aggregation-builder.ts` + `app-layer/analytics/*` produce
aggregation/time-series SQL. Aggregations are a **closed Zod enum**
(`analytics/types.ts`: `terms, cardinality, avg, sum, min, max, median, p99,
p95, p90`); group-by is a **curated registry** (`groupByExpressions`); `TenantId`
is templated into every subquery/JOIN; values are parameterized; identifiers are
never built from caller text. Authorization lives one layer up in the tRPC
procedure (`checkProjectPermission("analytics:view")`), **not** in the builder —
the builder trusts `projectId` unconditionally.

**Key seam finding (changes the issue's "reuse wholesale" framing):** there are
**two filter compilers with incompatible conventions.** The analytics engine has
**no raw-WHERE-fragment hook** — it consumes a structured `filters` record and
owns WHERE construction end-to-end, aliasing `trace_summaries` as `ts` and often
JOINing `stored_spans`. The liqe compiler emits **unaliased** `TraceId` /
`Attributes['x']` / `ContainsErrorStatus = 1` designed for a single-table,
full-column trace-list scan. Splicing a liqe fragment into the analytics builder's
aliased/JOINed/column-pruned shape would break on ambiguous `TraceId`, "Unknown
column" (its FROM only selects regex-detected columns), and ambiguous subqueries.
So "compose Half 1 + the analytics engine" is *not* drop-in.

---

## Recommended approach

**Option A→B, phased. Phase 1 = a structured, typed request object** (not raw
text, not raw SQL), validated against closed allowlists, compiled to ClickHouse
SQL by a compiler that owns tenant scope.

### Why structured-object over the other options
- **vs Option C (constrained raw SQL):** "provably inject a tenant predicate into
  arbitrary user SQL across subqueries/UNION/CTE/correlated/alias tricks" is the
  hardest safety problem here — and the one TRQL explicitly rejected. Disfavored
  unless a strong raw-SQL demand appears.
- **vs a new text grammar (Option B now):** a structured object has **no grammar
  to parse on the aggregation/dimension axes** — every column/function/dimension
  is a finite enum. A future text grammar becomes a *front-end that compiles to
  the same validated request object*, so the safe core is built once.

### Precise security framing (corrects a tempting overstatement)
The right claim is **"safety-by-allowlist-totality,"** not "zero parser attack
surface." Two honest caveats:
1. The optional `filter` field is **still liqe text** — the full liqe parser
   surface is retained for that field (reused deliberately, because it is already
   parameterized, field-allowlisted, and complexity-capped).
2. ClickHouse binds *values*, never *identifiers* — so every column/fn/dimension
   is string-concatenated and is safe **only** because it is allowlist-mapped to a
   developer-authored expression. The failure mode is a single passthrough of a
   caller string as an identifier, or an allowlist entry that itself embeds unsafe
   SQL. A finite enum is genuinely more auditable than a grammar — state it that
   way.

### The one structural rule the allowlist must never break
Only the compiler's own `FROM trace_summaries` and the liqe compiler's
tenant-scoped `TraceId IN (SELECT … WHERE TenantId=…)` subqueries may appear.
**Forbidden:** any un-scoped `FROM`; `dictGet` (dictionaries are not
tenant-scoped); user-supplied JOIN or HAVING; table functions. `arrayJoin` is
permitted (it operates on the already-scoped row's own array — leakage-safe; only
a row-explosion DoS concern, bounded by the memory cap).

### Reuse decision for the prototype (and why it differs from production)
The prototype composes the **liqe filter compiler** (richest existing
user-facing filter surface) with a **thin, single-table aggregation emitter**
over `trace_summaries` — deliberately *not* the analytics `buildTimeseriesQuery`.
The single-table unaliased shape sidesteps all three splice breakages above
(no alias ambiguity, no column pruning, no JOIN). The trade-off is that this
shape cannot grow JOINs while it still consumes liqe text. **For production,
unify on ONE filter IR** — most cleanly a `liqe → structured-filter` transpiler
(AST→AST, not SQL-fragment splice) feeding the analytics builder — so the richer,
better-tested aggregation engine backs the surface.

---

## Threat model — SR-1…SR-9 mapped to primitives

| Req | Threat | Mechanism (prototype) | Status / gap |
|---|---|---|---|
| **SR-1** | Cross-tenant leakage | Compiler injects `TenantId` on outer query + every subquery; tenant param bound **last**, un-overridable; derived from session, never request | **Proven** (two-tenant zero-foreign-rows test, falsifiable). Prod: keep it *structural* as the IR grows (cohort-compare JOINs are the classic regression). |
| **SR-2** | Writes/DDL | (1) inexpressible — request object has no write field; (2) `readonly` execution | Prototype: read-only-by-construction + `readonly=2`. Prod: `langwatch_ops` SELECT-only user (server-side `readonly_safe`). |
| **SR-3** | Injection | All literals bound params; identifiers only from allowlist enums | **Reused/proven** (liqe params + enum identifiers). |
| **SR-4** | Schema/function reach | Closed dimension/metric/op enums; unknown identifier fails validation before SQL | **Done** (Zod enums, fail-closed). |
| **SR-5** | SSRF / table functions | Not in any allowlist (grammar) **and** no SOURCES grant (DB user) | Grammar: **done**. Grant: production `langwatch_ops`. |
| **SR-6** | Resource DoS | Mandatory time bounds; LIMIT ceiling; per-query wall-clock/bytes/memory caps | Per-query: **done** (proven fires via `readonly=1` write-reject + caps). **Gaps:** per-user concurrency cap, per-tenant rate limit, dedicated read replica (no replica exists today — ad-hoc load would contend with the product read path). |
| **SR-7** | AuthN/AuthZ | `checkProjectPermission("analytics:view")`; tenant = the RBAC-checked project | **Done** (endpoint gate). Decide org-vs-project granularity + plan-gating. |
| **SR-8** | PII | Payload columns (input/output/attributes) are filter/aggregate-only, **never** projected and **never** a group-by key; group-by is a curated dimension enum | **Done by construction** (no raw projection in Phase 1). Note: a group-by on a raw attribute would project PII as keys — curated enum prevents it. |
| **SR-9** | Auditability | `redactQueryForAudit` → shape + sha256, literals stripped; tenant + caller + outcome logged | **Reused** (executor logs redacted shape). |

---

## Adversarial review — ranked residual risks (from the devil's-advocate pass)

- **R1 (addressed):** the two incompatible filter compilers. Prototype avoids the
  splice via the single-table emitter; production must unify on one filter IR.
- **R2 (addressed in wording):** "safety-by-allowlist-totality," not "zero parser
  surface" — the `filter` field retains the liqe parser.
- **R3 (headline, proven):** isolation was a single-`{tenantId}`-param
  convention; EXECUTE tests it for the first time. Hardening shipped: bind tenant
  **last**; structural "every table ref carries `TenantId`" assertion; two-tenant
  executed proof. Watch the param-merge order at every future call site
  (`{ tenantId: session, ...userParams }` reversed = game over).
- **R4 (prod gap):** EXECUTE on a shared user has per-query caps but **no
  concurrency/rate ceiling**, on the same cluster the product reads. Cheapest
  adequate answer: `max_concurrent_queries_for_user` + per-tenant rate limit.
  Right answer: dedicated read replica.
- **R5 (bounded):** new constructs a richer aggregation layer could add
  (`dictGet`, user JOIN/HAVING, un-scoped FROM) — encoded as the forbidden list
  above.
- **R6 (strategic):** the analytics flat-enum IR does **not** extend to ratios /
  conditional aggregates / arithmetic between aggregates (it has already accreted
  ~4 query-shape branches). If Option B needs expression composition — it almost
  certainly will — make the Phase-1 IR a **small typed expression AST** with
  allowlisted leaves (columns) and nodes (fns/operators). The isolation mechanism
  (compiler-injected outer scope + allowlisted leaves) transfers unchanged.
- **R8 (done):** group-by stays a curated dimension enum so it can never project
  raw payload/PII as a key.

---

## Prototype & evidence (this branch)

New module `app-layer/traces/trace-query/`:
- `schema.ts` — allowlists (`AGGREGATION_OPS`, `METRIC_COLUMNS`,
  `DIMENSION_COLUMNS`) + Zod request schema (no tenant field; unknown keys
  stripped).
- `compile.ts` — `compileTraceQuery({ request, tenantId })`: the security core.
  Owns outer-query tenant injection; binds tenant/time params **last**; reuses
  `translateFilterToClickHouse` for the filter; clamps LIMIT; mandatory time
  bounds.
- `execute.ts` — `executeTraceQuery(...)`: read-only execution (`readonly=2` +
  per-query caps) + redacted audit log.
- `api/routers/traceQuery.ts` — tRPC `run`, gated by
  `checkProjectPermission("analytics:view")`, tenant = the authorized project.
- `pages/[project]/trace-query.tsx` — minimal demo surface (allowlist-driven
  dropdowns; shows results **and** the compiled tenant-scoped SQL).

**Tests** (`app-layer/traces/trace-query/__tests__/`):
- `compile.unit.test.ts` — 15 SQL-structure assertions (SR-1…SR-6).
- `compile.integration.test.ts` — 8 executed proofs on a real two-tenant
  ClickHouse: the adversarial corpus (subquery/UNION-shaped/filter-injection/
  span-subquery) returns **zero foreign rows**; a control confirms the foreign
  data really is present; a write under `readonly=1` is refused; the full
  compile→execute path redacts its audit shape.

**Falsifiability (run both ways):** deleting the outer `TenantId` predicate turns
4 unit tests **and** 3 integration tests red (the executed query really leaks the
other tenant's rows). Restoring it returns to green. The tests are load-bearing,
not vacuous.

---

## Open questions for the plan (hand-off to planner/Drew)

1. **Expressiveness target** — flat aggregations only, or ratios / conditional
   aggregates? This decides IR shape now (flat enum vs typed expression AST, R6).
2. **Filter IR** — adopt the `liqe → structured-filter` transpiler so the surface
   can back onto the analytics engine and grow JOINs (R1)?
3. **Column allowlist & PII** — confirm the exact returnable/aggregatable column
   set; keep raw payload out of projection (SR-8).
4. **Execution isolation** — dedicated read replica vs shared read-only user;
   per-user concurrency cap + per-tenant rate limit (SR-6/R4).
5. **AuthZ granularity & plan-gating** — org vs project vs environment; tier-gate
   max time-range like TRQL (SR-7)?
