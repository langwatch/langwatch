/**
 * @see modules/trace/specs/trace-collector-evaluations.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import { RecordCollectorEvaluationCommand } from "../../eventing/trace-collector-evaluations.commands.ts";
import type { RecordCollectorEvaluationCommandData } from "../../eventing/trace-collector-evaluations.events.ts";
import { TraceCollectorEvaluationsService } from "../trace-collector-evaluations.service.ts";

const EVALUATION: RecordCollectorEvaluationCommandData = {
  tenantId: "project-1",
  evaluationId: "eval-1",
  evaluatorId: "customeval_tone",
  evaluatorType: "custom",
  evaluatorName: "Tone",
  traceId: "trace-1",
  status: "processed",
  score: 0.9,
  passed: true,
  label: null,
  details: null,
  error: null,
  occurredAt: 1_758_189_600_000,
};

function connected() {
  const send = vi.fn(async (_data: RecordCollectorEvaluationCommandData) => undefined);
  const service = TraceCollectorEvaluationsService.create({ role: "api" });
  service.connect({ recordCollectorEvaluation: { send } });
  return { service, send };
}

describe("given a collector body carrying one evaluation for a trace", () => {
  describe("when trace reports the evaluation", () => {
    /** @scenario "A collector evaluation is recorded as trace's evaluations-received fact" */
    it("sends one record command carrying the evaluation", async () => {
      const { service, send } = connected();

      await service.record(EVALUATION);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(EVALUATION);
    });
  });
});

describe("given a collector evaluation whose status is not processed, error or skipped", () => {
  describe("when trace reports the evaluation", () => {
    /** @scenario "A collector evaluation with an unknown status is refused before it is recorded" */
    it("refuses it and records nothing", async () => {
      const { service, send } = connected();

      await expect(service.record({ ...EVALUATION, status: "pending" })).rejects.toThrow(/status/);
      expect(send).not.toHaveBeenCalled();
    });
  });
});

describe("given the record command", () => {
  describe("when it is handled", () => {
    /** @scenario "The fact lands on the trace's aggregate, once per evaluation and request" */
    it("emits one evaluations-received event keyed by trace, evaluation and request instant", () => {
      const events = new RecordCollectorEvaluationCommand().handle({
        tenantId: createTenantId(EVALUATION.tenantId),
        aggregateId: EVALUATION.traceId,
        type: RecordCollectorEvaluationCommand.schema.type,
        data: EVALUATION,
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        aggregateId: "trace-1",
        type: "lw.trace.collector_evaluation_received",
        data: EVALUATION,
        idempotencyKey: "trace-1:eval-1:collector_evaluation:1758189600000",
      });
    });
  });
});

describe("given trace in a process that bound no trace_collector_evaluations commands", () => {
  describe("when trace reports a collector evaluation", () => {
    /** @scenario "Collector evaluations refuse by name where no pipeline is bound" */
    it("refuses naming the trace_collector_evaluations commands", async () => {
      const service = TraceCollectorEvaluationsService.create({ role: "api" });

      await expect(service.record(EVALUATION)).rejects.toMatchObject({
        code: "service_unavailable",
      });
    });
  });
});
