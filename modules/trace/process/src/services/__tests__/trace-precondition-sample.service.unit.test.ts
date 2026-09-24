/** Main's `traces.getSampleTraces` selection: passing traces first, topped up below ten. */
import { createApiFixture } from "@langwatch/api-fixture";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { Trace, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TracePreconditionSampleService } from "../trace-precondition-sample.service.ts";

const query = { projectId: "project-1", startDate: 0, endDate: 1 };

function trace(traceId: string): Trace {
  return {
    trace_id: traceId,
    project_id: "project-1",
    metadata: {},
    timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
    spans: [],
  };
}

function sampleService(input: { traces: Trace[]; passingIds: string[] }) {
  const findTraceIdsPassingPreconditions = vi.fn(async () => input.passingIds);
  const service = TracePreconditionSampleService.create({
    traces: createApiFixture<TraceApi>({
      resolveViewerProtections: async () => ({ canSeeCosts: true, canSeeCapturedInput: true }),
      readSampleTraces: async () => input.traces,
    }),
    evaluators: createApiFixture<EvaluatorApi>({ findTraceIdsPassingPreconditions }),
    shuffle: (items) => [...items],
  });
  return { service, findTraceIdsPassingPreconditions };
}

function read(service: TracePreconditionSampleService, expectedResults: number) {
  return service.readSample({
    query,
    viewerUserId: "user-1",
    evaluatorType: "custom/check",
    preconditions: [],
    expectedResults,
  });
}

describe("TracePreconditionSampleService.readSample", () => {
  describe("given sampled traces of which some pass", () => {
    /** @scenario "Traces passing the preconditions come first" */
    it("puts the passing traces first, marked as passing", async () => {
      const { service } = sampleService({
        traces: ["a", "b", "c"].map(trace),
        passingIds: ["c"],
      });

      const sample = await read(service, 2);

      expect(sample.map((t) => [t.trace_id, t.passesPreconditions])).toEqual([
        ["c", true],
        ["a", false],
      ]);
    });
  });

  describe("given ten or more passing traces", () => {
    /** @scenario "Fewer than ten passing traces are topped up with ones that do not pass" */
    it("tops up only while fewer than ten pass", async () => {
      const ids = Array.from({ length: 14 }, (_, index) => `t${index}`);
      const few = sampleService({ traces: ids.map(trace), passingIds: ids.slice(0, 3) });
      const many = sampleService({ traces: ids.map(trace), passingIds: ids.slice(0, 10) });

      const topped = await read(few.service, 5);
      const untopped = await read(many.service, 12);

      expect(topped.filter((t) => t.passesPreconditions)).toHaveLength(3);
      expect(topped.filter((t) => !t.passesPreconditions)).toHaveLength(2);
      expect(untopped).toHaveLength(10);
      expect(untopped.every((t) => t.passesPreconditions)).toBe(true);
    });
  });

  describe("given no traces in range", () => {
    /** @scenario "No sampled traces answers an empty sample" */
    it("answers an empty sample without matching", async () => {
      const { service, findTraceIdsPassingPreconditions } = sampleService({
        traces: [],
        passingIds: [],
      });

      expect(await read(service, 5)).toEqual([]);
      expect(findTraceIdsPassingPreconditions).not.toHaveBeenCalled();
    });
  });
});
