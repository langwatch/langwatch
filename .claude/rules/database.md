---
paths:
  - "**/repositories/**"
  - "**/migrations/**"
  - "**/*.sql"
  - "**/schema.prisma"
  - "packages/prisma-client/**"
  - "**/*clickhouse*"
---

# Database

Before any migration, load the `migration` skill; it routes to `postgres-migration`, `clickhouse-migration` or `migration-data-step`. The previous release must keep running on every later schema, and no release is a required stop: any install rolls through every step (Alex, 2026-10-11). Add columns nullable or with `DEFAULT`; nothing is deleted automatically (Alex, 2026-10-11): a migration never drops a table or a column, and a drop is an operator step confirmed in Ops once safe; never rename in place. No new foreign keys and no new `@relation` (Alex, 2026-10-06); existing ones stay. Never edit a merged migration; write a new one.

Read `dev/docs/best_practices/clickhouse-queries.md` before writing or changing a
ClickHouse query.

| Rule                                                                                        | Why / how                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Every ClickHouse query filters `TenantId` first                                             | `WHERE TenantId = {tenantId:String}`; no other id is unique across tenants |
| Every Prisma query on a project-level model carries `projectId`                             | The multitenancy middleware rejects it otherwise                           |
| Filter on the partition key (`StartedAt`/`OccurredAt`/`StartTime`) when a date range exists | Partition pruning; otherwise cold S3 partitions are scanned                |
| IN-tuple dedup (`GROUP BY key` + `max(UpdatedAt)`), not `LIMIT 1 BY`, with heavy columns    | `LIMIT 1 BY` materialises whole granules → OOM                             |
| `argMax(column, UpdatedAt)` for sort keys on deduped tables                                 | `max()` picks stale versions and breaks cursor pagination                  |
| Unqualified table names in Prisma migrations                                                | `"Monitor"`, not `"langwatch_db"."Monitor"`                                |
| One `ALTER TABLE` per goose `StatementBegin`/`StatementEnd` block                           | ClickHouse has no multi-statement queries                                  |
| ClickHouse down-migrations stay commented out                                               | Note: "To roll back, uncomment and run manually"                           |

Migrations are applied by `pnpm task upgrade` (the root `pnpm prisma:migrate` and
`pnpm clickhouse:migrate` are aliases of it), which a worker runs before it takes jobs; never in the api.
A backfill walks a table once, in pages with `sendBatch`, as a registered step; a re-run is Retry in Ops.
