/**
 * Finding H8 of the 2026-09-04 feature-surface security pass: a prompt tag is
 * one ORGANIZATION row whose assignments cascade to every project in that
 * organization, while the declared check gates on the single project the input
 * names. The handler probes the rest, exactly as the copy/push procedures do
 * for the second project they reach.
 *
 * The process's declared check is the identity here on purpose: what is under
 * test is the probe the handler owns, and running the real one would prove the
 * first project twice and the other projects not at all.
 *
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { PromptApp } from "#app/prompt.app";
import { PromptTagTrpcApi } from "../prompt-tag.api";
import type { PromptTrpcContext } from "../prompt.trpc-context";

const ORGANIZATION_PROJECTS = ["project_a", "project_b"];

function buildCaller(options: {
  manageable: readonly string[];
  app?: Partial<PromptApp>;
}) {
  const renameTagForProject = vi.fn(async () => ({ id: "tag_1", name: "release" }));
  const deleteTagForProject = vi.fn(async () => ({ id: "tag_1", name: "production" }));
  const projectsSharingTagCatalog = vi.fn(async () => ORGANIZATION_PROJECTS);

  const prompts = {
    renameTagForProject,
    deleteTagForProject,
    projectsSharingTagCatalog,
    ...options.app,
  } as unknown as PromptApp;

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
