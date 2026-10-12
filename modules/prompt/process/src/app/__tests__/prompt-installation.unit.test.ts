/**
 * @vitest-environment node
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { isTenantMigrationStep } from "@langwatch/upgrade/step";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { defaultModelFixture } from "../../__tests__/default-model.test-fixture.ts";
import { promptProcessModule } from "../../prompt.module.ts";

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([promptProcessModule])
    .withStores(memoryStores())
    .withConfig({ prompt: { publicBaseUrl: undefined } })
    .provide({
      project: createApiFixture<ProjectApi>({}),
      authz: createApiFixture<AuthzApi>({}),
      entitlement: createApiFixture<EntitlementApi>({}),
      workflow: createApiFixture<WorkflowApi>({}),
      "model-provider": defaultModelFixture(),
    });
}

describe("prompt app installation", () => {
  /** @scenario "Prompt boots a working memory app in every process role" */
  it.each(["api", "worker"] as const)(
    "installs a working memory app in the %s role",
    async (role) => {
      const runtime = await process(role).boot();

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
    const first = await process("api").boot();
    const second = await process("api").boot();

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
    const runtime = await process("worker").boot();

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
