import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Protections } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceViewerProtectionService } from "../../trace-viewer-protection.service.ts";

const anonymous: Protections = {
  canSeeCosts: false,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  capturedInputVisibleTo: null,
  capturedOutputVisibleTo: null,
  contentCategories: {
    input: { canSee: true, restrictVisibleTo: null },
    output: { canSee: true, restrictVisibleTo: null },
    system: { canSee: true, restrictVisibleTo: null },
    tools: { canSee: true, restrictVisibleTo: null },
  },
  hiddenAttributes: [],
  visibilityCutoffMs: null,
};

const projectOne = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
};

function serviceWith(can: AuthzApi["can"]) {
  const service = TraceViewerProtectionService.create({
    authz: createApiFixture<AuthzApi>({ can }),
    projects: createApiFixture<ProjectApi>({ findIdentity: async () => projectOne }),
    plans: {} as PlanProvider,
    dataPrivacy: {} as DataPrivacyApi,
    fallbackVisibilityDays: 30,
    processName: "test",
  });
  const resolve = vi.fn<() => Promise<Protections>>(async () => anonymous);
  Object.defineProperty(service, "resolve", { value: resolve });
  return { service, resolve };
}

const costsAtProject = {
  permission: "cost:view",
  scope: { type: "project", id: "project-1", teamId: "team-1", organizationId: "org-1" },
};

describe("TraceViewerProtectionService.resolveForApiKey", () => {
  describe("given a caller holding an api key", () => {
    it("resolves the project anonymously and takes costs from the key's own grant", async () => {
      const can = vi.fn<AuthzApi["can"]>(async () => true);
      const { service, resolve } = serviceWith(can);

      await expect(
        service.resolveForApiKey({
          projectId: "project-1",
          principal: { type: "apiKey", id: "key-1" },
        }),
      ).resolves.toEqual({ ...anonymous, canSeeCosts: true });

      expect(resolve).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: undefined,
        publiclyShared: false,
      });
      expect(can).toHaveBeenCalledWith({
        principal: { type: "apiKey", id: "key-1" },
        ...costsAtProject,
      });
    });
  });

  describe("given a project-bound access token", () => {
    /** @scenario A project-bound access token reads trace costs as its person */
    it("asks authz about the user principal, never a key row", async () => {
      const can = vi.fn<AuthzApi["can"]>(async () => true);
      const { service } = serviceWith(can);

      await service.resolveForApiKey({
        projectId: "project-1",
        principal: { type: "user", id: "user-1" },
      });

      expect(can).toHaveBeenCalledWith({
        principal: { type: "user", id: "user-1" },
        ...costsAtProject,
      });
    });
  });

  describe("when the key is refused cost:view", () => {
    it("answers the anonymous protections with costs hidden", async () => {
      const { service } = serviceWith(vi.fn<AuthzApi["can"]>(async () => false));

      await expect(
        service.resolveForApiKey({
          projectId: "project-1",
          principal: { type: "apiKey", id: "key-1" },
        }),
      ).resolves.toEqual({ ...anonymous, canSeeCosts: false });
    });
  });

  describe("given a legacy project key, which predates RBAC", () => {
    it("sees costs without asking authz at all", async () => {
      const can = vi.fn<AuthzApi["can"]>(async () => false);
      const { service } = serviceWith(can);

      await expect(
        service.resolveForApiKey({ projectId: "project-1", principal: null }),
      ).resolves.toEqual({ ...anonymous, canSeeCosts: true });
      expect(can).not.toHaveBeenCalled();
    });
  });
});
