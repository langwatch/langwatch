import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
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

function serviceWith(hasApiKeyPermission: AuthzApi["hasApiKeyPermission"]) {
  const service = TraceViewerProtectionService.create({
    authz: createApiFixture<AuthzApi>({ hasApiKeyPermission }),
    projects: {} as ProjectApi,
    plans: {} as PlanProvider,
    dataPrivacy: {} as DataPrivacyApi,
    fallbackVisibilityDays: 30,
    processName: "test",
  });
  const resolve = vi.fn<() => Promise<Protections>>(async () => anonymous);
  Object.defineProperty(service, "resolve", { value: resolve });
  return { service, resolve };
}

describe("TraceViewerProtectionService.resolveForApiKey", () => {
  describe("given a caller holding an api key", () => {
    it("resolves the project anonymously and takes costs from the key's own grant", async () => {
      const hasApiKeyPermission = vi.fn<AuthzApi["hasApiKeyPermission"]>(async () => true);
      const { service, resolve } = serviceWith(hasApiKeyPermission);

      await expect(
        service.resolveForApiKey({
          projectId: "project-1",
          apiKeyId: "key-1",
          userId: "user-1",
        }),
      ).resolves.toEqual({ ...anonymous, canSeeCosts: true });

      expect(resolve).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: undefined,
        publiclyShared: false,
      });
      expect(hasApiKeyPermission).toHaveBeenCalledWith({
        apiKeyId: "key-1",
        userId: "user-1",
        organizationId: "",
        scope: { type: "project", id: "project-1", teamId: "" },
        permission: "cost:view",
      });
    });
  });

  describe("when the key is refused cost:view", () => {
    it("answers the anonymous protections with costs hidden", async () => {
      const { service } = serviceWith(vi.fn<AuthzApi["hasApiKeyPermission"]>(async () => false));

      await expect(
        service.resolveForApiKey({ projectId: "project-1", apiKeyId: "key-1", userId: null }),
      ).resolves.toEqual({ ...anonymous, canSeeCosts: false });
    });
  });

  describe("given a legacy project key, which predates RBAC", () => {
    it("sees costs without asking authz at all", async () => {
      const hasApiKeyPermission = vi.fn<AuthzApi["hasApiKeyPermission"]>(async () => false);
      const { service } = serviceWith(hasApiKeyPermission);

      await expect(
        service.resolveForApiKey({ projectId: "project-1", apiKeyId: null, userId: null }),
      ).resolves.toEqual({ ...anonymous, canSeeCosts: true });
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });
});
