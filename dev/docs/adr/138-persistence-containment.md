# ADR-138: Prisma stops at the repository seam

**Date:** 2026-09-09

**Status:** Proposed. Amended 2026-09-23: the three store rules and the service
rule are one `store-containment` row, and two ClickHouse query rules join it.

**Behavioural contract:**
[store containment](../../../specs/tooling/lint-store-containment.feature),
[the ClickHouse tenant predicate](../../../specs/tooling/lint-clickhouse-tenant-id.feature),
[table ownership](../../../specs/server/prisma-table-ownership.feature)

**Related:** [ADR-134: private Prisma table ownership](./134-private-prisma-table-ownership.md),
[ADR-112: singular feature ownership](./112-singular-feature-ownership.md),
[ADR-135: the toolchain](./135-lint-and-format-toolchain.md),
[the layering guide](../best_practices/service-repository-adapter-port.md)

## Context

ADR-134 made a table the property of one module's private repository. That
decision only holds if nothing else can reach the client. A generated Prisma
type in a service signature, a `database: object` parameter cast back to
`PrismaClient` at the seam, or a service importing another subject's repository
each reopen the door in a way that is invisible from the ownership declaration:
the claim still says one owner, and two modules are reading the table.

The `database: object` shape is worth naming, because it looked like the polite
thing to do. An adapter that takes `object` and casts to `PrismaClient` inside
avoids naming a generated type in its signature. What it actually does is move
the cast somewhere nobody reviews and give every layer below it an untyped
client. The composition root already holds a typed `PrismaClient`; passing it
through costs nothing and removes the cast entirely.

## Decision

| Rule | Layer | Meaning |
| --- | --- | --- |
| `langwatch/store-containment` | plugin | Prisma, ClickHouse and Redis are named only under the module's own `repositories/<store>/` (Redis also `channels/redis/`), and never in an application. Replaces `prisma-containment`, `clickhouse-containment` and `redis-containment` (2026-09-23); `typed-prisma-seam` was deleted. |
| `langwatch/clickhouse-tenant-id` | plugin | Every table a ClickHouse repository queries carries a bound `TenantId` predicate in its own scope, or the query declares itself `unscoped` with a reason. |
| `langwatch/clickhouse-no-version-order-limit` | plugin | No `ORDER BY <version> DESC LIMIT 1` over heavy columns; dedupe with the IN-tuple form. |
| `langwatch/prisma-count-in-list-query` | plugin | No `_count` inside a `findMany`: Prisma builds it as an uncorrelated join over the whole related table. |
| `prisma-table-ownership` | architecture-enforcer | Code outside a module's own Prisma repository may not reach that module's tables. |
| `prisma-migration-access` | architecture-enforcer | The raw and scoped Prisma client capabilities are for a `SystemMigration` and its owning repository only. |
| `clickhouse-table-ownership` | architecture-enforcer | One module writes a ClickHouse table; every other module reads it through that module's api. |

The plugin rules are per-import and per-query, so one file is enough
to decide. The three policies need the schema and the whole catalogue at
once: table ownership is a question about every module, including modules that
are never installed together. `clickhouse-table-ownership` reads its table list
from the goose migrations instead of a schema file, because ClickHouse has
neither a schema file nor a generated client here.

`prisma-containment`, `clickhouse-containment` and `redis-containment` were
folded into `store-containment` on 2026-09-23: one row per store, one seam per
store, one rule.

## Consequences

Persistence has exactly two doors, and both are named by a path: a repository
under `repositories/prisma/`, and a `postgres.*.adapter.ts`. A reviewer
checking whether a change touches another module's data reads the paths, not
the query. The layering guide has the diagrams.

The cost lands on tests and one-off scripts, which now have to go through a
repository or declare themselves at the seam rather than reaching for the
client. That is the intended trade: a test that can reach any table is a test
that stops noticing when ownership moves.
