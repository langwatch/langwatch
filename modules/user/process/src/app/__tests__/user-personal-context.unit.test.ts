import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnsuredPersonalWorkspace } from "@langwatch/organization-contract";
import { userApiPersonalContextSchema } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { createUserTestApp, createUserTestOrganizations } from "./user.fixture.ts";

const WORKSPACE: EnsuredPersonalWorkspace = {
  team: { id: "team-1", name: "Ada's workspace", slug: "ada", createdAtMs: 0 },
  project: { id: "project-1", name: "Ada", slug: "ada", apiKey: "sk-lw-secret", createdAtMs: 0 },
  created: false,
};

function appWhere({ canManageProject }: { canManageProject: boolean }) {
  const hasPermission = vi.fn(async () => canManageProject);
  const organizations = Object.assign(createUserTestOrganizations(), {
    ensurePersonalWorkspace: vi.fn(async () => WORKSPACE),
  });
  const app = createUserTestApp({
    dependencies: { authz: createApiFixture<AuthzApi>({ hasPermission }), organizations },
  });

  return { app, hasPermission };
}

describe("UserApp.getPersonalContext", () => {
  describe("given the caller holds project:manage on their personal project", () => {
    /** @scenario "A caller who may manage their personal project reads its API key in the personal context" */
    it("returns the personal project's API key", async () => {
      const { app, hasPermission } = appWhere({ canManageProject: true });

      const context = await app.getPersonalContext({ userId: "user-1", organizationId: "org-1" });

      expect(context.workspace.project.apiKey).toBe("sk-lw-secret");
      expect(hasPermission).toHaveBeenCalledWith({
        userId: "user-1",
        permission: "project:manage",
        projectId: "project-1",
      });
    });
  });

  describe("given the caller lacks project:manage on their personal project", () => {
    /** @scenario "A caller who may not manage their personal project reads a blank API key in the personal context" */
    it("blanks the API key and still answers a valid personal context", async () => {
      const { app } = appWhere({ canManageProject: false });

      const context = await app.getPersonalContext({ userId: "user-1", organizationId: "org-1" });

      expect(context.workspace.project.apiKey).toBe("");
      expect(context.workspace.project.id).toBe("project-1");
      expect(userApiPersonalContextSchema.parse(context).workspace.project.apiKey).toBe("");
    });
  });
});
