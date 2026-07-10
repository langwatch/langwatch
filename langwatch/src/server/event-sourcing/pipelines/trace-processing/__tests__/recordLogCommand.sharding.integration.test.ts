/**
 * Integration test: recordLog GroupQueue sharding through the live staging layer
 *
 * One Claude Code turn streams thousands of log records; on `main` every one
 * became a recordLog command FIFO'd into the single per-trace group and stalled
 * the workers. With TRACE_LOG_PROCESSING_SHARDS > 1 the composition root installs
 * a getGroupKey that spreads a trace's recordLog commands across
 * `trace:<traceId>:<shard>` GroupQueue groups. This test exercises the real Redis
 * staging layer (producer-only "web" role, so jobs stage but never drain) and
 * asserts:
 *   - sharded: the records land in more than one `trace:<traceId>:<shard>` group;
 *   - unsharded: they collapse to the single legacy `trace:<traceId>` group;
 *   - either way the emitted log_record_received event keeps AggregateId =
 *     traceId, so the fold, reactor, and trace-output join are untouched.
 */

import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../../";
import { definePipeline } from "../../../";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
} from "../../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "../../../__tests__/integration/testHelpers";
import { EventSourcing } from "../../../eventSourcing";
import type { PipelineWithCommandHandlers } from "../../../pipeline/types";
import { EventStoreClickHouse } from "../../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../../stores/repositories/eventRepositoryClickHouse";
import { RecordLogCommand } from "../commands/recordLogCommand";
import { logCommandGroupKey } from "../commands/logCommandGroupKey";
import { RECORD_LOG_COMMAND_TYPE } from "../schemas/constants";
import type { RecordLogCommandData } from "../schemas/commands";
import type { TraceProcessingEvent } from "../schemas/events";

// ---------------------------------------------------------------------------
// Test-only RecordLogCommand: injects a no-op PII redactor so construction
// never reaches the production default-dependency path (which builds an
// OtlpSpanPiiRedactionService that requires the analysis wiring). Statics
// (schema, getAggregateId, makeJobId) inherit unchanged, so GQ group-key and
// dedup-ID logic match production exactly.
// ---------------------------------------------------------------------------
class TestRecordLogCommand extends RecordLogCommand {
  static override readonly schema = RecordLogCommand.schema;
  constructor() {
    super({
      piiRedactionService: { redactLog: async () => {} },
    });
  }
}

const SHARD_COUNT = 4;

