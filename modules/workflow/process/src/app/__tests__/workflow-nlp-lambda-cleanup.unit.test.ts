/**
 * @see specs/studio/nlp-lambda-cleanup.feature
 * The sweep of the studio's quiet per-project NLP engines, run through the
 * module's own scheduled process manager.
 */
// @vitest-environment node
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { NlpPayloadStaging } from "../../channels/nlp-lambda.channel.ts";
import { NLP_LAMBDA_CLEANUP_PROCESS_NAME } from "../../eventing/workflow-nlp-lambda-cleanup.process.ts";
import type { WorkflowLineageRepository } from "../../repositories/workflow-lineage.repository.ts";
import type { WorkflowProjectEnvironmentRepository } from "../../repositories/workflow-project-environment.repository.ts";
import type { WorkflowRepository } from "../../repositories/workflow.repository.ts";
import { WorkflowModule, type NlpLambdaArnCache, type NlpLambdaFleet } from "../workflow.app.ts";
import { createWorkflowTestInfrastructure } from "./workflow.fixture.ts";

/** Decrypts nothing a test named - the sweep never reaches it. */
class NoopTestEncryption {
  encrypt(value: string): string {
    return value;
  }

  decrypt(value: string): string {
    return value;
  }
}

/**
 * The App reads nothing off a setup but its members, so a test builds the one
 * it cares about rather than booting a process to reach one method.
 */
async function appWith(fleet?: NlpLambdaFleet): Promise<WorkflowModule> {
  const members = createWorkflowTestInfrastructure(fleet ? { nlpLambdaFleet: fleet } : {});

  return WorkflowModule.create({
    members: {
      ...members,
      prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
      encryption: new NoopTestEncryption(),
      nlpCodeBlockTimeoutSeconds: void 0,
      nlpServiceUrl: void 0,
      publicBaseUrl: void 0,
    },
    dependencies: {
      evaluators: members.evaluators,
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      projects: createApiFixture<ProjectApi>({}, "ProjectApi"),
      experiments: createApiFixture<ExperimentApi>({}, "ExperimentApi"),
      datasets: members.datasets,
      monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
      secrets: createApiFixture<SecretApi>({}, "SecretApi"),
      organizations: createApiFixture<OrganizationApi>({}, "OrganizationApi"),
    },
    config: {
      stagingThresholdBytes: undefined,
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
      lineage: createApiFixture<WorkflowLineageRepository>({}, "WorkflowLineageRepository"),
      nlpLambdaArns: createApiFixture<NlpLambdaArnCache>({}, "NlpLambdaArnCache"),
      payloadStaging: createApiFixture<NlpPayloadStaging>({}, "NlpPayloadStaging"),
    },
  });
}

/** Runs the sweep intent the daily wake asks for, as the worker's outbox would. */
async function runSweep(app: WorkflowModule): Promise<void> {
  const process = app
    .nlpLambdaCleanupPipeline({ deleteDispatchedBefore: async () => 0 })
    .processManagers.get(NLP_LAMBDA_CLEANUP_PROCESS_NAME);
  if (!process) throw new Error("the app built no Lambda cleanup process manager");

  await process.config.intents!.sweep!.run(
    { scheduledFor: 0 },
    {
      processName: NLP_LAMBDA_CLEANUP_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: "sweep:0",
      attempt: 1,
    },
  );
}

describe("the studio's NLP Lambda sweep", () => {
  describe("given a deployment that composed no NLP Lambda account", () => {
    /** @scenario "A deployment that composed no Lambda account sweeps nothing on its daily wake" */
    it("reads nothing and succeeds", async () => {
      await expect(runSweep(await appWith())).resolves.toBeUndefined();
    });
  });

  describe("given a deployment whose studio engines can be swept", () => {
    /** @scenario "A sweep deletes the engines that have been quiet for a week" */
    it("deletes an engine that has not run for a month", async () => {
      const listFunctions = vi.fn(async () => [{ name: "langwatch_nlp_project-1" }] as const);
      const deleteFunction = vi.fn(async () => {});
      const fleet: NlpLambdaFleet = {
        listFunctions,
        findLastActivityAt: async () => Temporal.Now.instant().subtract({ hours: 24 * 30 }),
        functionExists: async () => true,
        deleteFunction,
        listLogGroups: async () => [],
        deleteLogGroup: async () => {},
      };

      await runSweep(await appWith(fleet));

      expect(listFunctions).toHaveBeenCalledTimes(1);
      expect(deleteFunction).toHaveBeenCalledWith({ functionName: "langwatch_nlp_project-1" });
    });
  });
});
