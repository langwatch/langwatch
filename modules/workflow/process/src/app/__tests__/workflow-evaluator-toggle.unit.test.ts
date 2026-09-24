import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { Evaluator, EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowProjectEnvironmentRepository } from "../../repositories/workflow-project-environment.repository.ts";
import type { WorkflowRepository } from "../../repositories/workflow.repository.ts";
import { WorkflowApp, type WorkflowPublicationReads } from "../workflow.app.ts";
import { createWorkflowTestInfrastructure } from "./workflow.fixture.ts";

class NoopTestEncryption {
  encrypt(value: string): string {
    return value;
  }

  decrypt(value: string): string {
    return value;
  }
}

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

function appWith({
  publications,
  evaluators,
}: {
  publications: WorkflowPublicationReads;
  evaluators: EvaluatorApi;
}): WorkflowApp {
  const members = createWorkflowTestInfrastructure({ publications, evaluators });

  return WorkflowApp.create({
    members: {
      ...members,
      prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
      encryption: new NoopTestEncryption(),
    },
    dependencies: {
      evaluators,
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      datasets: members.datasets,
    },
    config: {
      codeBlockTimeoutSeconds: void 0,
      stagingThresholdBytes: void 0,
      stagingTtlSeconds: 600,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories: {
      workflowRows: members.workflowRows,
      workflows: createApiFixture<WorkflowRepository>({}, "WorkflowRepository"),
      projectEnvironment: createApiFixture<WorkflowProjectEnvironmentRepository>(
        {},
        "WorkflowProjectEnvironmentRepository",
      ),
    },
  });
}

describe("workflow evaluator publication", () => {
  /** @scenario "An archived workflow keeps its evaluator publication behaviour" */
  it("uses the publication row's name when the ordinary workflow row is archived", async () => {
    const findFlags = vi.fn<WorkflowPublicationReads["findFlags"]>(async () => ({
      id: "workflow_archived",
      name: "Archived quality check",
      publishedId: "published_1",
      isComponent: false,
      isEvaluator: false,
    }));
    const setFlags = vi.fn<WorkflowPublicationReads["setFlags"]>(async () => undefined);
    const listByWorkflow = vi.fn<EvaluatorApi["listByWorkflow"]>(async () => [existingEvaluator]);
    const update = vi.fn<EvaluatorApi["update"]>(async () => existingEvaluator);
    const app = appWith({
      publications: {
        findFlags,
        setFlags,
        findVersion: async () => null,
        listPublishedComponents: async () => [],
      },
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
    const setFlags = vi.fn<WorkflowPublicationReads["setFlags"]>(async () => undefined);
    const app = appWith({
      publications: {
        findFlags: async () => null,
        setFlags,
        findVersion: async () => null,
        listPublishedComponents: async () => [],
      },
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
