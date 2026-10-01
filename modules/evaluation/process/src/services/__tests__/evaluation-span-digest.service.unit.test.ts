import { createApiFixture } from "@langwatch/api-fixture";
import type { Trace, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { EvaluationSpanDigestService } from "../evaluation-span-digest.service.ts";

type Renderers = Pick<TraceApi, "renderReadableTrace" | "renderThreadTranscript">;

const trace = ({ id, startedAt }: { id: string; startedAt: number }): Trace => ({
  trace_id: id,
  project_id: "project-1",
  metadata: { thread_id: "thread-1" },
  timestamps: { started_at: startedAt, inserted_at: startedAt, updated_at: startedAt },
  spans: [],
});

describe("EvaluationSpanDigestService.formatThread", () => {
  describe("given a thread whose traces arrive out of order", () => {
    /** @scenario "The formatted_traces source is the thread transcript under the judge's budget" */
    it("renders the steps view of the thread in time order, under the budget it is given", async () => {
      const calls: Parameters<TraceApi["renderThreadTranscript"]>[0][] = [];
      const service = EvaluationSpanDigestService.create(
        createApiFixture<Renderers>({
          renderThreadTranscript: async (input) => {
            calls.push(input);
            return "transcript";
          },
        }),
      );

      const value = await service.formatThread({
        threadKey: "thread-1",
        traces: [trace({ id: "late", startedAt: 2_000 }), trace({ id: "early", startedAt: 1_000 })],
        maxTokens: 12_345,
      });

      expect(value).toBe("transcript");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.threadKey).toBe("thread-1");
      expect(calls[0]!.traces.map((t) => t.trace_id)).toEqual(["early", "late"]);
      expect(calls[0]!.view).toBe("steps");
      expect(calls[0]!.maxTokens).toBe(12_345);
    });
  });
});

describe("EvaluationSpanDigestService.format", () => {
  describe("given one trace", () => {
    /** @scenario "A long trace is rendered to the judge's budget instead of sent whole" */
    it("renders the bounded readable digest under the budget it is given", async () => {
      const calls: Parameters<TraceApi["renderReadableTrace"]>[0][] = [];
      const service = EvaluationSpanDigestService.create(
        createApiFixture<Renderers>({
          renderReadableTrace: async (input) => {
            calls.push(input);
            return "digest";
          },
        }),
      );

      const value = await service.format({
        trace: trace({ id: "one", startedAt: 1 }),
        maxTokens: 9_000,
      });

      expect(value).toBe("digest");
      expect(calls.map((c) => [c.trace.trace_id, c.maxTokens])).toEqual([["one", 9_000]]);
    });
  });
});
