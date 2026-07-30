/**
 * The tables the integration suite shares, created once by `globalSetup.ts`.
 * Every test scopes its rows by a unique tenant id (and, where relevant, a
 * unique key) from `testClickHouse.ts` — see that module's docblock for why
 * isolation is by id rather than by table or database.
 */
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ch } from "../../schema/columns";
import {
  append,
  defineTable,
  replacing,
  type TableDescription,
} from "../../schema/defineTable";
import { eventLogTable } from "../../tables/eventLog";
import { extractTableStatements } from "./migrationReplay";

/**
 * The deployed migrations directory this package may read but never modify
 * or import from (it is application code — see `migrationReplay.ts`'s
 * docblock for why this package restates rather than imports its reader).
 */
const DEPLOYED_MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../../src/server/clickhouse/migrations", import.meta.url),
);

/** One column per field: the wide row shape `clickhouseReplacing` serves. */
export const FOLD_STATE_SCHEMA = z.object({
  value: z.string(),
  count: z.number(),
  /** Epoch milliseconds. Fills the frozen partition anchor and TTL anchor. */
  acceptedAt: z.number(),
});

export type FoldState = z.infer<typeof FOLD_STATE_SCHEMA>;

/**
 * Backs the `ReplaceStore` integration tests: `ReplacingMergeTree` dedup and
 * read-your-writes. `AcceptedAt` is the frozen, platform-controlled anchor
 * `defineTable` requires for the partition column; it is no role the store
 * owns, so the fold's own state carries it.
 */
export const foldStateTable = defineTable({
  name: "test_fold_state",
  merge: replacing({ version: "WrittenAt" }),
  sortKey: ["TenantId", "Key"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    Key: ch.string(),
    Value: ch.string(),
    Count: ch.uint64(),
    StateVersion: ch.string(),
    WrittenAt: ch.writtenAt(),
    AcceptedAt: ch.acceptedAt(),
  },
});

const FOLD_STATE_DDL = `
CREATE TABLE test_fold_state
(
  TenantId String,
  Key String,
  Value String,
  Count UInt64,
  StateVersion String,
  WrittenAt DateTime64(3),
  AcceptedAt DateTime64(3)
)
ENGINE = ReplacingMergeTree(WrittenAt)
PARTITION BY toYearWeek(AcceptedAt)
ORDER BY (TenantId, Key)
TTL AcceptedAt + INTERVAL 30 DAY
`;

/**
 * Backs the `AppendStore` integration tests. Declared with `append()` and
 * physically backed by a plain `MergeTree` with no per-record identity
 * anywhere in its columns — the shape ADR-099 and `appendStore.ts`'s docblock
 * both call out as the one that never collapses a duplicate row, unlike
 * `replacing` or an `append` table whose sort key does carry an id.
 */
export const appendLogTable = defineTable({
  name: "test_append_log",
  merge: append(),
  sortKey: ["TenantId", "AcceptedAt"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  columns: {
    TenantId: ch.string(),
    AcceptedAt: ch.acceptedAt(),
    Payload: ch.string(),
  },
});

const APPEND_LOG_DDL = `
CREATE TABLE test_append_log
(
  TenantId String,
  AcceptedAt DateTime64(3),
  Payload String
)
ENGINE = MergeTree
PARTITION BY toYearWeek(AcceptedAt)
ORDER BY (TenantId, AcceptedAt)
`;

/**
 * `event_log`'s creation-and-every-later-ALTER statements, read live from the
 * deployed migrations rather than hand-transcribed. `00002_create_schema.sql`
 * creates it; `00032_add_retention_and_size_columns.sql` and
 * `00049_create_canonical_metrics.sql`/`00050_create_canonical_logs.sql` each
 * `ALTER` it afterwards. Replaying all of them, in file order, against a
 * fresh table reproduces the deployed shape exactly as it stands today — a
 * hand-copied constant could only ever reproduce the shape as of the day it
 * was copied.
 */
const EVENT_LOG_STATEMENTS = extractTableStatements(
  DEPLOYED_MIGRATIONS_DIR,
  "event_log",
);

export { eventLogTable };

/**
 * One table's `defineTable` declaration paired with the statements that
 * create (and, for a real table, later alter) it — the drift test's registry.
 * `tableDrift.integration.test.ts` iterates this; adding a table here is the
 * whole cost of getting it drift-checked.
 */
export interface DriftCase {
  readonly description: TableDescription;
  readonly setupDdl: readonly string[];
}

export const DRIFT_CASES: readonly DriftCase[] = [
  {
    description: foldStateTable.describe(),
    setupDdl: ["DROP TABLE IF EXISTS test_fold_state", FOLD_STATE_DDL],
  },
  {
    description: appendLogTable.describe(),
    setupDdl: ["DROP TABLE IF EXISTS test_append_log", APPEND_LOG_DDL],
  },
  {
    description: eventLogTable.describe(),
    setupDdl: ["DROP TABLE IF EXISTS event_log", ...EVENT_LOG_STATEMENTS],
  },
];

/**
 * A table declared with a sort key the DDL that creates it deliberately does
 * not match — `ORDER BY (TenantId, WrittenAt)` where the declaration says
 * `[TenantId, Key]`. Exists only so `tableDrift.integration.test.ts` can prove
 * the live check actually fails when the two disagree, against real
 * `system.tables`/`system.columns` wiring rather than the pure comparison
 * function alone. Never added to `DRIFT_CASES` — it must never pass.
 */
export const driftMismatchTable = defineTable({
  name: "test_drift_mismatch",
  merge: replacing({ version: "WrittenAt" }),
  sortKey: ["TenantId", "Key"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  columns: {
    TenantId: ch.string(),
    Key: ch.string(),
    WrittenAt: ch.writtenAt(),
    AcceptedAt: ch.acceptedAt(),
  },
});

const DRIFT_MISMATCH_DDL = `
CREATE TABLE test_drift_mismatch
(
  TenantId String,
  Key String,
  WrittenAt DateTime64(3),
  AcceptedAt DateTime64(3)
)
ENGINE = ReplacingMergeTree(WrittenAt)
PARTITION BY toYearWeek(AcceptedAt)
ORDER BY (TenantId, WrittenAt)
`;

/**
 * Every DDL statement `globalSetup.ts` runs once, before any test file. Each
 * table is dropped first: a reused container or a native dev ClickHouse keeps
 * these tables between runs, and `CREATE TABLE IF NOT EXISTS` would silently
 * leave an earlier run's column list in place after a declaration changes.
 */
export const FIXTURE_TABLE_DDL: readonly string[] = [
  ...DRIFT_CASES.flatMap((driftCase) => driftCase.setupDdl),
  "DROP TABLE IF EXISTS test_drift_mismatch",
  DRIFT_MISMATCH_DDL,
];
