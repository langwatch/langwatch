import { AnalyticsApi } from "@langwatch/analytics-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import { EvaluationApi, type ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { EventingCommands, EventingCommandSender } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TraceApi } from "@langwatch/trace-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type { EvaluationProcessingPipeline } from "../../eventing/evaluation-processing-definition.pipeline.ts";
import { EvaluationCommandDispatcherService } from "../../services/evaluation-command-dispatcher.service.ts";
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
  return bootInstalledProcess({
    role: "api",
    modules: [installableEvaluation],
    config: { evaluation: EVALUATION_TEST_CONFIG },
    stores: memoryStores(),
    peers: [
      testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>() }),
      testPeer({ token: WorkflowApi, instance: createApiFixture<WorkflowApi>() }),
      testPeer({ token: TraceApi, instance: createApiFixture<TraceApi>() }),
      testPeer({ token: ModelProviderApi, instance: createApiFixture<ModelProviderApi>() }),
      testPeer({ token: FeatureFlagApi, instance: createApiFixture<FeatureFlagApi>() }),
      testPeer({ token: EvaluatorApi, instance: createApiFixture<EvaluatorApi>() }),
      testPeer({ token: MonitorApi, instance: createApiFixture<MonitorApi>() }),
      testPeer({ token: DatasetApi, instance: createApiFixture<DatasetApi>() }),
      testPeer({ token: InstantEvalJudgeApi, instance: createApiFixture<InstantEvalJudgeApi>() }),
      testPeer({ token: AnalyticsApi, instance: createApiFixture<AnalyticsApi>() }),
      testPeer({ token: ProjectApi, instance: createApiFixture<ProjectApi>() }),
      testPeer({ token: DataRetentionApi, instance: createApiFixture<DataRetentionApi>() }),
    ],
  });
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
