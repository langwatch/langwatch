import { createApiFixture } from "@langwatch/api-fixture";
import type { Trace, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  EVALUATION_THREAD_DIGEST_MAX_TOKENS,
  EvaluationSpanDigestService,
} from "../evaluation-span-digest.service.ts";

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
    it("renders one transcript of the thread in time order, under the thread digest budget", async () => {
      const calls: Parameters<TraceApi["renderThreadTranscript"]>[0][] = [];
      const service = EvaluationSpanDigestService.create(
        createApiFixture<Pick<TraceApi, "formatSpansDigest" | "renderThreadTranscript">>({
          renderThreadTranscript: async (input) => {
            calls.push(input);
            return "transcript";
          },
        }),
      );

      const value = await service.formatThread({
        threadKey: "thread-1",
        traces: [trace({ id: "late", startedAt: 2_000 }), trace({ id: "early", startedAt: 1_000 })],
      });

      expect(value).toBe("transcript");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.threadKey).toBe("thread-1");
      expect(calls[0]!.traces.map((t) => t.trace_id)).toEqual(["early", "late"]);
      expect(calls[0]!.maxTokens).toBe(EVALUATION_THREAD_DIGEST_MAX_TOKENS);
      expect(EVALUATION_THREAD_DIGEST_MAX_TOKENS).toBeLessThan(128_000 / 1.5);
    });
  });
});
