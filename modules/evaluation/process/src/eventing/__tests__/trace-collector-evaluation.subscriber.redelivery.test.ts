import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
/**
 * @vitest-environment node
 * @unit
 * The fact carries the evaluation id the collector derived, so a redelivery reports the same one.
 */
import type { CollectorEvaluationReceivedEventData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { createTraceCollectorEvaluationReport } from "../trace-collector-evaluation.subscriber.ts";

const RECEIVED: CollectorEvaluationReceivedEventData = {
  tenantId: "project-1",
  evaluationId: "eval_md5_abc",
  evaluatorId: "customeval_toxicity",
  evaluatorType: "custom",
  evaluatorName: "toxicity",
  traceId: "trace-1",
  status: "processed",
  score: 0.1,
  passed: true,
  label: null,
  details: null,
  error: null,
  occurredAt: 1_758_189_600_000,
};

describe("given trace's evaluations-received fact for one evaluation", () => {
  describe("when the same fact is delivered twice", () => {
    it("reports one evaluation identity with the byte-identical command both times", async () => {
      const reported: ReportEvaluationCommandData[] = [];
      const report = createTraceCollectorEvaluationReport({
        reportEvaluation: async (data) => {
          reported.push(data);
        },
      });

      await report(RECEIVED);
      await report(RECEIVED);

      expect(new Set(reported.map((data) => `${data.tenantId}:${data.evaluationId}`)).size).toBe(1);
      expect(reported[1]).toEqual(reported[0]);
    });
  });
});
