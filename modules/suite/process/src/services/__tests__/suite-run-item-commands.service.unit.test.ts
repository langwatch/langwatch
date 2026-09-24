import type {
  CompleteSuiteRunItemCommandData,
  RecordSuiteRunItemStartedCommandData,
  RegradeSuiteRunItemCommandData,
} from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { SuiteRunItemCommandsService } from "../suite-run-item-commands.service.ts";

function recordingSenders() {
  const started: RecordSuiteRunItemStartedCommandData[] = [];
  const completed: CompleteSuiteRunItemCommandData[] = [];
  const regraded: RegradeSuiteRunItemCommandData[] = [];
  return {
    started,
    completed,
    regraded,
    senders: {
      recordSuiteRunItemStarted: {
        send: async (payload: RecordSuiteRunItemStartedCommandData) => {
          started.push(payload);
        },
      },
      completeSuiteRunItem: {
        send: async (payload: CompleteSuiteRunItemCommandData) => {
          completed.push(payload);
        },
      },
      regradeSuiteRunItem: {
        send: async (payload: RegradeSuiteRunItemCommandData) => {
          regraded.push(payload);
        },
      },
    },
  };
}

const itemStarted: RecordSuiteRunItemStartedCommandData = {
  tenantId: "project-1",
  batchRunId: "batch-1",
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  occurredAt: 1_790_000_000_000,
};

const itemCompleted: CompleteSuiteRunItemCommandData = {
  ...itemStarted,
  status: "SUCCESS",
  verdict: "success",
  durationMs: 1200,
};

describe("SuiteRunItemCommandsService", () => {
  describe("given the pipeline connected its senders", () => {
    describe("when a scenario run starts", () => {
      it("sends recordSuiteRunItemStarted with the item as given", async () => {
        const recording = recordingSenders();
        const service = SuiteRunItemCommandsService.create();
        service.connect(recording.senders);

        await service.recordSuiteRunItemStarted(itemStarted);

        expect(recording.started).toEqual([itemStarted]);
        expect(recording.completed).toEqual([]);
      });
    });

    describe("when a scenario run completes", () => {
      it("sends completeSuiteRunItem with its verdict", async () => {
        const recording = recordingSenders();
        const service = SuiteRunItemCommandsService.create();
        service.connect(recording.senders);

        await service.completeSuiteRunItem(itemCompleted);

        expect(recording.completed).toEqual([itemCompleted]);
        expect(recording.started).toEqual([]);
      });
    });

    describe("when a finished run's verdict changes after the fact", () => {
      /** @scenario "A regraded scenario run moves its suite run item once" */
      it("sends regradeSuiteRunItem naming the change", async () => {
        const recording = recordingSenders();
        const service = SuiteRunItemCommandsService.create();
        service.connect(recording.senders);
        const itemRegraded: RegradeSuiteRunItemCommandData = {
          ...itemStarted,
          previousStatus: "SUCCESS",
          previousVerdict: "success",
          status: "FAILED",
          verdict: "failure",
          idempotencyKey: "event-evaluated-1",
        };

        await service.regradeSuiteRunItem(itemRegraded);

        expect(recording.regraded).toEqual([itemRegraded]);
        expect(recording.completed).toEqual([]);
      });
    });
  });

  describe("given the pipeline has not registered", () => {
    it("refuses to send rather than dropping the item", async () => {
      const service = SuiteRunItemCommandsService.create();

      await expect(service.recordSuiteRunItemStarted(itemStarted)).rejects.toThrow(
        "Suite run-item commands were sent before suite_run_processing registered",
      );
    });
  });
});
