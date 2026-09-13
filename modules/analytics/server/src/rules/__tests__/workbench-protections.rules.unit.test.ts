/** @vitest-environment node */

import type { AuthzApi } from "@langwatch/authz-contract";
import { PLATFORM_DEFAULT_DATA_PRIVACY, type DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveWorkbenchProtections,
  resolveWorkbenchRunCaller,
} from "../workbench-protections.rules.ts";

/** Every permission answers the same boolean, so a case only has to name one. */
function authzAnswering(granted: boolean): { authz: AuthzApi; hasPermission: ReturnType<typeof vi.fn> } {
  const hasPermission = vi.fn(async () => granted);
  return { authz: createApiFixture<AuthzApi>({ hasPermission }, "workbench authz"), hasPermission };
}

function dataPrivacyResolving(
  resolve: () => Promise<import("@langwatch/data-privacy-contract").ResolvedDataPrivacy>,
): { dataPrivacy: DataPrivacyApi; getResolvedForProject: ReturnType<typeof vi.fn> } {
  const getResolvedForProject = vi.fn(resolve);
  return {
    dataPrivacy: createApiFixture<DataPrivacyApi>({ getResolvedForProject }, "workbench data privacy"),
    getResolvedForProject,
  };
}

function projectsWith(project: { id: string; lwqlKey: string } | null): {
  projects: ProjectApi;
  tryGetById: ReturnType<typeof vi.fn>;
} {
  const tryGetById = vi.fn(async () => project);
  return { projects: createApiFixture<ProjectApi>({ tryGetById }, "workbench projects"), tryGetById };
}

describe("resolveWorkbenchProtections", () => {
  describe("given a member permitted every declared check", () => {
    /** @scenario "A member permitted every declared check sees costs and captured content" */
    it("sees costs and the default policy's captured content", async () => {
      const { authz } = authzAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await resolveWorkbenchProtections({
        authz,
        dataPrivacy,
        userId: "user-1",
        projectId: "project-1",
      });

      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
      });
    });
  });

  describe("given a member denied every declared check", () => {
    /** @scenario "A member denied every declared check sees neither costs nor captured content" */
    it("sees neither costs nor captured content", async () => {
      const { authz } = authzAnswering(false);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await resolveWorkbenchProtections({
        authz,
        dataPrivacy,
        userId: "user-1",
        projectId: "project-1",
      });

      expect(resolved).toEqual({
        canSeeCosts: false,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
      });
    });

    it("still asks all three permissions for this one project", async () => {
      const { authz, hasPermission } = authzAnswering(false);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      await resolveWorkbenchProtections({
        authz,
        dataPrivacy,
        userId: "user-1",
        projectId: "project-1",
      });

      expect(hasPermission).toHaveBeenCalledWith({
        userId: "user-1",
        permission: "cost:view",
        projectId: "project-1",
      });
      expect(hasPermission).toHaveBeenCalledWith({
        userId: "user-1",
        permission: "traces:view",
        projectId: "project-1",
      });
      expect(hasPermission).toHaveBeenCalledWith({
        userId: "user-1",
        permission: "project:update",
        projectId: "project-1",
      });
    });
  });

  describe("given the data-privacy policy read throws", () => {
    /** @scenario "A thrown data-privacy read hides captured content rather than defaulting it open" */
    it("hides captured content instead of letting the failure widen access", async () => {
      const { authz } = authzAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => {
        throw new Error("data-privacy resolver unavailable");
      });

      const resolved = await resolveWorkbenchProtections({
        authz,
        dataPrivacy,
        userId: "user-1",
        projectId: "project-1",
      });

      // Costs are unaffected: only the data-privacy read failed.
      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
      });
    });
  });
});

describe("resolveWorkbenchRunCaller", () => {
  describe("given a project that no longer exists", () => {
    /** @scenario "A run-caller resolution for a missing project refuses rather than running as no one" */
    it("refuses with project_not_found instead of resolving a caller for it", async () => {
      const { authz } = authzAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);
      const { projects } = projectsWith(null);

      await expect(
        resolveWorkbenchRunCaller({
          authz,
          dataPrivacy,
          projects,
          userId: "user-1",
          projectId: "project-missing",
        }),
      ).rejects.toMatchObject({ code: "project_not_found" });
    });
  });

  describe("given a project that exists", () => {
    /** @scenario "A run-caller resolution for a live project returns its restricted identity and protections" */
    it("returns the project's own restricted identity together with the caller's protections", async () => {
      const { authz } = authzAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);
      const { projects } = projectsWith({ id: "project-1", lwqlKey: "lwql-secret" });

      await expect(
        resolveWorkbenchRunCaller({
          authz,
          dataPrivacy,
          projects,
          userId: "user-1",
          projectId: "project-1",
        }),
      ).resolves.toEqual({
        project: { id: "project-1", lwqlKey: "lwql-secret" },
        protections: { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true },
      });
    });
  });
});
