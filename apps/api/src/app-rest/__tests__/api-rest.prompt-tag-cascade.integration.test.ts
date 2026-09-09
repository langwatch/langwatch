/**
 * @see specs/security/resource-scope-permission-checks.feature
 * A prompt tag definition is one organization row whose assignments cascade to
 * every project in that organization. The family's own door authorizes the
 * project the key resolved to and nothing more, so the rename asks the prompt
 * application about every project the catalog reaches — driven here through
 * the process's real credential chain.
 */
import { TestProjectApi } from "../../app/__tests__/support/test-project-api.ts";
import { PromptApp } from "@langwatch/prompt-server";
import { describe, expect, it, vi } from "vitest";

import {
  REST_AUTH_ORGANIZATION,
  REST_AUTH_PROJECT,
  RestAuthWorld,
  type RestAuthKey,
  type RestAuthProject,
} from "./support/rest-auth.world.ts";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness.ts";

/** A second team's project sharing the organization, and so the tag catalog. */
const SIBLING_PROJECT: RestAuthProject = {
  id: "project-gamma",
  name: "Gamma",
  slug: "gamma",
  teamId: "team-gamma",
  organizationId: REST_AUTH_ORGANIZATION,
  isPersonal: false,
  ownerUserId: null,
};

const PROJECTS = [REST_AUTH_PROJECT, SIBLING_PROJECT];
const TAG_KEY = "sk-lw-prompt-tags";

describe("given a prompt tag catalog shared by two projects of one organization", () => {
  describe("when a key that manages prompts in its own project only renames a tag", () => {
    /** @scenario "A key renaming a prompt tag is held to every project the catalog reaches" */
    it("refuses with the permission-denied code for the project tier, and renames nothing", async () => {
      const { api, renameTag } = mountPrompts({
        token: TAG_KEY,
        projectId: REST_AUTH_PROJECT.id,
        apiKeyId: "key-prompt-tags",
        grants: ["prompts:manage"],
        ownerGrants: ["prompts:manage"],
        ownerProjectIds: [REST_AUTH_PROJECT.id],
      });

      const response = await api.put("/api/prompts/tags/staging", { name: "release" }, bearer());

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "permission_denied",
        permission: "prompts:manage",
        scopeType: "project",
      });
      expect(renameTag).not.toHaveBeenCalled();
    });
  });

  describe("when a key that manages prompts across the organization renames the same tag", () => {
    /** @scenario "A key renaming a prompt tag succeeds when it reaches the whole catalog" */
    it("renames the tag", async () => {
      const { api, renameTag } = mountPrompts({
        token: TAG_KEY,
        projectId: REST_AUTH_PROJECT.id,
        apiKeyId: "key-prompt-tags",
        grants: ["prompts:manage"],
        ownerGrants: ["prompts:manage"],
      });

      const response = await api.put("/api/prompts/tags/staging", { name: "release" }, bearer());

      expect(response.status).toBe(200);
      expect(renameTag).toHaveBeenCalledOnce();
    });
  });
});

function bearer(): Record<string, string> {
  return RestAuthWorld.bearer(TAG_KEY);
}

/**
 * The prompts family over the real application: a stubbed prompt store, the
 * project directory the catalog is derived from, and the world's own engine.
 */
function mountPrompts(key: RestAuthKey): {
  api: MountedRestFamily;
  renameTag: ReturnType<typeof vi.fn>;
} {
  const world = RestAuthWorld.create({
    projects: PROJECTS,
    keys: [key],
    organizations: [REST_AUTH_ORGANIZATION],
  });

  const renameTag = vi.fn(async () => ({
    id: "tag-1",
    organizationId: REST_AUTH_ORGANIZATION,
    name: "release",
    createdAt: new Date("2026-09-07T00:00:00.000Z"),
  }));

  const promptApp = PromptApp.create({
    prompts: { renameTag } as never,
    projects: new TestProjectApi({
      getOrganizationId: async () => REST_AUTH_ORGANIZATION,
      listIdsByOrganization: async () => PROJECTS.map((project) => project.id),
    }),
  });

  const api = mountRestFamily({
    security: world.security(),
    services: {
      prompts: {
        service: () => promptApp.promptService,
        tagCatalog: () => promptApp,
        permissions: () => world.authz(),
      },
      organizations: () => ({
        getTeamById: async ({ teamId }: { teamId: string }) =>
          ({
            id: teamId,
            organizationId: REST_AUTH_ORGANIZATION,
          }) as never,
      }),
    },
  });

  return { api, renameTag };
}
