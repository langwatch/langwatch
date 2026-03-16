/**
 * @vitest-environment node
 *
 * Integration tests for ExportService.
 * Mocks TraceService (external boundary) and verifies the async generator
 * yields correct chunks with progress.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Protections } from "~/server/elasticsearch/protections";
import type { TraceService } from "~/server/traces/trace.service";
import type { Trace, LLMSpan, Evaluation } from "~/server/tracer/types";
import type { TracesForProjectResult } from "~/server/traces/types";
import { ExportService } from "../export.service";
import type { ExportRequest } from "../types";

const fullProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function buildTrace(overrides?: Partial<Trace>): Trace {
  return {
    trace_id: "trace-1",
    project_id: "proj-1",
    metadata: {
      labels: ["prod"],
      topic_id: "topic-1",
      subtopic_id: "sub-1",
    },
    timestamps: {
      started_at: 1700000000000,
      inserted_at: 1700000001000,
      updated_at: 1700000002000,
    },
    input: { value: "hello" },
    output: { value: "world" },
    metrics: {
      first_token_ms: 50,
      total_time_ms: 200,
      prompt_tokens: 5,
      completion_tokens: 10,
      total_cost: 0.0005,
    },
    spans: [],
    evaluations: [],
    ...overrides,
  };
}

function buildLLMSpan(overrides?: Partial<LLMSpan>): LLMSpan {
  return {
    span_id: "span-1",
    trace_id: "trace-1",
    type: "llm",
    name: "LLM",
    model: "gpt-4o",
    vendor: "openai",
    input: { type: "text", value: "input" },
    output: { type: "text", value: "output" },
    timestamps: { started_at: 1700000000000, finished_at: 1700000001000 },
    metrics: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
    ...overrides,
  };
}

function buildExportRequest(overrides?: Partial<ExportRequest>): ExportRequest {
  return {
    projectId: "proj-1",
    mode: "summary",
    format: "csv",
    filters: {},
    startDate: 1700000000000,
    endDate: 1700000100000,
    ...overrides,
  };
}

function buildMockTraceService(options: {
  batches: Trace[][];
  totalHits: number;
  evaluations?: Record<string, Evaluation[]>;
}): TraceService {
  let callIndex = 0;
  return {
    getAllTracesForProject: vi.fn().mockImplementation(() => {
      const batch = options.batches[callIndex] ?? [];
      const result: TracesForProjectResult = {
        groups: batch.map((t) => [t as any]),
        totalHits: options.totalHits,
        traceChecks: options.evaluations ?? {},
        scrollId: callIndex < options.batches.length - 1 ? `scroll-${callIndex + 1}` : undefined,
      };
      callIndex++;
      return Promise.resolve(result);
    }),
    getEvaluationsMultiple: vi.fn().mockResolvedValue(options.evaluations ?? {}),
  } as unknown as TraceService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExportService", () => {
  describe("exportTraces()", () => {
    describe("when exporting summary CSV with a single batch", () => {
      it("yields one chunk with header and data rows", async () => {
        const traces = [
          buildTrace({ trace_id: "t1" }),
          buildTrace({ trace_id: "t2" }),
        ];
        const traceService = buildMockTraceService({
          batches: [traces],
          totalHits: 2,
        });
        const service = new ExportService({ traceService });

        const chunks: Array<{ chunk: string; progress: { exported: number; total: number } }> = [];
        for await (const item of service.exportTraces({ request: buildExportRequest(), protections: fullProtections })) {
          chunks.push(item);
        }

        expect(chunks).toHaveLength(1);
        expect(chunks[0]!.progress).toEqual({ exported: 2, total: 2 });
        // CSV should contain header row + 2 data rows
        const lines = chunks[0]!.chunk.trim().split("\n");
        expect(lines.length).toBeGreaterThanOrEqual(3);
        expect(lines[0]).toContain("trace_id");
      });
    });

    describe("when exporting summary CSV across multiple batches", () => {
      it("yields multiple chunks with progressive progress", async () => {
        const batch1 = Array.from({ length: 3 }, (_, i) =>
          buildTrace({ trace_id: `t${i}` }),
        );
        const batch2 = Array.from({ length: 2 }, (_, i) =>
          buildTrace({ trace_id: `t${i + 3}` }),
        );
        const traceService = buildMockTraceService({
          batches: [batch1, batch2],
          totalHits: 5,
        });
        const service = new ExportService({ traceService });

        const chunks: Array<{ chunk: string; progress: { exported: number; total: number } }> = [];
        for await (const item of service.exportTraces({ request: buildExportRequest(), protections: fullProtections })) {
          chunks.push(item);
        }

        expect(chunks).toHaveLength(2);
        expect(chunks[0]!.progress).toEqual({ exported: 3, total: 5 });
        expect(chunks[1]!.progress).toEqual({ exported: 5, total: 5 });

        // First chunk has header, second does not
        expect(chunks[0]!.chunk).toContain("trace_id");
        // Second chunk should only be data rows
        const secondLines = chunks[1]!.chunk.trim().split("\n");
        expect(secondLines[0]).not.toContain("trace_id");
      });
    });

    describe("when exporting full CSV", () => {
      it("includes span-level rows in the output", async () => {
        const traces = [
          buildTrace({
            trace_id: "t1",
            spans: [buildLLMSpan({ span_id: "s1" }), buildLLMSpan({ span_id: "s2" })],
          }),
        ];
        const traceService = buildMockTraceService({
          batches: [traces],
          totalHits: 1,
        });
        const service = new ExportService({ traceService });

        const chunks: Array<{ chunk: string; progress: { exported: number; total: number } }> = [];
        for await (const item of service.exportTraces({
          request: buildExportRequest({ mode: "full" }),
          protections: fullProtections,
        })) {
          chunks.push(item);
        }

        expect(chunks).toHaveLength(1);
        // Header + 2 span rows
        const lines = chunks[0]!.chunk.trim().split("\n");
        expect(lines.length).toBeGreaterThanOrEqual(3);
        expect(lines[0]).toContain("span_id");
      });
    });

    describe("when exporting summary JSON", () => {
      it("yields JSONL lines with no spans", async () => {
        const traces = [
          buildTrace({ trace_id: "t1", spans: [buildLLMSpan()] }),
          buildTrace({ trace_id: "t2" }),
        ];
        const traceService = buildMockTraceService({
          batches: [traces],
          totalHits: 2,
        });
        const service = new ExportService({ traceService });

        const chunks: Array<{ chunk: string; progress: { exported: number; total: number } }> = [];
        for await (const item of service.exportTraces({
          request: buildExportRequest({ format: "json" }),
          protections: fullProtections,
        })) {
          chunks.push(item);
        }

        expect(chunks).toHaveLength(1);
        const lines = chunks[0]!.chunk.trim().split("\n");
        expect(lines).toHaveLength(2);

        const parsed1 = JSON.parse(lines[0]!);
        expect(parsed1.trace_id).toBe("t1");
        expect(parsed1.spans).toBeUndefined();

        const parsed2 = JSON.parse(lines[1]!);
        expect(parsed2.trace_id).toBe("t2");
      });
    });

    describe("when exporting full JSON", () => {
      it("yields JSONL lines with spans and evaluations", async () => {
        const traces = [
          buildTrace({
            trace_id: "t1",
            spans: [buildLLMSpan()],
            evaluations: [
              {
                evaluation_id: "e1",
                evaluator_id: "ev1",
                name: "Check",
                status: "processed",
                passed: true,
                score: 1,
                timestamps: { inserted_at: Date.now() },
              },
            ],
          }),
        ];
        const traceService = buildMockTraceService({
          batches: [traces],
          totalHits: 1,
        });
        const service = new ExportService({ traceService });

        const chunks: Array<{ chunk: string; progress: { exported: number; total: number } }> = [];
        for await (const item of service.exportTraces({
          request: buildExportRequest({ mode: "full", format: "json" }),
          protections: fullProtections,
        })) {
          chunks.push(item);
        }

        const parsed = JSON.parse(chunks[0]!.chunk.trim());
        expect(parsed.spans).toHaveLength(1);
        expect(parsed.evaluations).toHaveLength(1);
      });
    });

    describe("when no traces match the filter", () => {
      it("yields no chunks", async () => {
        const traceService = buildMockTraceService({
          batches: [[]],
          totalHits: 0,
        });
        const service = new ExportService({ traceService });

        const chunks: Array<{ chunk: string; progress: { exported: number; total: number } }> = [];
        for await (const item of service.exportTraces({ request: buildExportRequest(), protections: fullProtections })) {
          chunks.push(item);
        }

        expect(chunks).toHaveLength(0);
      });
    });

    describe("when requesting full mode", () => {
      it("passes includeSpans: true to the trace service", async () => {
        const traceService = buildMockTraceService({
          batches: [[]],
          totalHits: 0,
        });
        const service = new ExportService({ traceService });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of service.exportTraces({
          request: buildExportRequest({ mode: "full" }),
          protections: fullProtections,
        })) {
          // consume
        }

        expect(traceService.getAllTracesForProject).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ includeSpans: true }),
        );
      });
    });

    describe("when requesting summary mode", () => {
      it("passes downloadMode: true to the trace service", async () => {
        const traceService = buildMockTraceService({
          batches: [[]],
          totalHits: 0,
        });
        const service = new ExportService({ traceService });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of service.exportTraces({ request: buildExportRequest(), protections: fullProtections })) {
          // consume
        }

        expect(traceService.getAllTracesForProject).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ downloadMode: true }),
        );
      });
    });
  });
});
