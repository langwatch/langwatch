/**
 * Finding H8 of the 2026-09-04 feature-surface security pass: a prompt tag is one
 * ORGANIZATION row whose assignments cascade to every project in that organization, while
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { PromptApp } from "#app/prompt.app";
import { PromptTagTrpcApi } from "../prompt-tag.api.ts";
import type { PromptTrpcContext } from "../../../rules/prompt-trpc-context.rules.ts";

const ORGANIZATION_PROJECTS = ["project_a", "project_b"];

/**
 * The real application, so the cascade this suite is about is the one the REST
 * door also calls rather than a second copy written for the test.
 */
function buildCaller(options: { manageable: readonly string[] }) {
  const prompts = PromptApp.create({
    prompts: {} as unknown as PromptService,
    projects: {
      getOrganizationId: async () => "organization_1",
      listIdsByOrganization: async () => ORGANIZATION_PROJECTS,
    } as unknown as ProjectService,
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

  const can = vi.fn(async (_permission: AuthzPermission, target: { projectId: string }) =>
    options.manageable.includes(target.projectId),
  );

  const context: PromptTrpcContext = {
    app: { prompts },
    actor: () => ({ id: "user_1" }),
    can,
  };

  const trpc = initTRPC.context<PromptTrpcContext>().create();
  const router = PromptTagTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policy: () => (procedure) => procedure,
    validateOutput: true,
  });

  return {
    caller: router.createCaller(context),
    renameTagForProject,
    deleteTagForProject,
    can,
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
    /** @scenario Renaming a prompt tag demands the permission across the organization */
    it("refuses the rename, and renames nothing", async () => {
      const { caller, renameTagForProject, can } = buildCaller({ manageable: ["project_a"] });

      await expect(
        caller.rename({ projectId: "project_a", oldName: "staging", newName: "release" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(renameTagForProject).not.toHaveBeenCalled();
      expect(can).toHaveBeenCalledWith("prompts:manage", { projectId: "project_b" });
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
