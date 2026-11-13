# ADR-202: ClickHouse row policies enforce tenancy for every read, then a typed builder replaces raw SQL

**Date:** 2026-11-13

**Status:** Proposed (draft, not decided)

**Builds on:** ADR-084 (tenant isolation lives in ClickHouse), ADR-159 (the app owns the LangWatchQL access model), ADR-177 (aggregate project reads through grants), ADR-198 (access tiers), ADR-200 (LangWatchQL isolation), ADR-201 (braids)

**Scope note:** `dev/docs/plans/clickhouse-row-policies-scope.md`

## Context

Tenancy on application reads is enforced today by two text checks over SQL, both in `packages/clickhouse-client`:

- **The fence** (`authorized-reads.ts`, 1,682 lines). A repository writes a marker (`{{tenantScope:Col}}`, `{{tenantSet}}`, `{{tenantScopeWithConditions:...}}`, `{{tenantScopeForLatestVersion:...}}`) and the client expands it from the authorization proof: own projects, shared windows (ADR-177) and braid clauses under a held-trace semi-join (ADR-201 §3). Around it sit an election allow-list, per-arm marker coverage, refusal of aliases named after columns it reads, pinned settings (`prefer_column_name_to_alias`, `enable_global_with_statement`), refusal of IN-over-table, `joinGet` and `dict*`, and a proof expiry cap. Five review rounds on braids each found a new bypass shape in that parser.
- **The tenant guard** (`tenantGuard.ts`). Every other statement must carry `TenantId = {p:String}` or a declared `TenantId IN` set bound to the request's `tenantId` / `tenantIds`, or opt out with `SKIP_TENANT_CHECK: true` under a reason comment.

Both read the SQL as text. Neither can prove a statement reads only the rows it names: a subquery, a join side, a CTE or an alias the parser does not model can reach another tenant. The scope note counts about 23 ClickHouse files that read through the fence, about 48 that write the predicate by hand, and about 47 call sites that skip the check.

LangWatchQL already solved the same problem for untrusted SQL by moving the check into ClickHouse: one restricted user, a row policy per source table whose predicate reads a per-query custom setting (`getSetting('custom_api_key_hash')`), and a profile that pins the dangerous settings (ADR-159, ADR-200). ClickHouse applies a row policy inside every query shape (CTE, `UNION ALL`, both join sides, subqueries, `merge()`), so the policy, not the submitted text, bounds the read.

## Decision

Three steps, each shippable alone, in this order.

### 1. Row policies on every tenant table, keyed by a per-query setting

- The application's reading identity becomes a dedicated ClickHouse user, `langwatch_app_reader` (name open), with a settings profile `langwatch_app_reader_profile`.
- Every table that holds tenant rows gets one row policy for that user: `CREATE ROW POLICY OR REPLACE <table>_tenant ON <db>.<table> USING <TenantColumn> IN tenantSetOf(getSetting('SQL_langwatch_tenant_ids')) TO langwatch_app_reader`. The tenant column is per table (`TenantId` on most, `project_id` on `stored_objects`); the definition lists it, as `LangWatchQLTable.tenantColumn` does.
- The exact predicate form is chosen by measurement, not here: `has(splitByChar(',', getSetting(...)), TenantId)` or an `IN` over the split array. The one that `EXPLAIN indexes = 1` shows pruning on the primary key of `stored_spans`, `trace_summaries` and `event_log` wins (see Performance).
- The client sets `SQL_langwatch_tenant_ids` on every read from what it already knows: the proof's tenant set for a fenced read (own, shared and braided owners), the request's `tenantIds` for a declared set, `[tenantId]` otherwise. A read with no tenant set is refused before it is sent. The value travels as a request setting, never in the statement text.
- The client refuses any statement text that names the setting's prefix (`SQL_langwatch_`) or carries its own `SETTINGS` clause naming it, because a query-level `SETTINGS` overrides the request setting, including in a subquery. This is a one-token check, not a parser.
- The profile pins, `CONST`: `use_query_condition_cache = 0` and `use_query_cache = 0` unless measured safe on the server version (ADR-200 found the condition cache crossing tenants on 25.10 with a setting-keyed policy), `allow_introspection_functions = 0`, and the fence's existing pins. The tenant setting itself stays changeable, with `log_query_settings` left on: tenant ids are not secrets, unlike the LangWatchQL capability.
- The access model is one more entry in ADR-159's single typed definition, delivered by its two emitters: rendered `users.d` (chart-managed and `clickhouse-serverless`) and SQL DDL (ClickHouse Cloud, BYO). It is never a goose migration: goose DDL for access entities reaches one replica only, the reason ADR-159 rejected `ON CLUSTER`.
- A table without a policy is readable in full by every user (ADR-200 item 4, confirmed on 26.8; haven sets `users_without_row_policies_can_read_rows` to true explicitly). A guard test therefore fails when a table carrying a tenant column has no policy in the definition, and the migration-safety scan refuses a new tenant table without one.
- **Tenant tables the reader is never granted.** `lwql_api_key_tenant_map` holds `KeyHash`, which ADR-200 keeps to the LangWatchQL identity. `event_log` and `event_log_id_index` are eventing's: it reads its own log through its own surface (ARCHITECTURE.md §7), and slice 2 decides which identity it uses. The reader has no grant and no policy on any of them, so a read fails closed for want of a grant. The guard test classifies each with its reason and still fails on any table it does not classify.
- **The reader's own query log.** On 26.8 every user holds an implicit `SELECT` on `system.user_query_log`, which lists the statements and settings logged under that user's name; `REVOKE` does not remove it. Every tenant shares the reader, so a read for tenant A could list tenant B's statements and tenant set. The reader therefore carries one more row policy, `USING 0` on `system.user_query_log`, which both emitters render (`CREATE ROW POLICY`, and `databases.system.user_query_log.filter` in users.d). `query_log`, `processes`, `query_views_log` and `text_log` need a grant the reader does not hold. Rejected: `log_queries = 0 CONST`, which drops every application read from the operator's `query_log`; a server-side switch, which provisioning cannot check on a target.

