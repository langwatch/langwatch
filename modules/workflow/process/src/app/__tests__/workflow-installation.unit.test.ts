/**
 * The workflow module installs, in every role it serves, and the token the
 * transports bind to resolves to the app the installer built.
 */
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { workflowProcessModule } from "../../workflow.module.ts";

function process_(role: "api" | "worker") {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }));

  return createApp({ role, secrets: (owner, declared) => resolver.scopeTo(owner, declared) })
    .withModules([workflowProcessModule])
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
    .withStores(memoryStores())
    .provide({
      authz: createApiFixture({}, "AuthzApi"),
      evaluator: createApiFixture({}, "EvaluatorApi"),
      dataset: createApiFixture({}, "DatasetApi"),
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
  describe("given a process composed on memory stores", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process_(role).boot();

      try {
        const app = runtime.service(WorkflowApi);

        expect(runtime.module(workflowProcessModule).provided).toBe(app);
        await expect(app.list({ projectId: "project-1" })).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
  describe("given a process that supplies only the stores and peers the module declares", () => {
    /** @scenario "The workflows list reads copy lineage on a process that supplies only stores and declared peers" */
    it("lists the project's workflows with their copy lineage", async () => {
      const runtime = await process_("api").boot();

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