function generateTestPipelineName(): string {
  return `trace_proc_log_shard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Random 32-char hex traceId (128-bit). */
function randomTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Random 16-char hex spanId (64-bit). */
function randomSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function buildLogPayload({
  tenantId,
  traceId,
  spanId,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
}): RecordLogCommandData {
  return {
    tenantId,
    traceId,
    spanId,
    timeUnixMs: Date.now(),
    severityNumber: 9,
    severityText: "INFO",
    body: `log-${spanId}`,
    attributes: { "event.name": "api_request" },
    resourceAttributes: { "service.name": "claude-code" },
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: "2.1.62",
    piiRedactionLevel: "DISABLED",
    occurredAt: Date.now(),
  };
}

/**
 * Builds a trace-processing pipeline with ONLY the recordLog command, in
 * producer-only "web" role (jobs stage but never drain), so the GQ :data hashes
 * can be inspected. `logShardCount > 1` installs the sharded getGroupKey exactly
 * as production does.
 */
function createLogShardingTestPipeline(
  logShardCount: number,
): PipelineWithCommandHandlers<any, { recordLog: any }> & {
  eventSourcing: EventSourcing;
  ready: () => Promise<void>;
} {
  const pipelineName = generateTestPipelineName();
  const clickHouseClient = getTestClickHouseClient();
  const redisConnection = getTestRedisConnection();

  if (!clickHouseClient) {
    throw new Error(
      "ClickHouse client not available. Ensure testcontainers are started.",
    );
  }
  if (!redisConnection) {
    throw new Error(
      "Redis connection not available. Ensure testcontainers are started.",
    );
  }

  const eventStore = new EventStoreClickHouse(
    new EventRepositoryClickHouse(async () => clickHouseClient),
  );

  const eventSourcing = EventSourcing.createWithStores({
    eventStore,
    clickhouse: async () => clickHouseClient,
    redis: redisConnection,
    processRole: "web",
  });

  // Install the sharded getGroupKey when enabled, exactly like the production
  // composition root in pipeline.ts. Off (shardCount <= 1) installs none, so the
  // command falls back to getAggregateId - the historic per-trace key.
  const recordLogOptions: {
    getGroupKey?: (payload: RecordLogCommandData) => string;
  } = {};
  if (logShardCount > 1) {
    recordLogOptions.getGroupKey = (payload) =>
      logCommandGroupKey({
        traceId: payload.traceId,
        spanId: payload.spanId,
        shardCount: logShardCount,
      });
  }

  const pipelineDefinition = definePipeline<TraceProcessingEvent>()
    .withName(pipelineName)
    .withAggregateType("trace" as AggregateType)
    .withCommand("recordLog", TestRecordLogCommand as any, recordLogOptions)
    .build();

  const pipeline = eventSourcing.register(pipelineDefinition);

  return {
    ...pipeline,
    eventSourcing,
    ready: () => pipeline.service.waitUntilReady(),
  } as any;
}

/**
 * Returns the recordLog GQ `:data` hash keys for the given traceId. Uses a KEYS
 * glob rather than constructing the full key manually, so it is resilient to any
 * pipeline-name prefix the QueueManager adds.
 *
 * Pattern: `*command/recordLog/trace:<traceId>*:data`
 */
async function getLogGroupKeys(traceId: string): Promise<string[]> {
  const redis = getTestRedisConnection();
  if (!redis) throw new Error("Redis connection not available.");
  return redis.keys(`*command/recordLog/trace:${traceId}*:data`);
}

/** Total staged entries across every matching recordLog group for the trace. */
async function getTotalStaged(traceId: string): Promise<number> {
  const redis = getTestRedisConnection();
  if (!redis) throw new Error("Redis connection not available.");
  const keys = await getLogGroupKeys(traceId);
  let total = 0;
  for (const key of keys) total += await redis.hlen(key);
  return total;
}

/** Poll until at least `minEntries` recordLog entries are staged for the trace. */
async function waitForStaged(
  traceId: string,
  minEntries: number,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await getTotalStaged(traceId)) >= minEntries) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The `<shard>` suffix (or null) of a `...trace:<traceId>[:<shard>]:data` key. */
function shardSuffixOf(key: string, traceId: string): string | null {
  const match = key.match(
    new RegExp(`command/recordLog/trace:${traceId}(?::(\\d+))?:data$`),
  );
  if (!match) return null;
  return match[1] ?? null;
}

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

describe.skipIf(!hasTestcontainers)(
  "recordLog GQ-layer sharding (@integration @sharding)",
  () => {
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;

    beforeEach(() => {
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
    });

    afterEach(async () => {
      await cleanupTestDataForTenant(tenantIdString);
    });

    describe("given TRACE_LOG_PROCESSING_SHARDS > 1 for a turn's log records", () => {
      describe("when many recordLog commands for one trace are staged", () => {
        /** @scenario "one turn's logs fan out across ingest lanes" */
        it("spreads them across more than one trace:<traceId>:<shard> group", async () => {
          const pipeline = createLogShardingTestPipeline(SHARD_COUNT);
          await pipeline.ready();
          try {
            const traceId = randomTraceId();
            // 40 distinct span ids so, at 4 shards, more than one bucket is hit
            // with overwhelming probability.
            const spanIds = Array.from({ length: 40 }, () => randomSpanId());
            for (const spanId of spanIds) {
              await pipeline.commands.recordLog.send(
                buildLogPayload({ tenantId: tenantIdString, traceId, spanId }),
              );
            }

            await waitForStaged(traceId, 1);
            await new Promise((resolve) => setTimeout(resolve, 200));

            const keys = await getLogGroupKeys(traceId);
            const shards = new Set(
              keys.map((key) => shardSuffixOf(key, traceId)),
            );
            // Every group is a sharded lane (`:<shard>` suffix), never the bare
            // legacy trace key, and more than one shard is in play.
            expect(shards.has(null)).toBe(false);
            expect(shards.size).toBeGreaterThan(1);
            for (const key of keys) {
              expect(
                new RegExp(
                  `command/recordLog/trace:${traceId}:\\d+:data$`,
                ).test(key),
              ).toBe(true);
            }
          } finally {
            await pipeline.eventSourcing.close();
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }, 45000);
      });
    });

    describe("given sharding is unset (the default)", () => {
      describe("when many recordLog commands for one trace are staged", () => {
        /** @scenario "session grouping is unchanged by sharding" */
        it("collapses them into the single legacy trace:<traceId> group", async () => {
          const pipeline = createLogShardingTestPipeline(1);
          await pipeline.ready();
          try {
            const traceId = randomTraceId();
            const spanIds = Array.from({ length: 12 }, () => randomSpanId());
            for (const spanId of spanIds) {
              await pipeline.commands.recordLog.send(
                buildLogPayload({ tenantId: tenantIdString, traceId, spanId }),
              );
            }

            await waitForStaged(traceId, 1);
            await new Promise((resolve) => setTimeout(resolve, 200));

            const keys = await getLogGroupKeys(traceId);
            // Exactly one group, and it is the bare trace key (no `:<shard>`).
            expect(keys).toHaveLength(1);
            expect(shardSuffixOf(keys[0]!, traceId)).toBe(null);
          } finally {
            await pipeline.eventSourcing.close();
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }, 45000);
      });
    });

    describe("given the recordLog command emits its event", () => {
      /** @scenario "the emitted events still aggregate under the turn's single trace" */
      it("keeps AggregateId = traceId regardless of the shard lane", async () => {
        // The event aggregate comes from getAggregateId (the bare traceId), not
        // the sharded group key, so folds/reactors/UI stay per-trace. Prove it by
        // running the real command over two different spans of one trace.
        const traceId = randomTraceId();
        const command = new TestRecordLogCommand();
        for (const spanId of [randomSpanId(), randomSpanId()]) {
          const events = await command.handle({
            type: RECORD_LOG_COMMAND_TYPE,
            aggregateId: traceId,
            tenantId: tenantIdString,
            data: buildLogPayload({
              tenantId: tenantIdString,
              traceId,
              spanId,
            }),
          } as never);
          expect(events).toHaveLength(1);
          expect(events[0]!.aggregateId).toBe(traceId);
        }
      });
    });
  },
);
