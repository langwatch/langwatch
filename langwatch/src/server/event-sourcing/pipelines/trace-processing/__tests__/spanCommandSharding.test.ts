import { describe, expect, it, vi } from "vitest";
import {
  RECORD_SPAN_DEDUPLICATION,
  RecordSpanCommand,
} from "../commands/recordSpanCommand";
import { MAX_SPAN_SHARD_COUNT } from "../commands/spanCommandGroupKey";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "../pipeline";
import type { RecordSpanCommandData } from "../schemas/commands";

// The blobStore registration branch eagerly constructs `new RecordSpanCommand`,
// whose default-dependency path does `require("~/server/db")` (an alias vitest's
// ESM can't resolve at runtime) and builds a tokenizer. Give the command a
// complete set of no-op deps so construction is cheap — statics
// (getAggregateId, schema) and RECORD_SPAN_DEDUPLICATION stay real, which is all
// the pipeline wiring under test needs. Mirrors the TestRecordSpanCommand
// pattern in traceProcessing.coalescing.integration.test.ts.
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
 * checks that the composition root installs span-command sharding on the
 * recordSpan command — through both registration branches — while leaving the
 * trace-summary fold keyed per trace. `build()` only stores references, so no
 * store / reactor is ever invoked.
 */

const reactorStub = (name: string) => ({ name, handle: async () => {} }) as any;

