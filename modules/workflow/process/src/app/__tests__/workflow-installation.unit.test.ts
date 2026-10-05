import { PrismaClient } from "@langwatch/prisma-client/generated";
/**
 * The workflow module installs, in every role it serves, and the token the
 * transports bind to resolves to the app the installer built.
 */
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { WorkflowApi, type Workflow } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { workflowProcessModule } from "../../workflow.module.ts";
import { createWorkflowTestInfrastructure, createWorkflowTestService } from "./workflow.fixture.ts";

const NOW = new Date("2026-09-09T00:00:00.000Z");

const workflow = {
  id: "workflow_1",
  projectId: "project-1",
  name: "A workflow",
  icon: null,
  description: null,
  latestVersionId: null,
  currentVersionId: null,
  publishedId: null,
  publishedById: null,
  copiedFromWorkflowId: null,
  isEvaluator: false,
  isComponent: false,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
} satisfies Workflow;

function process_() {
  const members = createWorkflowTestInfrastructure({
    workflows: createWorkflowTestService([workflow]),
  });

  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }));

  return createApp({ role: "api", secrets: (owner, declared) => resolver.scopeTo(owner, declared) })
    .withModules([withMemoryRepositories(workflowProcessModule)])
    .withConfig({
      workflow: {
        nlpServiceUrl: undefined,
        stagingThresholdBytes: undefined,
        stagingTtlSeconds: 600,
        relayTurnCeilingMs: undefined,
        publicBaseUrl: undefined,
        nlpCodeBlockTimeoutSeconds: undefined,
      },
    })
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withEncryption({
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    })
    .provide({
      authz: createApiFixture({}, "AuthzApi"),
      evaluator: members.evaluators,
      dataset: members.datasets,
      agent: createApiFixture({}, "AgentApi"),
      "model-provider": createApiFixture({}, "ModelProviderApi"),
      experiment: createApiFixture({}, "ExperimentApi"),
      monitor: createApiFixture({}, "MonitorApi"),
      secret: createApiFixture({}, "SecretApi"),
      organization: createApiFixture({}, "OrganizationApi"),
      "api-key": createApiFixture({}, "ApiKeyApi"),
      project: createApiFixture({}, "ProjectApi"),
    });
}

describe("workflow app installation", () => {
  describe("given a process that supplies the module's members", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (_role) => {
      const runtime = await process_().boot();

      try {
        const app = runtime.service(WorkflowApi);

        expect(runtime.module(workflowProcessModule).provided).toBe(app);
        await expect(app.list({ projectId: "project-1" })).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
  describe("given a process that supplies only the members the module declares", () => {
    /** @scenario "The workflows list reads copy lineage on a process that supplies only declared members" */
    it("lists the project's workflows with their copy lineage", async () => {
      const runtime = await process_().boot();

      try {
        const app = runtime.service(WorkflowApi);

        await expect(
          app.listWithCopyLineage({ projectId: "project-1", viewerUserId: "user-1" }),
        ).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
