import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { ScopedSecrets } from "@langwatch/secrets";
import type { StudioServerEvent } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowLineageRepository } from "../../repositories/workflow-lineage.repository.ts";
import type { WorkflowProjectEnvironmentRepository } from "../../repositories/workflow-project-environment.repository.ts";
import type { WorkflowRepository } from "../../repositories/workflow.repository.ts";
import { WorkflowApp, type WorkflowInfrastructure } from "../workflow.app.ts";
import { createWorkflowTestInfrastructure } from "./workflow.fixture.ts";

class NoopTestEncryption {
  encrypt(value: string): string {
    return value;
  }

  decrypt(value: string): string {
    return value;
  }
}

function appWith(
  overrides: Partial<WorkflowInfrastructure>,
  authz: AuthzApi = createApiFixture<AuthzApi>({}, "AuthzApi"),
): WorkflowApp {
  const members = createWorkflowTestInfrastructure(overrides);

  return WorkflowApp.create({
    members: {
      ...members,
      prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
      encryption: new NoopTestEncryption(),
      nlpServiceUrl: void 0,
      publicBaseUrl: void 0,
    },
    dependencies: {
      evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz,
      experiments: createApiFixture<ExperimentApi>({}, "ExperimentApi"),
      datasets: members.datasets,
      monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
    },
    config: { stagingThresholdBytes: void 0, stagingTtlSeconds: 600 },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories: {
      workflowRows: members.workflowRows,
      workflows: createApiFixture<WorkflowRepository>({}, "WorkflowRepository"),
      projectEnvironment: createApiFixture<WorkflowProjectEnvironmentRepository>(
        {},
        "WorkflowProjectEnvironmentRepository",
      ),
      lineage: createApiFixture<WorkflowLineageRepository>({}, "WorkflowLineageRepository"),
    },
  });
}

describe("WorkflowApp caller refusals", () => {
  describe("given a key that cannot read the run it would start", () => {
    /** @scenario A workflows-only key cannot start a run it could not read */
    it("refuses before the trigger is reached", async () => {
      const trigger = vi.fn<WorkflowInfrastructure["evaluations"]["trigger"]>();
      const app = appWith({ evaluations: { trigger } });

      await expect(
        app.triggerEvaluation({
          projectId: "project_1",
          projectSlug: "project-one",
          workflowId: "workflow_1",
          callerMayReadRuns: false,
        }),
      ).rejects.toMatchObject({
        code: "api_key_permission_denied",
        meta: { permission: "evaluations:view" },
      });
      expect(trigger).not.toHaveBeenCalled();
    });
  });

  describe("given a code completion with no signed-in caller", () => {
    it("refuses it as unauthorized before checking any permission", async () => {
      const has = vi.fn<WorkflowInfrastructure["permissions"]["has"]>();
      const hasMany = vi.fn<WorkflowInfrastructure["permissions"]["hasMany"]>();
      const app = appWith({ permissions: { has, hasMany } });

      await expect(
        app.completeCode({ projectId: "project_1", userId: undefined, body: {} }),
      ).rejects.toMatchObject({ code: "unauthorized", httpStatus: 401 });
      expect(has).not.toHaveBeenCalled();
    });
  });

  describe("given a Studio event posted to the editor's door", () => {
    const isAlive = JSON.stringify({
      projectId: "project_1",
      event: { type: "is_alive", payload: {} },
    });
    const authzAnswering = (granted: boolean) =>
      createApiFixture<AuthzApi>({ hasPermission: async () => granted }, "AuthzApi");
    const drain = async (events: AsyncIterable<StudioServerEvent>) => {
      const seen: StudioServerEvent[] = [];
      for await (const event of events) seen.push(event);
      return seen;
    };

    it("refuses a body that is not a Studio event as a validation error", async () => {
      await expect(
        appWith({}).streamStudioEvent({ body: "not json", userId: "user_1" }),
      ).rejects.toMatchObject({ code: "validation_error", httpStatus: 400 });
    });

    it("refuses a caller who is not signed in", async () => {
      await expect(
        appWith({}).streamStudioEvent({ body: isAlive, userId: undefined }),
      ).rejects.toMatchObject({ code: "unauthorized", httpStatus: 401 });
    });

    it("refuses a caller who may not manage the project's workflows", async () => {
      await expect(
        appWith({}, authzAnswering(false)).streamStudioEvent({ body: isAlive, userId: "user_1" }),
      ).rejects.toMatchObject({ code: "project_permission_denied", httpStatus: 403 });
    });

    it("answers a run the engine cannot start with one last error frame, then ends", async () => {
      const app = appWith({}, authzAnswering(true));

      const events = await app.streamStudioEvent({ body: isAlive, userId: "user_1" });

      expect(await drain(events)).toEqual([
        { type: "error", payload: { message: expect.stringContaining("NLP engine") } },
      ]);
    });
  });
});