### 2. A typed query builder

Described below. It replaces hand-written SQL in repositories so the tenant predicate, named parameters and the setting are produced by construction.

### 3. An oxlint rule banning raw SQL into the client

Once a module has moved, `langwatch/no-raw-clickhouse-sql` refuses a string or template literal passed as `sql` to the client in that module's repositories. It ships at error with a shrink-only baseline, the same ratchet as `eventing-table-access`.

## How braids fit

The policy admits the proof's tenant set: own projects, shared projects and every braided owner. The braid conditions, the shared and braid time windows and the held-trace semi-join **stay in the fence** (later, in the builder).

Why not in the policy:

- A row policy is static DDL delivered by rendered config or DDL on every replica (ADR-159). A braid's compiled predicate is per-reader data saved at run time. Putting it in a policy would mean a policy per braid and a config roll per save.
- A policy predicate can only read settings, constants and subqueries over tables. Expressing per-owner windows and per-clause predicates through settings would rebuild the fence's renderer inside a setting string, with the same attack surface.
- The held-trace semi-join reads the reader's own spans. Inside a policy it would run as a subquery on every read of `stored_spans`, including reads that do not need it.

What this buys: after step 1, a fence bug can at worst show rows of a tenant the proof already names (a window too wide, a braid condition not applied), never a tenant outside the proof. The cross-organisation leak class closes; the within-proof class stays the fence's job and the builder's.

Open option, not decided: windows only (no conditions) could move into the policy as parallel array settings, the shape the fence already binds with `transform`. See open questions.

## What needs a policy-exempt identity

Row policies filter `SELECT` only. A second user, `langwatch_app_system` (name open), has no row policy and is used only where a read must span tenants or where the policy must not apply.