function buildTraceDeps(
  overrides: Partial<TraceProcessingPipelineDeps> = {},
): TraceProcessingPipelineDeps {
  const store = {} as any;
  return {
    spanAppendStore: store,
    traceSummaryStore: store,
    traceAnalyticsStore: store,
    traceAnalyticsRollupAppendStore: store,
    logRecordAppendStore: store,
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

/** Minimal recordSpan payload — getGroupKey only reads `span.{traceId,spanId}`. */
function payload(traceId: string, spanId: string): RecordSpanCommandData {
  return { span: { traceId, spanId } } as unknown as RecordSpanCommandData;
}

function recordSpanCommand(deps: Partial<TraceProcessingPipelineDeps> = {}) {
  const cmd = createTraceProcessingPipeline(buildTraceDeps(deps)).commands.find(
    (c) => c.name === "recordSpan",
  );
  expect(cmd).toBeDefined();
  return cmd!;
}

/** Group-key fn of an enabled (sharded) pipeline. Asserts it was installed. */
function shardedGroupKey(deps: Partial<TraceProcessingPipelineDeps>) {
  const getGroupKey = recordSpanCommand(deps).options?.getGroupKey;
  expect(getGroupKey).toBeDefined();
  return getGroupKey!;
}

/** Shard suffix from the LAST colon — robust to colon-bearing trace ids. */
function shardOf(key: string): number {
  return Number(key.slice(key.lastIndexOf(":") + 1));
}

describe("trace-processing pipeline span-command sharding", () => {
  describe("given the pipeline is built with several shards", () => {
    it("spreads a trace's spans across more than one group", () => {
      const getGroupKey = shardedGroupKey({ spanCommandShardCount: 8 });
      const groups = new Set(
        Array.from({ length: 64 }, (_, i) =>
          getGroupKey(
            payload(TRACE_ID, (i + 1).toString(16).padStart(16, "0")),
          ),
        ),
      );
      expect(groups.size).toBeGreaterThan(1);
      for (const key of groups) {
        expect(key.startsWith(`${TRACE_ID}:`)).toBe(true);
      }
    });

    it("routes the same span to the same group every time", () => {
      const getGroupKey = shardedGroupKey({ spanCommandShardCount: 8 });
      const p = payload(TRACE_ID, "0a1b2c3d4e5f6071");
      expect(getGroupKey(p)).toBe(getGroupKey(p));
    });

    /** @scenario "The pipeline shards the command while leaving the fold per-trace" */
    it("keeps the trace-summary fold keyed per trace, not per span", () => {
      const definition = createTraceProcessingPipeline(
        buildTraceDeps({ spanCommandShardCount: 8 }),
      );
      // No custom fold key → the fold queue falls back to the trace aggregate id,
      // so the fold stays serialized (and coalesced) per trace regardless of how
      // the command is sharded.
      expect(
        definition.foldProjections.get("traceSummary")?.definition.key,
      ).toBe(undefined);
    });

    it("clamps an out-of-range shard count so it can't explode the group space", () => {
      // A caller bypassing PipelineRegistry's env resolver passes an absurd
      // count; the pipeline clamps to MAX_SPAN_SHARD_COUNT, so every derived
      // shard stays in range.
      const getGroupKey = shardedGroupKey({ spanCommandShardCount: 100_000 });
      for (let i = 0; i < 256; i++) {
        const key = getGroupKey(
          payload(TRACE_ID, (i + 1).toString(16).padStart(16, "0")),
        );
        expect(shardOf(key)).toBeLessThan(MAX_SPAN_SHARD_COUNT);
      }
    });
  });

  describe("given the blobStore registration branch", () => {
    it("installs the same sharded getGroupKey as the plain-command path", () => {
      // The blobStore branch registers recordSpan via withCommandInstance (a
      // pre-constructed handler) rather than withCommand — assert sharding is not
      // silently limited to the no-blobStore path.
      const cmd = recordSpanCommand({
        spanCommandShardCount: 8,
        blobStore: {
          getSpool: async () => Buffer.from(""),
          deleteSpool: async () => {},
        } as any,
      });
      const getGroupKey = cmd.options?.getGroupKey;
      expect(getGroupKey).toBeDefined();
      expect(
        getGroupKey!(payload(TRACE_ID, "00000000000000ff")).startsWith(
          `${TRACE_ID}:`,
        ),
      ).toBe(true);
    });
  });

  describe("given the pipeline is built with sharding disabled", () => {
    /** @scenario "The pipeline preserves the trace-only key when sharding is off" */
    it("installs no getGroupKey, keeping the historic getAggregateId trace key", () => {
      const cmd = recordSpanCommand({ spanCommandShardCount: 1 });
      expect(cmd.options?.getGroupKey).toBeUndefined();
      expect(RecordSpanCommand.getAggregateId(payload(TRACE_ID, "abc"))).toBe(
        TRACE_ID,
      );
    });

    it("installs no getGroupKey when no shard count is configured", () => {
      expect(recordSpanCommand({}).options?.getGroupKey).toBeUndefined();
    });
  });

  describe("given non-OTel-compliant trace and span ids", () => {
    it("still derives a stable sharded group for arbitrary string ids", () => {
      const getGroupKey = shardedGroupKey({ spanCommandShardCount: 8 });
      const weirdTrace = "my-custom::trace/id";
      const weirdSpan = "span_ABC!@# 123";
      const key = getGroupKey(payload(weirdTrace, weirdSpan));
      expect(key.startsWith(`${weirdTrace}:`)).toBe(true);
      expect(getGroupKey(payload(weirdTrace, weirdSpan))).toBe(key);
    });

    it("keeps the raw trace id via getAggregateId when sharding is off", () => {
      const cmd = recordSpanCommand({ spanCommandShardCount: 1 });
      expect(cmd.options?.getGroupKey).toBeUndefined();
      const weirdTrace = "550e8400-e29b-41d4-a716-446655440000";
      expect(
        RecordSpanCommand.getAggregateId(payload(weirdTrace, "not-hex")),
      ).toBe(weirdTrace);
    });
  });

  describe("given the recordSpan command is registered", () => {
    it("keeps the per-span deduplication config intact", () => {
      expect(
        recordSpanCommand({ spanCommandShardCount: 8 }).options?.deduplication,
      ).toBe(RECORD_SPAN_DEDUPLICATION);
    });
  });
});
