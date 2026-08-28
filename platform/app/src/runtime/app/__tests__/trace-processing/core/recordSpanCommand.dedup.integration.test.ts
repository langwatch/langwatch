import { AppTraceProjectionsAdapter } from "~/runtime/app/trace-projections.adapter";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
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
import type { EventSourcing, PipelineWithCommandHandlers } from "@langwatch/eventing";
import { defineAggregate, defineEvents, definePipeline } from "@langwatch/eventing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryClickHouseRepository } from "@langwatch/trace-server";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { createAppTraceSummaryStore } from "~/runtime/app/trace-summary-fold.adapter";
import { AppTraceProjectionStorageAdapter } from "~/runtime/app/trace-projection-storage.adapter";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
} from "@langwatch/eventing/server";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestEventSourcing,
  createTestTenantId,
  getTenantIdString,
} from "~/server/event-sourcing/__tests__/integration/testHelpers";
import { AssignTopicCommand } from "@langwatch/trace-server";
import { RECORD_SPAN_DEDUPLICATION, RecordSpanCommand } from "@langwatch/trace-server";
import { TraceSummaryFoldProjection } from "@langwatch/trace-server";
import { TRACE_PROCESSING_EVENT_TYPES } from "@langwatch/trace-contract";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";

function createTestRecordSpanCommand(): RecordSpanCommand {
  return RecordSpanCommand.create({
    piiRedaction: { redact: async () => {} },
    costEnrichment: { enrich: async () => {} },
    tokenEstimation: { estimate: async () => {} },
    contentDrop: {
      drop: async () => ({ droppedCount: 0, droppedCategories: [] }),
    },
  });
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
function buildTestSpan({ traceId, spanId }: { traceId: string; spanId: string }): OtlpSpan {
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
  eventStore: EventingClickHouseEventStore;
  eventSourcing: EventSourcing;
  pipelineName: string;
  ready: () => Promise<void>;
} {
  const pipelineName = generateTestPipelineName();
  const clickHouseClient = getTestClickHouseClient();
  const redisConnection = getTestRedisConnection();

  if (!clickHouseClient) {
    throw new Error("ClickHouse client not available. Ensure testcontainers are started.");
  }
  if (!redisConnection) {
    throw new Error("Redis connection not available. Ensure testcontainers are started.");
  }

  const retention = createEventingRetentionConfiguration({
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
  });
  const eventStore = EventingClickHouseEventStore.create({
    repository: EventingClickHouseEventRepository.create({
      resolveClient: async () => clickHouseClient,
      retention,
    }),
    retention,
  });

  // "web" role → consumerEnabled: false → jobs are staged but never consumed.
  // This keeps them in the GQ :data hash so we can inspect HLEN directly.
  const eventSourcing = createTestEventSourcing({
    eventStore,
    redis: redisConnection,
    consumersEnabled: false,
  });

  const spanAppendStore = AppTraceProjectionStorageAdapter.createSpanStore({
    repository: new SpanStorageService(
      new SpanStorageClickHouseRepository(async () => clickHouseClient),
    ).repository,
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
  });
  const traceSummaryStore = createAppTraceSummaryStore({
    repository: new TraceSummaryService(
      TraceSummaryClickHouseRepository.create({
        resolveClient: async () => clickHouseClient,
        defaultRetentionDays: 30,
      }),
    ).repository,
    redis: null,
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
  });

  const pipelineDefinition = definePipeline<TraceProcessingEvent>({
    name: pipelineName,
    aggregate: defineAggregate({
      type: "trace",
      events: defineEvents(TRACE_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseFoldProjection(
      TraceSummaryFoldProjection.create({
        store: traceSummaryStore,
        runtime: AppTraceProjectionsAdapter.createRuntime(TraceCanonicalisationService.create()),
        traceCanonicalisation: TraceCanonicalisationService.create(),
      }) as any,
    )
    .withClickHouseMapProjection(
      AppTraceProjectionsAdapter.createSpanStorageProjection({
        store: spanAppendStore,
        canonicalisation: TraceCanonicalisationService.create(),
      }) as any,
    )
    .withCommandInstance("recordSpan", RecordSpanCommand, createTestRecordSpanCommand(), {
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

const hasTestcontainers = !!(process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL);

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

    describe("given the recordSpan command is registered in a trace processing pipeline", () => {
      describe("when the same (tenant, trace, span) identity is dispatched multiple times within the dedup window", () => {
        /** @scenario Repeated dispatches of the same span identity collapse to one staged entry */
        it("stores exactly one entry in the group data hash for that identity", async () => {
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
        });
      });

      describe("when distinct (tenant, trace, span) identities are dispatched on the same trace", () => {
        /** @scenario Distinct span identities on the same trace each get their own staged entry */
        it("stores one entry per distinct identity in the group data hash", async () => {
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
        });
      });
    });
  },
);
