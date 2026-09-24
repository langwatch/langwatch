import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AutomationApi } from "@langwatch/automation-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EvaluationApi, type ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { EventingCommands, EventingCommandSender } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { memoryStores } from "@langwatch/process-stores";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { EvaluationCommandDispatcherService } from "../../services/evaluation-command-dispatcher.service.ts";
import type { EvaluationProcessingPipeline } from "../../services/evaluation-processing.service.ts";
import { EVALUATION_TEST_CONFIG, installableEvaluation } from "./evaluation.fixture.ts";

const REPORT: ReportEvaluationCommandData = {
  tenantId: "project-1",
  evaluationId: "evaluation-1",
  evaluatorId: "evaluator-1",
  evaluatorType: "langevals/exact_match",
  status: "processed",
  score: 1,
  passed: true,
  occurredAt: 1,
};

async function installed() {
  return createApp({ role: "api" })
    .withModules([installableEvaluation])
    .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
    .withStores(memoryStores())
    .provide({
      workflow: createApiFixture<WorkflowApi>(),
      trace: createApiFixture<TraceApi>(),
      "model-provider": createApiFixture<ModelProviderApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      evaluator: createApiFixture<EvaluatorApi>(),
      monitor: createApiFixture<MonitorApi>(),
      automation: createApiFixture<AutomationApi>(),
      analytics: createApiFixture<AnalyticsApi>(),
      "data-retention": createApiFixture<DataRetentionApi>(),
    })
    .boot();
}

describe("given the evaluation_processing command dispatcher", () => {
  describe("when its senders are connected and an evaluation is reported", () => {
    /** @scenario "An evaluation report travels on the pipeline's own sender" */
    it("sends the report once through the reportEvaluation sender", async () => {
      const sent: ReportEvaluationCommandData[] = [];
      const commands = EvaluationCommandDispatcherService.create();
      commands.connect(
        createApiFixture<EventingCommands<EvaluationProcessingPipeline>>({
          reportEvaluation: createApiFixture<EventingCommandSender<ReportEvaluationCommandData>>({
            send: async (payload) => {
              sent.push(payload);
            },
          }),
        }),
      );

      await commands.reportEvaluation(REPORT);

      expect(sent).toEqual([REPORT]);
    });
  });
});

describe("given an installed evaluation module", () => {
  describe("when its senders are not connected and an evaluation is reported", () => {
    /** @scenario "An evaluation report refuses by name before the pipeline is connected" */
    it("refuses naming the missing reportEvaluation sender", async () => {
      const runtime = await installed();

      try {
        await expect(runtime.service(EvaluationApi).reportEvaluation(REPORT)).rejects.toThrow(
          /reportEvaluation sender/,
        );
      } finally {
        await runtime.stop();
      }
    });
  });
});
