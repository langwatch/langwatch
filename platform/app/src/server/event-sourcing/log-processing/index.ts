import { clickhouseAppend, type ClickHouseClient } from "@langwatch/clickhouse";
import {
    ConfigurationError,
    definePipeline,
    validateMount,
    type AppendStore,
    type GroupKey,
    type Mount,
} from "@langwatch/event-sourcing";
import {
    DEFAULT_RETENTION_DAYS,
    toCanonicalLogRecord,
    toLogRecordRow,
    toLogUsageEstimateRow,
    type StampedLogRecord,
} from "./canonicalLogStorage.projection";
import { LOG_PIPELINE_NAME, LOG_PIPELINE_PREFIX, logProcessingEvents } from "./events";
import { recordCanonicalLog } from "./recordCanonicalLog.command";
import { canonicalLogRecordSchema, type CanonicalLogRecord } from "./schema";
import { DEFAULT_LOG_SHARD_COUNT, logRecordShard } from "./shards";
import { logRecordsTable, logUsageEstimatesTable } from "./table";

/** One lane per record: a content-addressed aggregate never reads state back. */
export function logRecordCommandGroupKey(args: {
  tenantId: string;
  recordId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: "recordCanonicalLog" },
    scope: {
      kind: "aggregate",
      aggregateType: LOG_PIPELINE_NAME,
      aggregateId: args.recordId,
    },
  };
}

/** A bounded hashed shard, so a delivery's writes coalesce (ADR-100 decision 2). */
export function canonicalLogStorageGroupKey(args: {
  tenantId: string;
  recordId: string;
  shardCount?: number;
}): GroupKey {
  const shardCount = args.shardCount ?? DEFAULT_LOG_SHARD_COUNT;
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "canonicalLogStorage" },
    scope: {
      kind: "partition",
      parts: [String(logRecordShard(args.recordId, shardCount))],
    },
  };
}

/**
 * The mount is a function of the store the executor actually runs on, not a
 * literal restating it: `collapse: batch` because the shard scope exists so a
 * delivery gathers several records into one bulk write.
 */
export function canonicalLogStorageMount(
  store: AppendStore<CanonicalLogRecord>,
): Mount {
  return {
    projection: "map",
    store: store.kind,
    scope: "partition",
    collapse: "batch",
  };
}

/** Refuses an illegal mount at composition, not on the first delivery (ADR-106). */
function assertMountIsLegal(mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `log-processing's canonicalLogStorage mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: LOG_PIPELINE_NAME, projection: "canonicalLogStorage", violations },
    );
  }
  return mount;
}

/**
 * `log_records` is authoritative and `log_usage_estimates` is the billing
 * ledger, and ClickHouse has no cross-table transaction: a failure in either
 * rejects the whole batch, and the retry re-sends rows each table collapses on
 * its own `RecordId`.
 */
function createCanonicalLogStore(
  client: ClickHouseClient,
): AppendStore<CanonicalLogRecord> {
  const records = clickhouseAppend({
    client,
    table: logRecordsTable,
    toRow: toLogRecordRow,
  });
  const usage = clickhouseAppend({
    client,
    table: logUsageEstimatesTable,
    toRow: toLogUsageEstimateRow,
  });

  return {
    kind: "append",
    async writeBatch(batch, context) {
      const writtenAt = new Date();
      const stamped: StampedLogRecord[] = batch.map((record) => ({
        ...record,
        writtenAt,
        dedupVersion: BigInt(writtenAt.getTime()),
        retentionDays: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
      }));
      await Promise.all([
        records.writeBatch(stamped, context),
        usage.writeBatch(stamped, context),
      ]);
    },
  };
}

export function createLogProcessingPipeline(deps: {
  readonly client: ClickHouseClient;
}) {
  const store = createCanonicalLogStore(deps.client);
  assertMountIsLegal(canonicalLogStorageMount(store));

  return definePipeline(LOG_PIPELINE_NAME)
    .prefix(LOG_PIPELINE_PREFIX)
    .events(logProcessingEvents)
    .withCommand("recordCanonicalLog", (c) =>
      c.input(canonicalLogRecordSchema).handle(recordCanonicalLog),
    )
    .withMap("canonicalLogStorage", (m) =>
      m.on({ recordReceived: toCanonicalLogRecord }).store(store),
    )
    .build();
}
