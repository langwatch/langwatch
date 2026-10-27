/**
 * @see modules/evaluation/specs/trace-collector-evaluation.feature
 */
import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { CollectorEvaluationReceivedEventData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createTraceCollectorEvaluationReport,
  traceCollectorEvaluationSchema,
} from "../trace-collector-evaluation.subscriber.ts";

const RECEIVED: CollectorEvaluationReceivedEventData = {
  tenantId: "project-1",
  evaluationId: "eval-1",
  evaluatorId: "customeval_tone",
  evaluatorType: "custom",
  evaluatorName: "Tone",
  traceId: "trace-1",
  isGuardrail: false,
  status: "processed",
  score: 0.9,
  passed: true,
  label: "calm",
  details: null,
  error: null,
  occurredAt: 1_758_189_600_000,
};

describe("given trace recorded an evaluation a collector body carried", () => {
  describe("when evaluation hears the fact", () => {
    /** @scenario "Evaluation reports each evaluation trace received from a collector body" */
    it("reports that evaluation on its own reportEvaluation command", async () => {
      const reportEvaluation = vi.fn(async (_data: ReportEvaluationCommandData) => undefined);
      const report = createTraceCollectorEvaluationReport({ reportEvaluation });

      await report(traceCollectorEvaluationSchema.parse(RECEIVED));

      expect(reportEvaluation).toHaveBeenCalledWith(RECEIVED);
    });
  });
});
