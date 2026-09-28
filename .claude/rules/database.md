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

Before any migration, load `postgres-migration` or `clickhouse-migration`. A
migration is applied to the live database before the new image rolls, so it
must keep the previous image working and survive a rollback (ADR-155): add
columns nullable or with `DEFAULT`; remove one only a full release after the
code stopped using it, with `-- contract: retired in <release>`; never rename
in place. Never edit a deployed migration; write a new one.

Read `dev/docs/best_practices/clickhouse-queries.md` before writing or changing a
ClickHouse query.

| Rule | Why / how |
|---|---|
| Every ClickHouse query filters `TenantId` first | `WHERE TenantId = {tenantId:String}`; no other id is unique across tenants |
| Every Prisma query on a project-level model carries `projectId` | The multitenancy middleware rejects it otherwise |
| Filter on the partition key (`StartedAt`/`OccurredAt`/`StartTime`) when a date range exists | Partition pruning; otherwise cold S3 partitions are scanned |
| IN-tuple dedup (`GROUP BY key` + `max(UpdatedAt)`), not `LIMIT 1 BY`, with heavy columns | `LIMIT 1 BY` materialises whole granules → OOM |
| `argMax(column, UpdatedAt)` for sort keys on deduped tables | `max()` picks stale versions and breaks cursor pagination |
| Unqualified table names in Prisma migrations | `"Monitor"`, not `"langwatch_db"."Monitor"` |
| One `ALTER TABLE` per goose `StatementBegin`/`StatementEnd` block | ClickHouse has no multi-statement queries |
| ClickHouse down-migrations stay commented out | Note: "To roll back, uncomment and run manually" |

Migrations run as tasks (`pnpm prisma:migrate`, `pnpm clickhouse:migrate`),
before serve, never in the api.
