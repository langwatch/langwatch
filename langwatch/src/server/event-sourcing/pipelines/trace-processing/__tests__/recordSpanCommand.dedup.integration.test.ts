/**
 * Regression test: RecordSpanCommand GQ-layer deduplication
 *
 * Proves that sending the same (tenantId, traceId, spanId) identity multiple
 * times within the dedup window results in exactly one entry in the group-queue
 * staging hash, while distinct identities each get their own entry.
 *
 * This test exercises the GroupQueue staging layer (Redis hash) directly.
 * It runs in "web" (producer-only) process role so jobs are never consumed
 * and remain in the staging hash long enough to inspect.
 *
 * Scenario 1 (@regression): MUST FAIL on main before the dedup fix is applied —
 *   HLEN will be 5 (one per send call) instead of 1.
 * Scenario 2 (@integration): MUST PASS before and after the fix —
 *   proves the fix does not over-deduplicate distinct identities.
 */

import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
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
import { AssignTopicCommand } from "../commands/assignTopicCommand";
import {
  RecordSpanCommand,
  RECORD_SPAN_DEDUPLICATION,
} from "../commands/recordSpanCommand";
import { SpanStorageMapProjection } from "../projections/spanStorage.mapProjection";
import { TraceSummaryFoldProjection } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";
import type { OtlpSpan } from "../schemas/otlp";
import { SpanAppendStore } from "../projections/spanStorage.store";
import { TraceSummaryStore } from "../projections/traceSummary.store";

// ---------------------------------------------------------------------------
// Test-only RecordSpanCommand subclass
//
// Injects no-op enrichment deps so `new RecordSpanCommand()` never calls
// `require("~/server/db")`. This mirrors the pattern used in
// traceProcessing.coalescing.integration.test.ts:25-34.
//
// IMPORTANT: the pipeline still registers this as `RecordSpanCommand as any`
// so `.schema`, `.getAggregateId`, and `.makeJobId` are pulled from the real
// class via the static inheritance chain, faithfully mirroring production.
// ---------------------------------------------------------------------------

