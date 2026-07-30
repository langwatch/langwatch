/**
 * The two tables the integration suite shares, created once by
 * `globalSetup.ts`. Every test scopes its rows by a unique tenant id (and,
 * where relevant, a unique key) from `testClickHouse.ts` — see that module's
 * docblock for why isolation is by id rather than by table or database.
 */
import { z } from "zod";
import { ch } from "../../schema/columns";
import { append, defineTable, replacing } from "../../schema/defineTable";

export const FOLD_STATE_SCHEMA = z.object({ value: z.string() });
export type FoldState = z.infer<typeof FOLD_STATE_SCHEMA>;

/**
 * Backs the `ReplaceStore` integration tests: `ReplacingMergeTree` dedup,
 * read-your-writes, redelivery, and 64-bit `DeliverySeq` round-tripping.
 * Shaped after the `trace_analytics` example in ADR-099 — `AcceptedAt` is the
 * frozen, platform-controlled anchor `defineTable` requires for the partition
 * column, declared beyond `createReplaceStore`'s five managed roles so the
 * store stamps it automatically on every write (see that module's docblock).
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
    State: ch.json(FOLD_STATE_SCHEMA),
    DeliverySeq: ch.uint64(),
    StateVersion: ch.string(),
    WrittenAt: ch.writtenAt(),
    AcceptedAt: ch.acceptedAt(),
  },
});

const FOLD_STATE_DDL = `
CREATE TABLE IF NOT EXISTS test_fold_state
(
  TenantId String,
  Key String,
  State String,
  DeliverySeq UInt64,
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
CREATE TABLE IF NOT EXISTS test_append_log
(
  TenantId String,
  AcceptedAt DateTime64(3),
  Payload String
)
ENGINE = MergeTree
PARTITION BY toYearWeek(AcceptedAt)
ORDER BY (TenantId, AcceptedAt)
`;

/** Every DDL statement `globalSetup.ts` runs once, before any test file. */
export const FIXTURE_TABLE_DDL: readonly string[] = [FOLD_STATE_DDL, APPEND_LOG_DDL];
