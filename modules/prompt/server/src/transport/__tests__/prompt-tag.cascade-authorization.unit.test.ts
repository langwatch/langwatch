/**
 * Finding H8 of the 2026-09-04 feature-surface security pass: a prompt tag is one
 * ORGANIZATION row whose assignments cascade to every project in that organization.
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { PromptApp } from "#app/prompt.app";
import type { PromptService } from "../../services/prompt.service.ts";
import { promptTagTrpcTransport } from "../prompt-tag.trpc.ts";
import { promptTrpcCaller } from "./prompt-trpc.fixture.ts";

const ORGANIZATION_PROJECTS = ["project_a", "project_b"];

/**
 * The real application, so the cascade this suite is about is the one the REST
 * door also calls rather than a second copy written for the test.
 */
function buildCaller(options: { manageable: readonly string[] }) {
  const hasPermission = vi.fn(async (check: { projectId?: string }) =>
    options.manageable.includes(check.projectId ?? ""),
  );

  const prompts = PromptApp.create({
    dependencies: {
      projects: {
        getOrganizationId: async () => "organization_1",
        listIdsByOrganization: async () => ORGANIZATION_PROJECTS,
      } as unknown as ProjectApi,
      permissions: {
        hasPermission,
        getApiKeyProjectDecision: async () => ({ outcome: "denied" }),
      } as unknown as AuthzApi,
    },
    infrastructure: {
      prompts: {} as unknown as PromptService,
      afterPromptCreated: () => undefined,
    },
    config: undefined,
    resources: { own: () => {}, ownService: () => {} },
  });

  const renameTagForProject = vi.spyOn(prompts, "renameTagForProject").mockResolvedValue({
    id: "tag_1",
    organizationId: "organization_1",
    name: "release",
  } as never);
  const deleteTagForProject = vi.spyOn(prompts, "deleteTagForProject").mockResolvedValue({
    id: "tag_1",
    organizationId: "organization_1",
    name: "production",
  } as never);

  return {
    caller: promptTrpcCaller({ declaration: promptTagTrpcTransport, app: prompts }),
    renameTagForProject,
    deleteTagForProject,
    hasPermission,
  };
}

describe("promptTags.rename and promptTags.delete", () => {
  describe("given a caller who may manage prompts in every project of the organization", () => {
    it("renames the tag and deletes it", async () => {
      const { caller, renameTagForProject, deleteTagForProject } = buildCaller({
        manageable: ORGANIZATION_PROJECTS,
      });

      await caller.rename({ projectId: "project_a", oldName: "staging", newName: "release" });
      await caller.delete({ projectId: "project_a", name: "production" });

      expect(renameTagForProject).toHaveBeenCalledOnce();
      expect(deleteTagForProject).toHaveBeenCalledOnce();
    });
  });

  describe("given a caller who may manage prompts in one project only", () => {
    /**
     * FORBIDDEN, not the UNAUTHORIZED this door used to spell by hand: the
     * runtime reads the wire code off the handled cause's own status, and
     * `PermissionDeniedError` is a 403 - the caller IS authenticated, they
     * lack the grant.
     */
    /** @scenario Renaming a prompt tag demands the permission across the organization */
    it("refuses the rename, and renames nothing", async () => {
      const { caller, renameTagForProject, hasPermission } = buildCaller({
        manageable: ["project_a"],
      });

      await expect(
        caller.rename({ projectId: "project_a", oldName: "staging", newName: "release" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(renameTagForProject).not.toHaveBeenCalled();
      expect(hasPermission).toHaveBeenCalledWith({
        userId: "user_1",
        permission: "prompts:manage",
        projectId: "project_b",
      });
    });

    /** @scenario Deleting a prompt tag demands the permission across the organization */
    it("refuses the delete, and removes no assignment", async () => {
      const { caller, deleteTagForProject } = buildCaller({ manageable: ["project_a"] });

      const refusal = await caller
        .delete({ projectId: "project_a", name: "production" })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(TRPCError);
      expect((refusal as TRPCError).cause).toMatchObject({ code: "permission_denied" });
      expect(deleteTagForProject).not.toHaveBeenCalled();
    });
  });
});