class TestRecordSpanCommand extends RecordSpanCommand {
  static override readonly schema = RecordSpanCommand.schema;
  constructor() {
    super({
      piiRedactionService: { redactSpan: async () => {} },
      costEnrichmentService: { enrichSpan: async () => {} },
      tokenEstimationService: { estimateSpanTokens: async () => {} },
      contentDropService: {
        dropSpanContent: async () => ({
          droppedCount: 0,
          droppedCategories: [],
        }),
      },
    } as never);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTestPipelineName(): string {
  return `trace_proc_dedup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Generates a random 32-character hex traceId (128-bit). */
function randomTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Generates a random 16-character hex spanId (64-bit). */
function randomSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/** Builds a minimal valid OtlpSpan for staging tests. */
function buildTestSpan({
  traceId,
  spanId,
}: {
  traceId: string;
  spanId: string;
}): OtlpSpan {
  const startNano = BigInt(Date.now()) * 1_000_000n;
  const endNano = startNano + BigInt(100) * 1_000_000n;
  return {
    traceId,
    spanId,
    parentSpanId: null,
    name: `test-span-${spanId}`,
    kind: 1,
    startTimeUnixNano: startNano.toString(),
    endTimeUnixNano: endNano.toString(),
    attributes: [],
    events: [],
    links: [],
    status: { code: 1, message: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

/**
 * Builds a trace processing pipeline using real Redis (producer-only, no consumer)
 * and real ClickHouse — mirroring `createTraceTestPipeline` from the sibling
 * integration test, except processRole is "web" so jobs are staged but never
 * dispatched. This lets us inspect the GQ :data hash before it is drained.
 */
function createDeduplicationTestPipeline(): PipelineWithCommandHandlers<
  any,
  { recordSpan: any; assignTopic: any }
> & {
  eventStore: EventStoreClickHouse;
  eventSourcing: EventSourcing;
  pipelineName: string;
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

  // "web" role → consumerEnabled: false → jobs are staged but never consumed.
  // This keeps them in the GQ :data hash so we can inspect HLEN directly.
  const eventSourcing = EventSourcing.createWithStores({
    eventStore,
    clickhouse: async () => clickHouseClient,
    redis: redisConnection,
    processRole: "web",
  });

  const spanAppendStore = new SpanAppendStore(
    new SpanStorageService(
      new SpanStorageClickHouseRepository(async () => clickHouseClient),
    ).repository,
  );
  const traceSummaryStore = new TraceSummaryStore(
    new TraceSummaryService(
      new TraceSummaryClickHouseRepository(async () => clickHouseClient),
    ).repository,
  );

  const pipelineDefinition = definePipeline<TraceProcessingEvent>()
    .withName(pipelineName)
    .withAggregateType("trace" as AggregateType)
    .withFoldProjection(
      "traceSummary",
      new TraceSummaryFoldProjection({ store: traceSummaryStore }) as any,
    )
    .withMapProjection(
      "spanStorage",
      new SpanStorageMapProjection({ store: spanAppendStore }) as any,
    )
    // Production-faithful registration: imports the SAME RECORD_SPAN_DEDUPLICATION
    // constant the production pipeline uses. Reverting the production registration
    // (removing the third arg from `withCommand("recordSpan", ...)` in pipeline.ts)
    // would not be enough to silence this test on its own — but the shared constant
    // means the production options and the test options can never drift, so any
    // future change to dedup semantics flows through one place.
    //
    // TestRecordSpanCommand is a no-op-deps subclass of RecordSpanCommand used to
    // avoid `require("~/server/db")` in integration tests. All static properties
    // (schema, getAggregateId, makeJobId) inherit unchanged, so GQ group-key and
    // dedup-ID logic match production exactly.
    .withCommand("recordSpan", TestRecordSpanCommand as any, {
      deduplication: RECORD_SPAN_DEDUPLICATION,
    })
    .withCommand("assignTopic", AssignTopicCommand as any)
    .build();

  const pipeline = eventSourcing.register(pipelineDefinition);

  return {
    ...pipeline,
    eventStore,
    eventSourcing,
    pipelineName,
    ready: () => pipeline.service.waitUntilReady(),
  } as any;
}

/**
 * Scans Redis for the GQ `:data` hash key for the given traceId and returns
 * HLEN (number of staged jobs for that group). Uses KEYS glob rather than
 * constructing the full key manually, so it is resilient to any pipeline-name
 * prefix the QueueManager adds.
 *
 * Pattern: `*command/recordSpan/trace:<traceId>:data`
 */
async function getGroupDataHlen(traceId: string): Promise<number> {
  const redis = getTestRedisConnection();
  if (!redis) throw new Error("Redis connection not available.");

  const pattern = `*command/recordSpan/trace:${traceId}:data`;
  const keys = await redis.keys(pattern);
  if (keys.length === 0) return 0;

  // Sum across all matching keys (should be exactly one per pipeline)
  let total = 0;
  for (const key of keys) {
    total += await redis.hlen(key);
  }
  return total;
}

/**
 * Polls until the GQ :data hash for the given traceId has at least `minEntries`
 * entries, or until `timeoutMs` elapses.
 *
 * This is needed because Redis `send()` is async and the staging may not be
 * visible immediately after the awaited `send()` calls return (pipeline
 * batching, Lua eval timing, etc.).
 */
async function waitForStagedEntries(
  traceId: string,
  minEntries: number,
  timeoutMs = 5000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hlen = await getGroupDataHlen(traceId);
    if (hlen >= minEntries) return hlen;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return getGroupDataHlen(traceId);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

describe.skipIf(!hasTestcontainers)(
  "RecordSpanCommand GQ-layer deduplication (@regression @integration)",
  () => {
    let pipeline: ReturnType<typeof createDeduplicationTestPipeline>;
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;

    beforeEach(async () => {
      pipeline = createDeduplicationTestPipeline();
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      await pipeline.ready();
    });

    afterEach(async () => {
      await pipeline.eventSourcing.close();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await cleanupTestDataForTenant(tenantIdString);
    });

    describe(
      "given the recordSpan command is registered in a trace processing pipeline",
      () => {
        describe(
          "when the same (tenant, trace, span) identity is dispatched multiple times within the dedup window",
          () => {
            /** @scenario Repeated dispatches of the same span identity collapse to one staged entry */
            it(
              "stores exactly one entry in the group data hash for that identity",
              async () => {
                const traceId = randomTraceId();
                const spanId = randomSpanId();
                const payload = {
                  tenantId: tenantIdString,
                  span: buildTestSpan({ traceId, spanId }),
                  resource: null,
                  instrumentationScope: { name: "test" },
                  piiRedactionLevel: "ESSENTIAL" as const,
                  occurredAt: Date.now(),
                };

                // Dispatch the same identity 5 times in quick succession.
                // Without dedup, each call stages a distinct job → HLEN = 5.
                // With dedup, all collapse to one → HLEN = 1.
                for (let i = 0; i < 5; i++) {
                  await pipeline.commands.recordSpan.send(payload);
                }

                // Wait for at least one staged entry to appear (staging is async).
                // We wait for at least 1 since that is the minimum whether or not
                // the fix is in place. We then check the actual count.
                await waitForStagedEntries(traceId, 1);

                // Allow a short additional window for all five staging operations
                // to settle — in the pre-fix case we need HLEN to reach 5 so
                // the assertion definitively catches the bug.
                await new Promise((resolve) => setTimeout(resolve, 200));

                const hlen = await getGroupDataHlen(traceId);

                // FAILS before the fix (hlen === 5), PASSES after (hlen === 1).
                expect(hlen).toBe(1);
              },
            );
          },
        );

        describe(
          "when distinct (tenant, trace, span) identities are dispatched on the same trace",
          () => {
            /** @scenario Distinct span identities on the same trace each get their own staged entry */
            it(
              "stores one entry per distinct identity in the group data hash",
              async () => {
                const traceId = randomTraceId();
                const spanIds = [randomSpanId(), randomSpanId(), randomSpanId()];

                for (const spanId of spanIds) {
                  await pipeline.commands.recordSpan.send({
                    tenantId: tenantIdString,
                    span: buildTestSpan({ traceId, spanId }),
                    resource: null,
                    instrumentationScope: { name: "test" },
                    piiRedactionLevel: "ESSENTIAL" as const,
                    occurredAt: Date.now(),
                  });
                }

                // Wait for all 3 distinct entries to appear in the staging hash.
                await waitForStagedEntries(traceId, 3);
                await new Promise((resolve) => setTimeout(resolve, 200));

                const hlen = await getGroupDataHlen(traceId);

                // Each distinct (traceId, spanId) pair is a separate job.
                // PASSES before and after the fix.
                expect(hlen).toBe(3);
              },
            );
          },
        );
      },
    );
  },
);
