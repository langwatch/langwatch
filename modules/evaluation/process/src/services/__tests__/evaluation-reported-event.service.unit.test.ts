/**
 * @vitest-environment node
 * @see modules/evaluation/specs/monitor-evaluation-business-time.feature
 */
import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { EvaluationReportedEventService } from "../evaluation-reported-event.service.ts";

const RUN_TIME = 1_700_000_900_000;
const SPAN_END = 1_700_000_002_500;

function command(
  overrides: Partial<ExecuteEvaluationCommandData> = {},
): ExecuteEvaluationCommandData {
  return {
    tenantId: "tenant-1",
    traceId: "trace-1",
    evaluationId: "eval-1",
    evaluatorId: "monitor-1",
    evaluatorType: "langevals/exact_match",
    occurredAt: RUN_TIME,
    ...overrides,
  };
}

const service = EvaluationReportedEventService.create({ offload: async ({ inputs }) => inputs });

describe("EvaluationReportedEventService", () => {
  describe("given a monitor evaluation of a trace with a span end", () => {
    /** @scenario "A monitor evaluation is dated by the evaluated trace's last span end" */
    it("dates the reported event at the span end and keeps the processing time apart", async () => {
      const [event] = await service.emit(command({ spanEndedAt: SPAN_END }), {
        status: "processed",
        score: 1,
      });

      expect(event!.occurredAt).toBe(SPAN_END);
      expect(event!.createdAt).toBeGreaterThan(SPAN_END);
    });

    /** @scenario "A failed or skipped monitor evaluation keeps the span's business time" */
    it("dates an error result at the span end too", async () => {
      const [event] = await service.emit(command({ spanEndedAt: SPAN_END }), {
        status: "error",
        error: "boom",
      });

      expect(event!.occurredAt).toBe(SPAN_END);
    });
  });

  describe("given a command queued without a span end", () => {
    /** @scenario "A summary with no span time leaves the evaluation dated as before" */
    it("falls back to the command's run time", async () => {
      const [event] = await service.emit(command(), { status: "skipped", details: "n/a" });

      expect(event!.occurredAt).toBe(RUN_TIME);
    });
  });
});
