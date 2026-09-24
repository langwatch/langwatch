import { createApiFixture } from "@langwatch/api-fixture";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EvaluationApi, type ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { EventingCommands, EventingCommandSender } from "@langwatch/eventing";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { evaluationServer } from "../../evaluation.server.ts";
import { EvaluationCommandDispatcherService } from "../../services/evaluation-command-dispatcher.service.ts";
import type { EvaluationProcessingPipeline } from "../../services/evaluation-processing.service.ts";
import { EVALUATION_TEST_CONFIG } from "./evaluation.fixture.ts";

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
    .withModules([withMemoryRepositories(evaluationServer)])
    .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
    .provide({
      workflow: createApiFixture<WorkflowApi>(),
      trace: createApiFixture<TraceApi>(),
      "model-provider": createApiFixture<ModelProviderApi>(),
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
