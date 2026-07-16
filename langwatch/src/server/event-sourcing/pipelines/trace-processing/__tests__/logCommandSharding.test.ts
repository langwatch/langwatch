import { describe, expect, it, vi } from "vitest";
import { RecordLogCommand } from "../commands/recordLogCommand";
import { MAX_LOG_SHARD_COUNT } from "../commands/logCommandGroupKey";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "../pipeline";
import type { RecordLogCommandData } from "../schemas/commands";

// The blobStore registration branch eagerly constructs `new RecordSpanCommand`,
// whose default-dependency path does `require("~/server/db")` (an alias vitest's
// ESM can't resolve at runtime) and builds a tokenizer. Give the command a
// complete set of no-op deps so construction is cheap - statics stay real, which
// is all the pipeline wiring under test needs. Mirrors spanCommandSharding.test.
vi.mock("../commands/recordSpanCommand", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  class StubRecordSpanCommand extends actual.RecordSpanCommand {
    constructor(deps?: Record<string, unknown>) {
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
        ...deps,
      } as never);
    }
  }
  return { ...actual, RecordSpanCommand: StubRecordSpanCommand };
});

/**
 * Wiring-level integration test: builds the REAL trace-processing pipeline and
 * checks that the composition root installs log-command sharding on the
 * recordLog command while leaving the trace-summary fold keyed per trace.
 * `build()` only stores references, so no store / reactor is ever invoked.
 */

const reactorStub = (name: string) => ({ name, handle: async () => {} }) as any;

function buildTraceDeps(
  overrides: Partial<TraceProcessingPipelineDeps> = {},
): TraceProcessingPipelineDeps {
  const store = {} as any;
  return {
    spanAppendStore: store,
    logRecordAppendStore: store,
    traceSummaryStore: store,
    traceAnalyticsStore: store,
    traceAnalyticsRollupAppendStore: store,
    originGateReactor: reactorStub("originGate"),
    evaluationTriggerReactor: reactorStub("evaluationTrigger"),
    customEvaluationSyncReactor: reactorStub("customEvaluationSync"),
    traceUpdateBroadcastReactor: reactorStub("traceUpdateBroadcast"),
    projectMetadataReactor: reactorStub("projectMetadata"),
    simulationMetricsSyncReactor: reactorStub("simulationMetricsSync"),
    experimentMetricsSyncReactor: reactorStub("experimentMetricsSync"),
    automations: {
      triggerMatchHandler: vi.fn().mockResolvedValue(undefined),
      graphActivityHandler: vi.fn().mockResolvedValue(undefined),
    },
    spanStorageBroadcastReactor: reactorStub("spanStorageBroadcast"),
    claudeCodeSpanSyncReactor: reactorStub("claudeCodeSpanSync"),
    ...overrides,
  };
}

const TRACE_ID = "534bd8a1bf83e7c58e8aaacefb047cc2";

/** Minimal recordLog payload - getGroupKey only reads `{traceId,spanId}`. */
function payload(traceId: string, spanId: string): RecordLogCommandData {
  return { traceId, spanId } as unknown as RecordLogCommandData;
}

function recordLogCommand(deps: Partial<TraceProcessingPipelineDeps> = {}) {
  const cmd = createTraceProcessingPipeline(buildTraceDeps(deps)).commands.find(
    (c) => c.name === "recordLog",
  );
  expect(cmd).toBeDefined();
  return cmd!;
}

/** Group-key fn of an enabled (sharded) pipeline. Asserts it was installed. */
function shardedGroupKey(deps: Partial<TraceProcessingPipelineDeps>) {
  const getGroupKey = recordLogCommand(deps).options?.getGroupKey;
  expect(getGroupKey).toBeDefined();
  return getGroupKey!;
}

/** Shard suffix from the LAST colon - robust to colon-bearing trace ids. */
function shardOf(key: string): number {
  return Number(key.slice(key.lastIndexOf(":") + 1));
}

describe("trace-processing pipeline log-command sharding", () => {
  describe("given the pipeline is built with several shards", () => {
    /** @scenario "one turn's logs fan out across ingest lanes" */
    it("spreads a turn's log records across more than one group", () => {
      const getGroupKey = shardedGroupKey({ logCommandShardCount: 8 });
      const groups = new Set(
        Array.from({ length: 64 }, (_, i) =>
          getGroupKey(payload(TRACE_ID, (i + 1).toString(16).padStart(16, "0"))),
        ),
      );
      expect(groups.size).toBeGreaterThan(1);
      for (const key of groups) {
        expect(key.startsWith(`${TRACE_ID}:`)).toBe(true);
      }
    });

    it("routes the same log record to the same group every time", () => {
      const getGroupKey = shardedGroupKey({ logCommandShardCount: 8 });
      const p = payload(TRACE_ID, "0a1b2c3d4e5f6071");
      expect(getGroupKey(p)).toBe(getGroupKey(p));
    });

    /** @scenario "one turn's logs fan out across ingest lanes" */
    it("keeps the trace-summary fold keyed per trace, not per shard", () => {
      const definition = createTraceProcessingPipeline(
        buildTraceDeps({ logCommandShardCount: 8 }),
      );
      // No custom fold key → the fold queue falls back to the trace aggregate id,
      // so the fold stays serialized (and coalesced) per trace regardless of how
      // the recordLog command is sharded.
      expect(
        definition.foldProjections.get("traceSummary")?.definition.key,
      ).toBe(undefined);
    });

    /** @scenario "one turn's logs fan out across ingest lanes" */
    it("keeps the emitted event's aggregate the whole trace, never a shard", () => {
      // The command's getAggregateId (which stamps the event aggregate) is the
      // bare traceId; only the GroupQueue lane is sharded. This is what keeps the
      // span-sync reactor's cross-record tool-output join intact.
      expect(RecordLogCommand.getAggregateId(payload(TRACE_ID, "abc"))).toBe(
        TRACE_ID,
      );
    });

    it("clamps an out-of-range shard count so it can't explode the group space", () => {
      const getGroupKey = shardedGroupKey({ logCommandShardCount: 100_000 });
      for (let i = 0; i < 256; i++) {
        const key = getGroupKey(
          payload(TRACE_ID, (i + 1).toString(16).padStart(16, "0")),
        );
        expect(shardOf(key)).toBeLessThan(MAX_LOG_SHARD_COUNT);
      }
    });
  });

  describe("given the pipeline is built with sharding disabled", () => {
    /** @scenario "session grouping is unchanged by sharding" */
    it("installs no getGroupKey, keeping the historic getAggregateId trace key", () => {
      const cmd = recordLogCommand({ logCommandShardCount: 1 });
      expect(cmd.options?.getGroupKey).toBeUndefined();
      expect(RecordLogCommand.getAggregateId(payload(TRACE_ID, "abc"))).toBe(
        TRACE_ID,
      );
    });

    it("installs no getGroupKey when no shard count is configured", () => {
      expect(recordLogCommand({}).options?.getGroupKey).toBeUndefined();
    });
  });

  describe("given non-OTel-compliant trace and span ids", () => {
    it("still derives a stable sharded group for arbitrary string ids", () => {
      const getGroupKey = shardedGroupKey({ logCommandShardCount: 8 });
      const weirdTrace = "my-custom::trace/id";
      const weirdSpan = "span_ABC!@# 123";
      const key = getGroupKey(payload(weirdTrace, weirdSpan));
      expect(key.startsWith(`${weirdTrace}:`)).toBe(true);
      expect(getGroupKey(payload(weirdTrace, weirdSpan))).toBe(key);
    });
  });
});
