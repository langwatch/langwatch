import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { Evaluator, EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { NlpPayloadStaging } from "../../channels/nlp-lambda.channel.ts";
import type { WorkflowLineageRepository } from "../../repositories/workflow-lineage.repository.ts";
import type { WorkflowRepository } from "../../repositories/workflow.repository.ts";
import { WorkflowModule, type NlpLambdaArnCache } from "../workflow.app.ts";
import { createWorkflowTestInfrastructure } from "./workflow.fixture.ts";

const existingEvaluator: Evaluator = {
  id: "evaluator_1",
  projectId: "project_1",
  name: "previous name",
  slug: null,
  type: "workflow",
  config: {},
  workflowId: "workflow_archived",
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

async function appWith({
  lineage,
  evaluators,
}: {
  lineage: Partial<WorkflowLineageRepository>;
  evaluators: EvaluatorApi;
}): Promise<WorkflowModule> {
  const members = createWorkflowTestInfrastructure({ evaluators });

  return WorkflowModule.create({
    members: {
      ...members,
      prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
      nlpCodeBlockTimeoutSeconds: void 0,
      nlpInternalSecret: void 0,
      nlpServiceUrl: void 0,
      publicBaseUrl: void 0,
    },
    dependencies: {
      evaluators,
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      experiments: createApiFixture<ExperimentApi>({}, "ExperimentApi"),
      datasets: members.datasets,
      monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
      secrets: createApiFixture<SecretApi>({}, "SecretApi"),
    },
    config: {
      stagingThresholdBytes: void 0,
      stagingTtlSeconds: 600,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories: {
      workflowRows: members.workflowRows,
      workflows: createApiFixture<WorkflowRepository>({}, "WorkflowRepository"),
      lineage: createApiFixture<WorkflowLineageRepository>(lineage, "WorkflowLineageRepository"),
      nlpLambdaArns: createApiFixture<NlpLambdaArnCache>({}, "NlpLambdaArnCache"),
      payloadStaging: createApiFixture<NlpPayloadStaging>({}, "NlpPayloadStaging"),
    },
  });
}

describe("workflow evaluator publication", () => {
  /** @scenario "An archived workflow keeps its evaluator publication behaviour" */
  it("uses the publication row's name when the ordinary workflow row is archived", async () => {
    const findFlags = vi.fn<WorkflowLineageRepository["findFlags"]>(async () => ({
      id: "workflow_archived",
      name: "Archived quality check",
      publishedId: "published_1",
      isComponent: false,
      isEvaluator: false,
    }));
    const setFlags = vi.fn<WorkflowLineageRepository["setFlags"]>(async () => undefined);
    const listByWorkflow = vi.fn<EvaluatorApi["listByWorkflow"]>(async () => [existingEvaluator]);
    const update = vi.fn<EvaluatorApi["update"]>(async () => existingEvaluator);
    const app = await appWith({
      lineage: { findFlags, setFlags },
      evaluators: createApiFixture<EvaluatorApi>({ listByWorkflow, update }, "EvaluatorApi"),
    });

    await app.toggleSaveAsEvaluator({
      workflowId: "workflow_archived",
      projectId: "project_1",
      isEvaluator: true,
    });

    expect(setFlags).toHaveBeenCalledWith({
      workflowId: "workflow_archived",
      projectId: "project_1",
      isEvaluator: true,
      isComponent: false,
    });
    expect(update).toHaveBeenCalledWith({
      id: "evaluator_1",
      projectId: "project_1",
      data: { name: "Archived quality check" },
    });
  });

  /** @scenario "Saving a missing workflow as an evaluator refuses before publication changes" */
  it("refuses before publication flags or evaluator rows change", async () => {
    const setFlags = vi.fn<WorkflowLineageRepository["setFlags"]>(async () => undefined);
    const app = await appWith({
      lineage: { findFlags: async () => null, setFlags },
      evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
    });

    await expect(
      app.toggleSaveAsEvaluator({
        workflowId: "workflow_missing",
        projectId: "project_1",
        isEvaluator: true,
      }),
    ).rejects.toMatchObject({ code: "workflow_not_found", httpStatus: 404 });

    expect(setFlags).not.toHaveBeenCalled();
  });
});
