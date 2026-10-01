/**
 * A prompt tag write needs `prompts:manage` on the caller's project only, as on
 * main: no sibling project in the organization is probed.
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { PromptApp } from "#app/prompt.app";

import { defaultModelFixture } from "../../__tests__/default-model.test-fixture.ts";
import type { PromptService } from "../../services/prompt.service.ts";
import { promptTagTrpcTransport } from "../prompt-tag.trpc.ts";
import { promptTrpcCaller } from "./prompt-trpc.fixture.ts";

/** The real application behind the real tRPC door. */
function buildCaller(options: { manageable: readonly string[] }) {
  const hasPermission = vi.fn(async (check: { projectId?: string }) =>
    options.manageable.includes(check.projectId ?? ""),
  );

  const prompts = PromptApp.createWithPrompts(
    {
      dependencies: {
        projects: createApiFixture<ProjectApi>({
          getOrganizationId: async () => "organization_1",
          listIdsByOrganization: async () => ["project_a", "project_b"],
        }),
        permissions: createApiFixture<AuthzApi>({
          hasPermission,
          getApiKeyProjectDecision: async () => ({ outcome: "denied" }),
        }),
        plans: createApiFixture<EntitlementApi>(),
        workflow: createApiFixture<WorkflowApi>(),
        modelProviders: defaultModelFixture(),
      },
      members: {
        logger: createLogger("prompt-tag-authorization-test"),
        rateLimiter: { check: async () => ({ allowed: true }) },
        publicBaseUrl: "https://app.langwatch.test",
      },
      config: undefined,
      resources: { own: () => {}, ownService: () => {} },
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    },
    createApiFixture<PromptService>(),
  );

  const renameTagForProject = vi.spyOn(prompts, "renameTagForProject").mockResolvedValue({
    id: "tag_1",
    organizationId: "organization_1",
    name: "release",
    createdAt: new Date(0),
  });
  const deleteTagForProject = vi.spyOn(prompts, "deleteTagForProject").mockResolvedValue({
    id: "tag_1",
    organizationId: "organization_1",
    name: "production",
    createdAt: new Date(0),
  });

  return {
    caller: promptTrpcCaller({ declaration: promptTagTrpcTransport, app: prompts }),
    renameTagForProject,
    deleteTagForProject,
    hasPermission,
  };
}

describe("promptTags.rename and promptTags.delete", () => {
  describe("given a caller who may manage prompts in one project of the organization only", () => {
    /** @scenario Renaming a prompt tag needs the permission on the caller's project only */
    it("renames the tag without probing any sibling project", async () => {
      const { caller, renameTagForProject, hasPermission } = buildCaller({
        manageable: ["project_a"],
      });

      await caller.rename({ projectId: "project_a", oldName: "staging", newName: "release" });

      expect(renameTagForProject).toHaveBeenCalledOnce();
      expect(hasPermission).not.toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_b" }),
      );
    });

    /** @scenario Deleting a prompt tag needs the permission on the caller's project only */
    it("deletes the tag without probing any sibling project", async () => {
      const { caller, deleteTagForProject, hasPermission } = buildCaller({
        manageable: ["project_a"],
      });

      await caller.delete({ projectId: "project_a", name: "production" });

      expect(deleteTagForProject).toHaveBeenCalledOnce();
      expect(hasPermission).not.toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_b" }),
      );
    });
  });
});
