import { describe, expect, it } from "vitest";
import { RECORD_SPAN_DEDUPLICATION } from "../commands/recordSpanCommand";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "../pipeline";
import type { RecordSpanCommandData } from "../schemas/commands";

/**
 * Wiring-level integration test: builds the REAL trace-processing pipeline and
 * checks that the composition root installs span-command sharding on the
 * recordSpan command while leaving the trace-summary fold keyed per trace.
 *
 * Boundaries (stores, reactors) are stubbed — `build()` only stores references
 * and never invokes them, and the no-blobStore path registers the command via
 * `withCommand` (the class is constructed later, at queue init, which this test
 * does not reach), so no ClickHouse / Redis / prisma is required.
 */

const reactorStub = (name: string) => ({ name, handle: async () => {} }) as any;
const outboxReactorStub = (name: string) =>
  ({ name, decide: async () => [] }) as any;

function buildTraceDeps(
  overrides: Partial<TraceProcessingPipelineDeps> = {},
): TraceProcessingPipelineDeps {
  const store = {} as any;
  return {
    spanAppendStore: store,
    logRecordAppendStore: store,
    metricRecordAppendStore: store,
    traceSummaryStore: store,
    originGateReactor: reactorStub("originGate"),
    evaluationTriggerReactor: reactorStub("evaluationTrigger"),
    customEvaluationSyncReactor: reactorStub("customEvaluationSync"),
    traceUpdateBroadcastReactor: reactorStub("traceUpdateBroadcast"),
    projectMetadataReactor: reactorStub("projectMetadata"),
    simulationMetricsSyncReactor: reactorStub("simulationMetricsSync"),
    experimentMetricsSyncReactor: reactorStub("experimentMetricsSync"),
    alertTriggerReactor: outboxReactorStub("alertTrigger"),
    alertTriggerNotifyOutboxReactor: outboxReactorStub(
      "alertTriggerNotifyOutbox",
    ),
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

function recordSpanGroupKeyFn(deps: Partial<TraceProcessingPipelineDeps>) {
  const definition = createTraceProcessingPipeline(buildTraceDeps(deps));
  const recordSpan = definition.commands.find((c) => c.name === "recordSpan");
  expect(recordSpan).toBeDefined();
  expect(recordSpan?.options?.getGroupKey).toBeDefined();
  return recordSpan!.options!.getGroupKey!;
}

describe("trace-processing pipeline span-command sharding", () => {
  describe("given the pipeline is built with several shards", () => {
    it("spreads a trace's spans across more than one group", () => {
      const getGroupKey = recordSpanGroupKeyFn({ spanCommandShardCount: 8 });
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
      const getGroupKey = recordSpanGroupKeyFn({ spanCommandShardCount: 8 });
      const p = payload(TRACE_ID, "0a1b2c3d4e5f6071");
      expect(getGroupKey(p)).toBe(getGroupKey(p));
    });

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
  });

  describe("given the pipeline is built with sharding disabled", () => {
    it("returns the bare trace id, identical to before sharding existed", () => {
      const getGroupKey = recordSpanGroupKeyFn({ spanCommandShardCount: 1 });
      expect(getGroupKey(payload(TRACE_ID, "abc"))).toBe(TRACE_ID);
    });

    it("defaults to disabled when no shard count is configured", () => {
      const getGroupKey = recordSpanGroupKeyFn({});
      expect(getGroupKey(payload(TRACE_ID, "abc"))).toBe(TRACE_ID);
    });
  });

  describe("given non-OTel-compliant trace and span ids", () => {
    it("still derives a stable sharded group for arbitrary string ids", () => {
      const getGroupKey = recordSpanGroupKeyFn({ spanCommandShardCount: 8 });
      const weirdTrace = "my-custom::trace/id";
      const weirdSpan = "span_ABC!@# 123";
      const key = getGroupKey(payload(weirdTrace, weirdSpan));
      expect(key.startsWith(`${weirdTrace}:`)).toBe(true);
      expect(getGroupKey(payload(weirdTrace, weirdSpan))).toBe(key);
    });

    it("preserves the raw id as the group key when sharding is off", () => {
      const getGroupKey = recordSpanGroupKeyFn({ spanCommandShardCount: 1 });
      const weirdTrace = "550e8400-e29b-41d4-a716-446655440000";
      expect(getGroupKey(payload(weirdTrace, "not-hex"))).toBe(weirdTrace);
    });
  });

  describe("given the recordSpan command is registered", () => {
    it("keeps the per-span deduplication config intact", () => {
      const definition = createTraceProcessingPipeline(
        buildTraceDeps({ spanCommandShardCount: 8 }),
      );
      const recordSpan = definition.commands.find(
        (c) => c.name === "recordSpan",
      );
      expect(recordSpan?.options?.deduplication).toBe(
        RECORD_SPAN_DEDUPLICATION,
      );
    });
  });
});
