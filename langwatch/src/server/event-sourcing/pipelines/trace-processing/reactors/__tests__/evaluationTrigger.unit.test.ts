import { describe, expect, it, vi } from "vitest";
import type { MonitorSummary } from "~/server/app-layer/monitors/repositories/monitor.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createEvaluationTriggerReactor,
  DEFERRED_CHECK_DELAY_MS,
  type EvaluationTriggerReactorDeps,
} from "../evaluationTrigger.reactor";

function makeEvent(overrides: Partial<TraceProcessingEvent> = {}): TraceProcessingEvent {
  return {
    id: "evt-1",
    type: "trace.span_received",
    version: 1,
    aggregateType: "trace",
    aggregateId: "trace-1",
    tenantId: "project-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    data: {} as any,
    ...overrides,
  } as TraceProcessingEvent;
}

function makeContext(
  overrides: Partial<ReactorContext<TraceSummaryData>> = {},
  attributeOverrides: Record<string, string> = { "langwatch.origin": "application" },
): ReactorContext<TraceSummaryData> {
  return {
    tenantId: "project-1",
    aggregateId: "trace-1",
    foldState: {
      traceId: "trace-1",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "2025-12-18",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      models: [],
      totalCost: null,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      occurredAt: Date.now(),
      blockedByGuardrail: false,
      attributes: attributeOverrides,
      labels: [],
    } as unknown as TraceSummaryData,
    ...overrides,
  };
}

function makeMonitor(overrides: Partial<MonitorSummary> = {}): MonitorSummary {
  return {
    id: "mon-1",
    checkType: "custom/basic",
    name: "Test Monitor",
    threadIdleTimeout: null,
    ...overrides,
  };
}

function createDeps(overrides: Partial<EvaluationTriggerReactorDeps> = {}): EvaluationTriggerReactorDeps {
  return {
    monitors: {
      getEnabledOnMessageMonitors: vi.fn().mockResolvedValue([]),
    } as any,
    evaluation: vi.fn().mockResolvedValue(undefined),
    resolveOrigin: vi.fn().mockResolvedValue(undefined),
    scheduleDeferred: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("evaluationTrigger reactor", () => {
  describe("when monitor is trace-level (no threadIdleTimeout)", () => {
    it("sends with dedup TTL outlasting deferred origin window", async () => {
      const monitor = makeMonitor({ threadIdleTimeout: null });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([monitor]);

      const reactor = createEvaluationTriggerReactor(deps);
      const event = makeEvent();
      const context = makeContext();

      await reactor.handle(event, context);

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(options).toBeDefined();
      expect(options!.deduplication).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(DEFERRED_CHECK_DELAY_MS + 60_000);
      expect(options!.delay).toBeUndefined();
    });
  });

  describe("when monitor is thread-level with threadId present", () => {
    it("sends with dynamic delay and dedup based on threadIdleTimeout", async () => {
      const monitor = makeMonitor({ threadIdleTimeout: 300 });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([monitor]);

      const reactor = createEvaluationTriggerReactor(deps);
      const event = makeEvent();
      const context = makeContext({}, { "langwatch.origin": "application", "gen_ai.conversation.id": "thread-abc" });

      await reactor.handle(event, context);

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(payload.threadId).toBe("thread-abc");
      expect(payload.threadIdleTimeout).toBe(300);
      expect(options).toBeDefined();
      expect(options!.delay).toBe(300_000);
      expect(options!.deduplication).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(300_000);
      // Verify makeId produces thread-scoped dedup key
      const dedupId = options!.deduplication!.makeId(payload);
      expect(dedupId).toContain("thread:thread-abc");
      expect(dedupId).toContain("mon-1");
    });
  });

  describe("when monitor has threadIdleTimeout but no threadId on trace", () => {
    it("falls back to trace-level dedup (6-min TTL, no delay override)", async () => {
      const monitor = makeMonitor({ threadIdleTimeout: 300 });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([monitor]);

      const reactor = createEvaluationTriggerReactor(deps);
      const event = makeEvent();
      const context = makeContext(); // no threadId in attributes

      await reactor.handle(event, context);

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(options).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(DEFERRED_CHECK_DELAY_MS + 60_000);
      expect(options!.delay).toBeUndefined();
    });
  });

  describe("when monitor has threadIdleTimeout of 0", () => {
    it("falls back to trace-level dedup (6-min TTL, no delay override)", async () => {
      const monitor = makeMonitor({ threadIdleTimeout: 0 });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([monitor]);

      const reactor = createEvaluationTriggerReactor(deps);
      const event = makeEvent();
      const context = makeContext({}, { "langwatch.origin": "application", "gen_ai.conversation.id": "thread-abc" });

      await reactor.handle(event, context);

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(options).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(DEFERRED_CHECK_DELAY_MS + 60_000);
      expect(options!.delay).toBeUndefined();
    });
  });
});
