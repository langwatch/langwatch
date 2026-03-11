import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { ReportEvaluationCommandData } from "../../schemas/commands";
import { EVALUATION_REPORTED_EVENT_TYPE } from "../../schemas/constants";
import { ReportEvaluationCommand } from "../reportEvaluation.command";

function makeCommand(
  overrides: Partial<ReportEvaluationCommandData> = {},
): Command<ReportEvaluationCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "eval-1",
    type: "lw.evaluation.report",
    data: {
      tenantId: "tenant-1",
      evaluationId: "eval-1",
      evaluatorId: "evaluator-1",
      evaluatorType: "custom",
      evaluatorName: "toxicity",
      traceId: "trace-1",
      isGuardrail: false,
      status: "processed",
      score: 0.9,
      passed: true,
      label: null,
      details: null,
      error: null,
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<ReportEvaluationCommandData>;
}

describe("ReportEvaluationCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single EvaluationReportedEvent", async () => {
        const handler = new ReportEvaluationCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(EVALUATION_REPORTED_EVENT_TYPE);
      });

      it("sets all evaluation data in the single event", async () => {
        const handler = new ReportEvaluationCommand();
        const events = await handler.handle(makeCommand());

        const event = events[0]!;
        expect(event.data).toMatchObject({
          evaluationId: "eval-1",
          evaluatorId: "evaluator-1",
          evaluatorType: "custom",
          evaluatorName: "toxicity",
          traceId: "trace-1",
          isGuardrail: false,
          status: "processed",
          score: 0.9,
          passed: true,
          label: null,
          details: null,
          error: null,
        });
      });

      it("uses the command occurredAt for the event", async () => {
        const handler = new ReportEvaluationCommand();
        const occurredAt = 1700000000000;
        const events = await handler.handle(makeCommand({ occurredAt }));

        expect(events[0]!.occurredAt).toBe(occurredAt);
      });

      it("sets the correct aggregateId", async () => {
        const handler = new ReportEvaluationCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.aggregateId).toBe("eval-1");
      });
    });

    describe("when optional fields are undefined", () => {
      it("defaults score, passed, label, details, error to null", async () => {
        const handler = new ReportEvaluationCommand();
        const events = await handler.handle(
          makeCommand({
            score: undefined,
            passed: undefined,
            label: undefined,
            details: undefined,
            error: undefined,
          }),
        );

        const event = events[0]!;
        expect(event.data).toMatchObject({
          score: null,
          passed: null,
          label: null,
          details: null,
          error: null,
        });
      });
    });
  });

  describe("getAggregateId()", () => {
    it("returns the evaluationId", () => {
      const payload = makeCommand().data;
      expect(ReportEvaluationCommand.getAggregateId(payload)).toBe("eval-1");
    });
  });

  describe("makeJobId()", () => {
    it("returns a job ID with report suffix", () => {
      const payload = makeCommand().data;
      expect(ReportEvaluationCommand.makeJobId(payload)).toBe(
        "tenant-1:eval-1:report",
      );
    });
  });
});
