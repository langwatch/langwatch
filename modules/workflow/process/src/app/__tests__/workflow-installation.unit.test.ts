import { createApiFixture } from "@langwatch/api-fixture";
/**
 * The workflow module installs, in every role it serves, and the token the
 * transports bind to resolves to the app the installer built.
 */
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { WorkflowApi, type Workflow } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { workflowServer } from "../../workflow.server.ts";
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

  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(workflowServer)])
    .withConfig({
      workflow: {
        stagingThresholdBytes: undefined,
        stagingTtlSeconds: 600,
      },
    })
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withEncryption({
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    })
    .withMember("nlpServiceUrl", undefined)
    .withMember("publicBaseUrl", undefined)
    .provide({
      authz: createApiFixture({}, "AuthzApi"),
      evaluator: members.evaluators,
      dataset: members.datasets,
      agent: createApiFixture({}, "AgentApi"),
      "model-provider": createApiFixture({}, "ModelProviderApi"),
      experiment: createApiFixture({}, "ExperimentApi"),
    });
}

describe("workflow app installation", () => {
  describe("given a process that supplies the module's members", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (_role) => {
      const runtime = await process_().boot();

      try {
        const app = runtime.service(WorkflowApi);

        expect(runtime.module(workflowServer).provided).toBe(app);
        await expect(app.list({ projectId: "project-1" })).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
