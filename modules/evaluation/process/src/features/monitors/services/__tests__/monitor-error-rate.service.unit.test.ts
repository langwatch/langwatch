/**
 * @vitest-environment node
 * @see modules/evaluation/specs/monitor-error-rate.feature
 */
import type { EvaluationExecutionResult } from "@langwatch/evaluation-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  buildExecuteCommand,
  buildExecutionDeps,
  buildMonitor,
} from "../../../../__tests__/support/evaluation-execution.fixtures.ts";
import type {
  RecordEvaluationLifecycleCompletedCommandData,
  RecordEvaluationRanCommandData,
  RecordMonitorErrorRateExceededCommandData,
} from "../../../../eventing/evaluation-lifecycle.events.ts";
import { MemoryMonitorErrorRateRepository } from "../../../../repositories/memory/memory.monitor-error-rate.repository.ts";
import { EvaluationLifecycleService } from "../../../../services/evaluation-lifecycle.service.ts";
import { EvaluationExecutionIntentService } from "../../../execution/services/evaluation-execution-intent.service.ts";
import { MonitorErrorRateService } from "../monitor-error-rate.service.ts";

const REVISION = new Date("2026-10-25T10:00:00.000Z");

const ERROR: EvaluationExecutionResult = {
  status: "error",
  error: "Evaluator timed out",
  details: "Evaluator timed out",
};
const PROCESSED: EvaluationExecutionResult = { status: "processed", score: 1, passed: true };
const FAILED_VERDICT: EvaluationExecutionResult = { status: "processed", score: 0, passed: false };
const SKIPPED: EvaluationExecutionResult = { status: "skipped", details: "no input" };

function recorder<Payload>(sent: Payload[]): EventingCommandSender<Payload> {
  return {
    send: async (payload) => {
      sent.push(payload);
    },
    sendBatch: async (payloads) => {
      sent.push(...payloads);
    },
    close: async () => {},
    waitUntilReady: async () => {},
  };
}

/** The real execution path, over a memory counter and a lifecycle that records what it sends. */
function harness({
  executionMode = "ON_MESSAGE",
  counts = MemoryMonitorErrorRateRepository.create(),
}: {
  executionMode?: "ON_MESSAGE" | "AS_GUARDRAIL" | "MANUALLY";
  counts?: MemoryMonitorErrorRateRepository;
} = {}) {
  const reported: RecordMonitorErrorRateExceededCommandData[] = [];
  const lifecycle = EvaluationLifecycleService.create();
  lifecycle.connect({
    recordEvaluationRan: recorder<RecordEvaluationRanCommandData>([]),
    recordEvaluationLifecycleCompleted: recorder<RecordEvaluationLifecycleCompletedCommandData>([]),
    recordMonitorErrorRateExceeded: recorder(reported),
  });
  const deps = buildExecutionDeps({
    monitor: buildMonitor({ executionMode, updatedAt: REVISION }),
  });
  const intent = EvaluationExecutionIntentService.create({
    ...deps,
    monitorErrorRates: MonitorErrorRateService.create({ counts, lifecycle }),
  });
  let sequence = 0;

  async function settle(
    result: EvaluationExecutionResult,
    times: number,
    overrides: { isGuardrail?: boolean } = {},
  ) {
    deps.evaluations.executeForTrace.mockResolvedValue(result);
    const events = [];
    for (let index = 0; index < times; index++) {
      sequence++;
      events.push(
        ...(await intent.handle(
          buildExecuteCommand({ evaluationId: `evaluation-${sequence}`, ...overrides }),
        )),
      );
    }
    return events;
  }

  return { settle, reported };
}

describe("MonitorErrorRateService", () => {
  describe("when 45 of an on-message monitor's 50 runs in the hour errored", () => {
    /** @scenario "A monitor whose runs are mostly errors is reported once it reaches the threshold" */
    it("records the fact on the 45th error, with the counts and the most common error", async () => {
      const { settle, reported } = harness();

      await settle(PROCESSED, 5);
      await settle(ERROR, 44);
      expect(reported).toEqual([]);

      await settle(ERROR, 1);

      expect(reported).toEqual([
        expect.objectContaining({
          tenantId: "project-evaluation-test",
          projectId: "project-evaluation-test",
          monitorId: "monitor-test",
          monitorRevision: REVISION.getTime(),
          windowMs: 60 * 60 * 1000,
          runs: 50,
          errors: 45,
          topError: "Evaluator timed out",
        }),
      ]);
    });
  });

  describe("when 49 runs all errored", () => {
    /** @scenario "A monitor below the minimum volume is not reported" */
    it("records nothing", async () => {
      const { settle, reported } = harness();

      await settle(ERROR, 49);

      expect(reported).toEqual([]);
    });
  });

  describe("when every run returned a failed verdict or was skipped", () => {
    /** @scenario "Failed verdicts and skipped runs are not errors" */
    it("records nothing", async () => {
      const { settle, reported } = harness();

      await settle(FAILED_VERDICT, 100);
      await settle(SKIPPED, 100);

      expect(reported).toEqual([]);
    });
  });

  describe("when 89 of 100 runs errored", () => {
    /** @scenario "A monitor under the error ratio is not reported" */
    it("records nothing", async () => {
      const { settle, reported } = harness();

      await settle(PROCESSED, 11);
      await settle(ERROR, 89);

      expect(reported).toEqual([]);
    });
  });

  describe("when the revision was already reported", () => {
    /** @scenario "The fact is recorded once per monitor revision, not per evaluation" */
    it("records no further fact for 100 more errors", async () => {
      const { settle, reported } = harness();

      await settle(ERROR, 50);
      await settle(ERROR, 100);

      expect(reported).toHaveLength(1);
    });
  });

  describe("when the runs are a guardrail's or a manual monitor's", () => {
    /** @scenario "Guardrails and manual monitors are never counted" */
    it("records nothing for a guardrail run of an on-message monitor", async () => {
      const { settle, reported } = harness();

      await settle(ERROR, 100, { isGuardrail: true });

      expect(reported).toEqual([]);
    });

    /** @scenario "Guardrails and manual monitors are never counted" */
    it("records nothing for a manual monitor", async () => {
      const { settle, reported } = harness({ executionMode: "MANUALLY" });

      await settle(ERROR, 100);

      expect(reported).toEqual([]);
    });
  });

  describe("when the counter store refuses every write", () => {
    /** @scenario "Counting never fails the evaluation" */
    it("still emits the evaluation's reported event", async () => {
      const { settle, reported } = harness({
        counts: MemoryMonitorErrorRateRepository.create({ refuse: true }),
      });

      const events = await settle(ERROR, 1);

      expect(events).toEqual([
        expect.objectContaining({
          type: "lw.evaluation.reported",
          data: expect.objectContaining({ status: "error", error: "Evaluator timed out" }),
        }),
      ]);
      expect(reported).toEqual([]);
    });
  });
});
