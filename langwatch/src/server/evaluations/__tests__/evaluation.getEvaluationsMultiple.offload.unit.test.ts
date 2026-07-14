/**
 * @vitest-environment node
 *
 * Unit tests for how EvaluationService.getEvaluationsMultiple surfaces
 * offloaded-inputs markers (ADR-040) on read paths: list/multi-trace callers
 * get a compact, leak-free projection; single-trace REST callers opt into full
 * resolution. The raw `__lw_stored_object` envelope must never leave the
 * service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClickHouseClientForProjectMock = vi.hoisted(() => vi.fn());

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: getClickHouseClientForProjectMock,
}));

import {
  OFFLOADED_INPUTS_PROJECTION_KEY,
  STORED_OBJECT_MARKER_KEY,
} from "~/server/app-layer/evaluations/evaluation-inputs-offload";
import { EvaluationService } from "../evaluation.service";

/** A marker as it lands in evaluation_runs.Inputs when inputs were offloaded. */
const OFFLOAD_MARKER = {
  [STORED_OBJECT_MARKER_KEY]: {
    id: "so-secret-id",
    sizeBytes: 2_000_000,
    sha256: "a".repeat(64),
    preview: '{"question":"hi"',
    truncatedPreview: true,
  },
};

/** One evaluation_runs row whose Inputs column holds the offload marker. */
function offloadedRow() {
  return {
    ProjectionId: "p1",
    TenantId: "project_test",
    EvaluationId: "eval-1",
    Version: "1",
    EvaluatorId: "evaluator-1",
    EvaluatorType: "custom",
    EvaluatorName: "My Eval",
    TraceId: "trace-1",
    IsGuardrail: 0,
    Status: "processed",
    Score: 1,
    Passed: 1,
    Label: null,
    Details: null,
    Error: null,
    Inputs: JSON.stringify(OFFLOAD_MARKER),
    ScheduledAt: null,
    StartedAt: null,
    CompletedAt: null,
    LastProcessedEventId: "evt-1",
    UpdatedAt: "2025-01-01 00:00:00.000",
  };
}

function mockClickHouseReturning(rows: unknown[]) {
  const query = vi.fn(async () => ({ json: async () => rows }));
  getClickHouseClientForProjectMock.mockResolvedValue({ query });
  return query;
}

describe("EvaluationService.getEvaluationsMultiple", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a row whose inputs were offloaded", () => {
    describe("when read on a list path (shouldResolveOffloadedInputs omitted)", () => {
      it("projects to a compact shape and never leaks the raw marker or storage id/sha256", async () => {
        mockClickHouseReturning([offloadedRow()]);
        // The seam must NOT be called on the list path - projection is I/O-free.
        const resolveSeam = vi.fn(async () => ({ full: "inputs" }));
        const service = new EvaluationService(resolveSeam);

        const result = await service.getEvaluationsMultiple({
          projectId: "project_test",
          traceIds: ["trace-1"],
        });

        const inputs = result["trace-1"]![0]!.inputs as Record<string, any>;
        expect(inputs[OFFLOADED_INPUTS_PROJECTION_KEY]).toEqual({
          preview: '{"question":"hi"',
          truncated: true,
          sizeBytes: 2_000_000,
        });

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(STORED_OBJECT_MARKER_KEY);
        expect(serialized).not.toContain("so-secret-id");
        expect(serialized).not.toContain("a".repeat(64));
        expect(resolveSeam).not.toHaveBeenCalled();
      });
    });

    describe("when resolution fail-safes back to the marker on a single-trace path", () => {
      it("degrades to the compact projection instead of shipping the raw marker", async () => {
        mockClickHouseReturning([offloadedRow()]);
        // The resolver's fail-safe contract returns its input marker on every
        // degraded path (missing object, purpose/hash mismatch, stream/parse
        // error). The service boundary must convert that to the projection -
        // never serialize the internal id/sha256 out of a failure.
        const resolveSeam = vi.fn(async ({ inputs }) => inputs);
        const service = new EvaluationService(resolveSeam);

        const result = await service.getEvaluationsMultiple({
          projectId: "project_test",
          traceIds: ["trace-1"],
          shouldResolveOffloadedInputs: true,
        });

        const inputs = result["trace-1"]![0]!.inputs as Record<string, any>;
        expect(inputs[OFFLOADED_INPUTS_PROJECTION_KEY]).toEqual({
          preview: '{"question":"hi"',
          truncated: true,
          sizeBytes: 2_000_000,
        });

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(STORED_OBJECT_MARKER_KEY);
        expect(serialized).not.toContain("so-secret-id");
        expect(serialized).not.toContain("a".repeat(64));
      });
    });

    describe("when read on a single-trace path (shouldResolveOffloadedInputs true)", () => {
      it("resolves the marker to the full inputs via the injected seam", async () => {
        mockClickHouseReturning([offloadedRow()]);
        const fullInputs = { question: "hi", context: ["chunk-a", "chunk-b"] };
        const resolveSeam = vi.fn(async () => fullInputs);
        const service = new EvaluationService(resolveSeam);

        const result = await service.getEvaluationsMultiple({
          projectId: "project_test",
          traceIds: ["trace-1"],
          shouldResolveOffloadedInputs: true,
        });

        expect(result["trace-1"]![0]!.inputs).toEqual(fullInputs);
        expect(resolveSeam).toHaveBeenCalledWith({
          projectId: "project_test",
          inputs: OFFLOAD_MARKER,
        });
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(STORED_OBJECT_MARKER_KEY);
      });
    });
  });

  describe("given a row with plain inline inputs", () => {
    it("passes them through untouched on the list path", async () => {
      const row = offloadedRow();
      row.Inputs = JSON.stringify({ question: "plain", answer: "inline" });
      mockClickHouseReturning([row]);
      const resolveSeam = vi.fn();
      const service = new EvaluationService(resolveSeam);

      const result = await service.getEvaluationsMultiple({
        projectId: "project_test",
        traceIds: ["trace-1"],
      });

      expect(result["trace-1"]![0]!.inputs).toEqual({
        question: "plain",
        answer: "inline",
      });
      expect(resolveSeam).not.toHaveBeenCalled();
    });
  });
});
