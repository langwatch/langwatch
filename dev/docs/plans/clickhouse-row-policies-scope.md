# ClickHouse row policies and typed builder: scope

ADR: `dev/docs/adr/202-clickhouse-row-policies-enforce-tenancy-for-every-read.md`. Drafted 2026-11-13 on `feat/clickhouse-row-policies`, off main after #8946.

## Inventory

Built with `rg` over non-test TypeScript (`__tests__` and `*.test.ts` excluded). Line numbers are the first tenant predicate or skip flag in the file, not every statement. "raw" files may also hold inserts or deletes; each needs a per-statement pass in slice 3. Counts are approximate until that pass.

Totals: about 139 non-test files under ClickHouse repository folders (mappers included); about 50 issue reads; 23 read through the fence; 48 write the tenant predicate by hand; about 47 ClickHouse call sites set `SKIP_TENANT_CHECK`.

### Fenced (markers, via `authorized-reads.ts`)

| File                                                                                                                                                                                                                  | Notes                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| modules/analytics/.../clickhouse/clickhouse.analytics.repository.ts                                                                                                                                                   | plus 7 mappers: aggregation-builder, eval-rollup-timeseries-query, eval-slim-timeseries-query, filter-options (repository), filter-query-helpers, rollup-timeseries-query, slim-timeseries-query |
| modules/coding-agent/.../clickhouse.coding-agent-session.repository.ts                                                                                                                                                | mixed: also a raw predicate at :516                                                                                                                                                              |
| modules/evaluation/.../evaluation-run-read.repository.ts                                                                                                                                                              |                                                                                                                                                                                                  |
| modules/trace/.../features/braid/.../clickhouse.trace-braid-reads.repository.ts                                                                                                                                       | braids, held-trace semi-join                                                                                                                                                                     |
| modules/trace/.../features/facet/.../clickhouse.trace-facet-query.repository.ts, clickhouse.trace-facet-scope.mapper.ts                                                                                               |                                                                                                                                                                                                  |
| modules/trace/.../features/legacy/.../trace-legacy-read.repository.ts                                                                                                                                                 | mixed: raw at :435                                                                                                                                                                               |
| modules/trace/.../features/query/rules/trace-query-subquery.rules.ts                                                                                                                                                  |                                                                                                                                                                                                  |
| modules/trace/.../clickhouse/: trace-member-client, session-groups, span-storage, trace-evaluation-analytics, trace-evaluation-runs (mixed, raw :411), trace-list, trace-metrics-analytics, trace-span, trace-summary |                                                                                                                                                                                                  |

### Raw, hand-written `TenantId = {p}` or `TenantId IN {set}` (single tenant or declared set)

| File:line                                                                                                                                                    | Module         | Cross-tenant by design                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------- |
| modules/trace/.../trace-derivation-span.repository.ts:170                                                                                                    | trace          | no                                              |
| modules/trace/.../trace-usage-count.repository.ts:45                                                                                                         | trace          | no                                              |
| modules/trace/.../log-record-storage.repository.ts:127                                                                                                       | trace          | no                                              |
| modules/trace/.../clickhouse.trace-attributed-rollup.repository.ts:53                                                                                        | trace          | no                                              |
| modules/trace/.../clickhouse.trace-clustering-sample.repository.ts:58                                                                                        | trace          | no                                              |
| modules/trace/.../clickhouse.trace-attribute-spend.repository.ts:43                                                                                          | trace          | no                                              |
| modules/trace/.../clickhouse.trace-model-spend.repository.ts:71                                                                                              | trace          | no                                              |
| modules/trace/.../span-analytics.repository.ts:151                                                                                                           | trace          | no                                              |
| modules/trace/.../trace-existence.repository.ts:45                                                                                                           | trace          | no                                              |
| modules/trace/.../trace-full-record.repository.ts:178                                                                                                        | trace          | no                                              |
| modules/trace/.../trace-instant-eval-runs.repository.ts:48                                                                                                   | trace          | no                                              |
| modules/evaluation/.../monitor-performance.repository.ts:58                                                                                                  | evaluation     | no                                              |
| modules/experiment/...: experiment-dspy :191, experiment-id-lookup :34, experiment-run-state :250, experiment-run.repository :244, experiment-run.mapper :15 | experiment     | no                                              |
| modules/scenario/...: result-atoms :442, simulation-run-metrics :126, simulation-run-state :352, simulation-clickhouse :405                                  | scenario       | no                                              |
| modules/instant-eval/...: instant-eval-judgments :75, instant-eval-run.repository :162, instant-eval-run.mapper :133                                         | instant-eval   | no                                              |
| modules/suite/.../clickhouse.suite-run.repository.ts:245                                                                                                     | suite          | no                                              |
| modules/coding-agent/...: session-event :291, trace-session :118, session-metric-series :156                                                                 | coding-agent   | no                                              |
| modules/gateway/...: gateway-budget :267, gateway-principal-spend :29, gateway-spend-events :273                                                             | gateway        | organisation tenant set (budget ledger)         |
| modules/analytics/...: analytics-persistence :222, analytics-recency :50                                                                                     | analytics      | no (persistence may be a write)                 |
| modules/analytics/.../clickhouse.langwatch-ql-provisioning.repository.ts:408                                                                                 | analytics      | key map, LangWatchQL server, out of scope       |
| modules/metric/.../clickhouse.metric-data-point-append.repository.ts:488                                                                                     | metric         | no (append path, check)                         |
| modules/data-retention/.../clickhouse.storage-meter.repository.ts:29                                                                                         | data-retention | no                                              |
| modules/entitlement/...: billable-events-meter :93, trace-count :117                                                                                         | entitlement    | mixed with skip sites below                     |
| enterprise/modules/governance/...: anomaly-spend :147, governance-cost-charge :71, governance-cost-rollup :64, ocsf-events :320, rollup-erasure :42 (delete) | governance     | organisation set                                |
| enterprise/modules/governance/.../prisma.ingestion-source-activity.repository.ts:274                                                                         | governance     | a ClickHouse read in a prisma-named file; check |
| packages/eventing/src/server/adapters/clickhouse/event-repository.clickhouse.ts                                                                              | eventing       | no (event_log per aggregate)                    |

