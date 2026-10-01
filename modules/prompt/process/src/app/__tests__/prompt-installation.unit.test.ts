import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createApp } from "@langwatch/kernel";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { createTestLogger } from "@langwatch/test-harness";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { defaultModelFixture } from "../../__tests__/default-model.test-fixture.ts";
import { promptServer } from "../../prompt.server.ts";

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([promptServer])
    .withStores(memoryStores())
    .withMembers({
      logging: createTestLogger().logger,
      rateLimiter: { check: async () => ({ allowed: true }) },
      publicBaseUrl: void 0,
    })
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

        expect(runtime.module(promptServer).provided).toBe(app);
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
});