| Path                                                                | Identity                           | Why                                                                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inserts (projections, event appends, coalesced inserts)             | system, or reader if verified safe | Row policies do not filter `INSERT`. The risk is materialised views (next row)                                                                                          |
| Materialised views triggered by an insert (id-index fills, rollups) | system until proven                | Must be tested: if the MV's `SELECT` over the inserted block applies the reader's policy and no setting is present, the MV writes nothing. Silent data loss, not a leak |
| Goose migrations, `pnpm task upgrade` (tasks app)                   | system (today's admin URL)         | DDL, `INSERT ... SELECT` backfills, all tenants                                                                                                                         |
| Background steps that walk every tenant (`SKIP_TENANT_CHECK` today) | system                             | Retention, id-index fill, replay, storage footprint, usage meters                                                                                                       |
| Mutations (`ALTER ... DELETE`, lightweight delete)                  | system                             | Not filtered by policies; already tenant-predicated in text                                                                                                             |
| Worker reads for one tenant (projections reading back, subscribers) | reader                             | Same as api                                                                                                                                                             |
| api reads                                                           | reader                             | The point of this ADR                                                                                                                                                   |

Keeping the exempt identity narrow:

- The client exposes it only through `SKIP_TENANT_CHECK: true`, which is already counted, logged and reason-checked by `langwatch/skip-tenant-check-reason`. A skipped statement is sent on the system identity; nothing else is.
- The api process is not given the system credential at all (decided: the api serves a few Ops reads today; those move to the worker or to an `*Api` call on ops). Only worker and tasks hold it.
- The system user's grants exclude `access_management`; only the provisioning path (the existing LangWatchQL admin target) creates policies.

## FINAL, dedup, GLOBAL IN, Distributed, routed orgs

- **`FINAL` and IN-tuple dedup.** ClickHouse applies the policy before `FINAL` collapses versions. That is correct only when the tenant column is in the sorting key of every Replacing, Collapsing or Aggregating table, so all versions of a row share it. A guard test asserts this per policy-bearing table; a table that fails gets its policy on a column that is in the key, or stays on the fence until migrated.
- **`GLOBAL IN` and subqueries.** The policy applies to every table a subquery reads, so the fence's IN-over-table refusal becomes defence in depth rather than the only line.
- **Distributed tables.** None in the schema today (no `ENGINE = Distributed` in `packages/clickhouse-migrations`). If one appears, the policy must sit on the local tables of every shard, the custom setting must be forwarded (it is, by default), and the cluster's inter-server user must be the reader. Out of scope until then.
- **`clusterAllReplicas`, `remote()`, `dictGet`, `joinGet`.** Not granted to the reader. Dictionaries bypass row policies; the fence's refusal of `dict*` and `joinGet` stays.
- **Routed organisations and BYOC dataplanes.** Every target the router knows (shared, `CLICKHOUSE_URL__<label>__<orgId>`) needs the same users and policies. The upgrade already walks every target for goose; the access model needs the same walk in `sql` mode, and a rendered-config target needs the chart Job. A target without the access model must refuse reader traffic by name, as ADR-200's placement gate does for LangWatchQL, never fall back to an unpoliced user.

## Rollout

1. **Allow the setting prefix.** `custom_settings_prefixes` must include `SQL_` on every target. ClickHouse Cloud accepts `SQL_` (to confirm per service); the rendered config adds it beside `custom_`; the BYO prerequisites in `charts/langwatch/README.md` gain a row.
2. **Provision users and policies in shadow.** The policy predicate is `getSetting('SQL_langwatch_tenancy_enforce') = 0 OR <tenant predicate>`, with `SQL_langwatch_tenancy_enforce` pinned `CONST` in the reader profile (0 in shadow, 1 when enforcing). The client cannot flip it per query; the switch is a profile change per target.
3. **Measure in shadow.** Three signals:
   - every read the client sends without a tenant set (a counter by statement name; should already be zero because the client refuses it);
   - a sampled re-run of a fraction of reads as `SELECT count()` over the same statement on a second identity whose profile pins enforce to 1, logged with the statement name when the counts differ ("rows the policy would hide");
   - CI and integration suites run with enforce on from the first slice, so a missing tenant in a test fails at once.
4. **Enforce per target**, shared first, routed targets after. Self-hosted installs run one release in shadow (the chart pins enforce off and reports what the policy would have hidden), and the release after turns enforce on by default.
5. Remove the shadow branch of the predicate in a later release.

## Performance

A row policy is one more filter on every read. It must prune on the primary key: every tenant table orders by the tenant column first. Before enforcement, each candidate predicate form is checked with `EXPLAIN indexes = 1` on the three largest tables, and a benchmark compares p50 and p99 of the trace list, trace detail and analytics timeseries with and without the policy. The query condition cache pin may cost more than the policy; measure it separately on 26.8.

## Alternatives considered

- **An AST parser in place of the text fence.** ClickHouse's grammar moves every release and has no stable JS parser; a parser that disagrees with the server is the same bypass class with more code. It also leaves raw reads unchecked unless every read goes through it. Rejected as the enforcement layer; a builder that never produces text it cannot reason about is the better use of that effort.
- **Per-tenant ClickHouse users.** Thousands of users and policies, provisioning on project creation, credential storage per tenant, and no answer for a proof spanning several tenants (ADR-177 aggregates, braids). Rejected.
- **Views per tenant.** Same churn as users, DDL per project on every replica, and views do not stop a read of the base table. Rejected.
- **Keep the fence and harden it.** Five rounds of new shapes show the cost curve. The fence stays for windows and braids, inside a boundary the server enforces.

## The typed builder

Shape (names illustrative):

```ts
const read = clickhouseRead({ scope: tenantScope.fromProof({ authorization, reads: "spans" }) })
  .from(storedSpans)
  .select({ traceId: storedSpans.TraceId, name: storedSpans.SpanName })
  .where(({ eq }) => eq(storedSpans.TraceId, traceId))
  .limit(100);
```

What it guarantees:

- **The scope is a required constructor argument**: `tenantScope.fromProof`, `tenantScope.single({ tenantId })`, `tenantScope.set({ tenantIds })` or `tenantScope.allTenants({ reason })`, the last only on the system identity. The builder renders the tenant predicate and sets the request setting from the same value, so text and policy cannot disagree.
- **Tables are typed descriptors** declared once by their owner (column names, types, tenant column, time column, sort key), so a repository cannot name a column that does not exist or read another module's table without the owner's shared descriptor.
- **Values are named parameters only**; there is no string escape hatch except `sql.fragment` with a reviewed allow-list, refused by lint outside `packages/clickhouse-client`.
- **The fence's features are builder operations**: `.withinWindows()`, `.braided({ heldTrace })`, `.latestVersion()`, rendering what the markers render today. The markers die when the last caller moves.
- **Escape for analytics.** The analytics aggregation mappers build large dynamic SQL; they move last and may keep a narrower builder of their own.

Migration path: about 139 non-test TypeScript files under ClickHouse repository folders (mappers included), about 50 of which issue reads. Fenced files move first because the builder replaces the fence's renderer; raw single-tenant reads next, module by module; skip-check sweeps last onto `allTenants`. Each module's move turns its baseline entries off in the lint rule.

## Consequences

- A missing or wrong tenant predicate in any application read returns no foreign rows, whether the read is fenced, raw or new.
- Two ClickHouse identities and their credentials on every target and every distribution; the chart, the SaaS terraform and the BYO docs all change.
- The access-model definition grows from LangWatchQL's tables to every tenant table. A new tenant table must be added to it, which the guard test enforces.
- Materialised views and inserts need proof before the reader identity touches them.
- The fence shrinks to windows, braids and elections, and later disappears into the builder.

## Decided (Alex, 2026-11-13)

1. The setting is `SQL_langwatch_tenant_ids`; rendered config adds `SQL_` to `custom_settings_prefixes`.
2. Two users: a restricted reader the policies bind, and a system user for the reads listed above. Skipping the policy is visible in configuration, not in a predicate branch.
3. The api never holds the system credential. Api-side reads that skip the tenant check today move behind the worker or tasks.
4. Self-hosted installs run one release in shadow before enforcing.

## Open questions for Alex

1. Whether shared and braid windows move into the policy later, or stay in the fence and builder for good.
2. Whether inserts move to the reader identity once MV behaviour is proven, or stay on the system identity.
3. Whether routed and BYOC targets without the access model refuse reads (fail closed) or keep today's text checks until provisioned.
4. Whether the builder is hand-written in `packages/clickhouse-client` or adopts an existing library.
5. Whether `use_query_condition_cache = 0` on the reader is acceptable for performance, or the app's ClickHouse must reach 26.8 first.
6. Whether the LangWatchQL user gets the same `USING 0` policy on `system.user_query_log`. It holds the same implicit grant and is shared by every tenant. Its validator refuses the `system` database, masking hides the capability and `log_query_settings = 0` empties `Settings`, but other tenants' statement text and `log_comment` sit behind the validator alone. Not changed in slice 1.

## References

- `packages/clickhouse-client/src/authorized-reads.ts`, `tenantGuard.ts`, `query.ts`
- `modules/analytics/process/src/services/langwatch-ql-access-model.service.ts`, `langwatch-ql-access-model-definition.service.ts`
- `charts/langwatch/README.md` (LangWatchQL prerequisites)
- `dev/docs/plans/clickhouse-row-policies-scope.md`