### Raw with `SKIP_TENANT_CHECK` (cross-tenant or DDL, would use the system identity)

| File:line(s)                                                                                                                      | Why it spans tenants                            |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| modules/gateway/.../clickhouse.gateway-open-admissions.repository.ts:74                                                           | open admissions sweep                           |
| modules/data-retention/.../clickhouse.retroactive-retention.repository.ts:208, 226, 260, 300, 358, 395, 427                       | retention, every tenant                         |
| modules/entitlement/.../clickhouse.billable-events-meter.repository.ts:75, 105, 141; clickhouse.trace-count.repository.ts:85, 127 | usage metering                                  |
| modules/trace/.../clickhouse.trace-index-materialisation.repository.ts:78, 91, 103, 135                                           | id-index materialisation                        |
| modules/stored-object/...: stored-object-owner :47, stored-object-legacy-source :68, stored-objects.repository :134               | legacy import step; table keyed on `project_id` |
| modules/ops/...: storage-footprint :50, 73, 103, 119; datastore-health :24; ops-explain :53                                       | Ops, system tables                              |
| modules/scenario/.../clickhouse.stalled-simulation-run.repository.ts:79                                                           | stalled-run sweep                               |
| modules/analytics/.../clickhouse.langwatch-ql-app-function-store.repository.ts:32, 38                                             | DDL for app functions                           |
| packages/eventing/.../replay-event-source.clickhouse.ts:109, 144, 188, 614                                                        | replay                                          |
| packages/eventing/src/server/tables/event-log-retention.ts:163, 187, 251, 271                                                     | event retention                                 |
| packages/eventing/.../event-explorer.clickhouse.ts:87, 165                                                                        | Ops event explorer                              |
| packages/clickhouse-client/src/idIndexFill.ts:704, 755, 815, 863, 894; idIndexReadiness.ts:65, 90, 111                            | id-index fill and readiness                     |

Not yet checked: Distributed tables (none found in migrations), `FINAL` sites per table, `dictGet`/`joinGet` callers, and whether every Replacing table's sort key starts with its tenant column (`stored_objects` orders by `project_id, id`). Slice 1 adds the guard tests that answer these.

## Slices, in order

| #   | Slice                                                                                                                                                                                                                                                                                                   | Size                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 0   | ADR-202 accepted, remaining open questions answered                                                                                                                                                                                                                                                     | doc                           |
| 1   | Access-model definition grows a reader user, profile and one row policy per tenant table, shadow predicate; both emitters (rendered, SQL); guard tests: every tenant table has a policy, tenant column leads the sort key; integration test proving a missing predicate returns no foreign rows on 26.8 | M, about 600 lines plus tests |
| 2   | Client sets `SQL_langwatch_tenant_ids` on every read from proof / `tenantIds` / `tenantId`, refuses the prefix in statement text, routes `SKIP_TENANT_CHECK` to the system identity; config for the second credential; shadow sampler and metric                                                        | M                             |
| 3   | MV and insert proof: integration test of every MV under the reader with and without the setting; decide insert identity                                                                                                                                                                                 | S                             |
| 4   | Chart, rendered config prefix, BYO README rows, SaaS terraform issue for Cloud and serverless targets; routed targets walked by upgrade                                                                                                                                                                 | M, crosses repos              |
| 5   | Enforce on shared target after shadow is clean; CI runs enforced from slice 1                                                                                                                                                                                                                           | S                             |
| 6   | Typed builder in `packages/clickhouse-client` with table descriptors, scopes and named parameters; port the fence's renderer behind it                                                                                                                                                                  | L                             |
| 7   | Port fenced repositories (23 files)                                                                                                                                                                                                                                                                     | L, one PR per module          |
| 8   | Port raw repositories (about 48 files) and skip sites (`allTenants`)                                                                                                                                                                                                                                    | L, one PR per module          |
| 9   | `langwatch/no-raw-clickhouse-sql` at error with shrink-only baseline from slice 6; delete markers when baseline is empty                                                                                                                                                                                | S each                        |

## Risks

- **Materialised views could drop rows silently** if a policy applies to an insert-triggered MV read on the reader identity. Keep inserts on the system identity until slice 3 proves otherwise.
- **Query condition cache** crossed tenants on 25.10 with a setting-keyed policy (ADR-200). Pin it off or require 26.8 on every target before enforcing.
- **Tables without a policy are wide open** to the reader; a new tenant table that misses the definition is a leak. The guard test is load-bearing.
- **`FINAL` correctness** depends on the tenant column being in the sort key of every deduplicating table.
- **A query-level `SETTINGS` clause overrides the request setting.** The client's prefix refusal is load-bearing until the builder lands.
- **Routed, BYOC and BYO targets** without the access model must fail closed, or they keep only today's text checks.
- **Over-hiding**: braids, aggregate projects and organisation sets need every tenant in the setting; a missing owner hides real rows. Shadow sampling exists to catch this.
- **Setting size**: one id per tenant in a request setting; large organisations need a measured upper bound.
- **Inventory precision**: built with `rg`, line numbers are first hits; slice 3 or 7 does the per-statement pass.
