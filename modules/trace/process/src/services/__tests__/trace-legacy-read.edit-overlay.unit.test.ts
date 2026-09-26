import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { Protections, Trace, TraceCanonicalisationService } from "@langwatch/trace-contract";
/**
 * @vitest-environment node
 * Spec: specs/traces-v2/trace-edit-overlay.feature
 * withEditOverlay: applies per-trace corrections, wins over ClickHouse reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTracesWithSpans, mockGetTracesWithSpansByThreadIds, mockGetPatchesByTraceIds } =
  vi.hoisted(() => ({
    mockGetTracesWithSpans: vi.fn(),
    mockGetTracesWithSpansByThreadIds: vi.fn(),
    mockGetPatchesByTraceIds: vi.fn(),
  }));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const fakeSpan = { setAttribute: () => {}, setAttributes: () => {} };
      return (fn as (s: typeof fakeSpan) => Promise<unknown>)(fakeSpan);
    },
  }),
}));

import { MemoryTraceEditOverlayRepository } from "../../repositories/memory/memory.trace-edit-overlay.repository.ts";
import { TraceEditOverlayService } from "../trace-edit-overlay.service.ts";
import { TraceLegacyReadService } from "../trace-legacy-read.service.ts";

const PROJECT_ID = "project_test";

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

function refusingEvaluations(): EvaluationApi {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("this test reads no evaluation behind a trace");
      },
    },
  ) as EvaluationApi;
}

function trace(traceId: string, output = "captured output"): Trace {
  return {
    trace_id: traceId,
    project_id: PROJECT_ID,
    metadata: {},
    timestamps: {
      started_at: 1_700_000_000_000,
      inserted_at: 1_700_000_000_000,
      updated_at: 1_700_000_001_000,
    },
    output: { value: output },
    spans: [],
  };
}

function traceOutputPatch(value: string) {
  return { version: 1, trace: { output: { value } }, spans: [], deletedSpanIds: [] };
}

function makeService(): TraceLegacyReadService {
  const editOverlay = TraceEditOverlayService.create(MemoryTraceEditOverlayRepository.create());
  vi.spyOn(editOverlay, "getPatchesByTraceIds").mockImplementation(mockGetPatchesByTraceIds);
  return TraceLegacyReadService.create({
    traceCanonicalisation: {} as TraceCanonicalisationService,
    traceRead: {
      findTracesWithSpans: mockGetTracesWithSpans,
      findTracesWithSpansByThreadIds: mockGetTracesWithSpansByThreadIds,
      resolveTraceIdByPrefix: vi.fn().mockResolvedValue([]),
      listAllTracesForProject: vi.fn(),
      findTracesByThreadId: vi.fn(),
      findCustomersAndLabels: vi.fn(),
      findDistinctFieldNames: vi.fn(),
      findTopicCounts: vi.fn(),
      findSpanForPromptStudio: vi.fn(),
    },
    editOverlay,
    evaluationService: refusingEvaluations(),
  });
}

describe("TraceService withEditOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the add-to-dataset read asks for the corrected trace", () => {
    /** @scenario "The add-to-dataset read returns the corrected trace" */
    it("returns the trace with its correction applied", async () => {
      mockGetTracesWithSpans.mockResolvedValue([trace("trace-1")]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([["trace-1", traceOutputPatch("the corrected answer")]]),
      );

      const result = await makeService().findById({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        protections,
        opts: {
          withEditOverlay: true,
        },
      });

      expect(result?.output?.value).toBe("the corrected answer");
    });
  });

  describe("given a reader that does not ask for corrections", () => {
    /** @scenario "Readers that do not ask for corrections get the original" */
    it("returns the trace as captured, without consulting the overlay store", async () => {
      mockGetTracesWithSpans.mockResolvedValue([trace("trace-1")]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([["trace-1", traceOutputPatch("a correction this reader never asked for")]]),
      );

      const result = await makeService().findById({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        protections,
      });

      expect(result?.output?.value).toBe("captured output");
      expect(mockGetPatchesByTraceIds).not.toHaveBeenCalled();
    });
  });

  describe("given a conversation whose traces are corrected differently", () => {
    /** @scenario "Thread mode applies each trace its own correction" */
    it("gives each trace only its own correction", async () => {
      mockGetTracesWithSpansByThreadIds.mockResolvedValue([trace("trace-1"), trace("trace-2")]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([
          ["trace-1", traceOutputPatch("first correction")],
          ["trace-2", traceOutputPatch("second correction")],
        ]),
      );

      const traces = await makeService().getTracesWithSpansByThreadIds({
        projectId: PROJECT_ID,
        threadIds: ["thread-1"],
        protections,
        opts: { full: true, withEditOverlay: true },
      });

      expect(traces.map((t) => t.output?.value)).toEqual(["first correction", "second correction"]);
    });
  });

  describe("given a trace whose captured content was already resolved by the read", () => {
    /** @scenario "Corrections are applied after the trace content is fully resolved" */
    it("lets the correction win over the resolved content", async () => {
      mockGetTracesWithSpans.mockResolvedValue([trace("trace-1", "resolved from the blob store")]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([["trace-1", traceOutputPatch("the reviewer's correction")]]),
      );

      const traces = await makeService().getTracesWithSpans({
        projectId: PROJECT_ID,
        traceIds: ["trace-1"],
        protections,
        opts: { full: true, withEditOverlay: true },
      });

      expect(traces[0]?.output?.value).toBe("the reviewer's correction");
    });
  });
});
