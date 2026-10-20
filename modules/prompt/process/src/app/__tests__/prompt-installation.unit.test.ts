/**
 * @vitest-environment node
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { isTenantMigrationStep } from "@langwatch/upgrade/step";
import { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { defaultModelFixture } from "../../__tests__/default-model.test-fixture.ts";
import { promptProcessModule } from "../../prompt.module.ts";

function process(role: "api" | "worker") {
  return bootInstalledProcess({
    role,
    modules: [promptProcessModule],
    config: { prompt: { publicBaseUrl: undefined } },
    stores: memoryStores(),
    peers: [
      testPeer({ token: ProjectApi, instance: createApiFixture<ProjectApi>({}) }),
      testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>({}) }),
      testPeer({ token: EntitlementApi, instance: createApiFixture<EntitlementApi>({}) }),
      testPeer({ token: WorkflowApi, instance: createApiFixture<WorkflowApi>({}) }),
      testPeer({ token: ModelProviderApi, instance: defaultModelFixture() }),
    ],
  });
}

describe("prompt app installation", () => {
  /** @scenario "Prompt boots a working memory app in every process role" */
  it.each(["api", "worker"] as const)(
    "installs a working memory app in the %s role",
    async (role) => {
      const runtime = await process(role);

      try {
        const app = runtime.service(PromptApi);

        expect(runtime.module(promptProcessModule).provided).toBe(app);
        await app.seedTagsForOrganization({ organizationId: "organization-1" });
        await expect(app.listTags({ organizationId: "organization-1" })).resolves.toMatchObject([
          { name: "production" },
          { name: "staging" },
        ]);
      } finally {
        await runtime.stop();
      }
    },
  );

  /** @scenario "Prompt memory repository bundles stay isolated per installation" */
  it("allocates independent memory repository bundles for each installation", async () => {
    const first = await process("api");
    const second = await process("api");

    try {
      await first.service(PromptApi).createTag({
        organizationId: "organization-1",
        name: "canary",
      });

      await expect(
        second.service(PromptApi).listTags({ organizationId: "organization-1" }),
      ).resolves.toEqual([]);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });

  /** @scenario "A worker collects the tag backfill as an organization tenant step" */
  it("collects the tag backfill as an organization tenant step that proves by held tags", async () => {
    const runtime = await process("worker");

    try {
      const [step] = runtime
        .migrationSteps(isTenantMigrationStep)
        .filter(({ id }) => id === "prompt:seed-tags-for-untagged-organizations");

      expect(step).toMatchObject({ kind: "tenant", mode: "background", tenants: "organization" });
      await expect(step?.migrateTenant({ tenantId: "organization-1" })).resolves.toMatchObject({
        status: "finalized",
      });
      await expect(
        runtime.service(PromptApi).listTags({ organizationId: "organization-1" }),
      ).resolves.toMatchObject([{ name: "production" }, { name: "staging" }]);
    } finally {
      await runtime.stop();
    }
  });
});
