/** @vitest-environment node */

import { createApiFixture } from "@langwatch/api-fixture";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type * as dataPrivacyContractModule from "@langwatch/data-privacy-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import {
  resolveApiKeyProtections,
  resolveProjectProtections,
  resolveWorkbenchProtections,
  resolveWorkbenchRunCaller,
} from "../workbench-protections.rules.ts";

/** Every permission answers the same boolean, so a case only has to name one. */
function authzAnswering(granted: boolean): {
  authz: AuthzApi;
  hasPermission: ReturnType<typeof vi.fn>;
} {
  const hasPermission = vi.fn(async () => granted);
  return { authz: createApiFixture<AuthzApi>({ hasPermission }, "workbench authz"), hasPermission };
}

/** Every `cost:view` question the credential asks answers the same boolean. */
function authzApiKeyAnswering(granted: boolean): {
  authz: AuthzApi;
  hasApiKeyPermission: ReturnType<typeof vi.fn>;
} {
  const hasApiKeyPermission = vi.fn(async () => granted);
  return {
    authz: createApiFixture<AuthzApi>({ hasApiKeyPermission }, "workbench api-key authz"),
    hasApiKeyPermission,
  };
}

const API_KEY_CREDENTIAL: RestCredentialPrincipal = {
  kind: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "org-1",
  projectId: "project-1",
  teamId: "team-1",
};

const LEGACY_PROJECT_KEY_CREDENTIAL: RestCredentialPrincipal = { kind: "legacyProjectKey" };

function dataPrivacyResolving(
  resolve: () => Promise<dataPrivacyContractModule.ResolvedDataPrivacy>,
): { dataPrivacy: DataPrivacyApi; getResolvedForProject: ReturnType<typeof vi.fn> } {
  const getResolvedForProject = vi.fn(resolve);
  return {
    dataPrivacy: createApiFixture<DataPrivacyApi>(
      { getResolvedForProject },
      "workbench data privacy",
    ),
    getResolvedForProject,
  };
}

function projectWith(input: { id: string; lwqlKey: string }): Project {
  return {
    ...input,
    name: "Test project",
    slug: input.id,
    apiKey: "legacy-project-key",
    teamId: "team-1",
    language: "en",
    framework: "other",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

function projectsWith(project: Project | null): {
  projects: ProjectApi;
  findById: ReturnType<typeof vi.fn>;
} {
  const findById = vi.fn(async () => project);
  return { projects: createApiFixture<ProjectApi>({ findById }, "workbench projects"), findById };
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
      const { projects } = projectsWith(projectWith({ id: "project-1", lwqlKey: "lwql-secret" }));

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

describe("resolveApiKeyProtections", () => {
  describe("given a legacy project key", () => {
    /** @scenario "A legacy project key sees costs without an authz lookup, predating RBAC" */
    it("sees costs without asking authz, by credential class alone", async () => {
      const { authz, hasApiKeyPermission } = authzApiKeyAnswering(false);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await resolveApiKeyProtections({
        authz,
        dataPrivacy,
        projectId: "project-1",
        credential: LEGACY_PROJECT_KEY_CREDENTIAL,
      });

      expect(resolved.canSeeCosts).toBe(true);
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });

  describe("given a scoped api key granted cost:view", () => {
    /** @scenario "A scoped api key granted cost:view sees costs" */
    it("sees costs, asked through the credential's own scope", async () => {
      const { authz, hasApiKeyPermission } = authzApiKeyAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await resolveApiKeyProtections({
        authz,
        dataPrivacy,
        projectId: "project-1",
        credential: API_KEY_CREDENTIAL,
      });

      expect(resolved.canSeeCosts).toBe(true);
      expect(hasApiKeyPermission).toHaveBeenCalledWith({
        apiKeyId: "key-1",
        userId: "user-1",
        organizationId: "org-1",
        scope: { type: "project", id: "project-1", teamId: "team-1" },
        permission: "cost:view",
      });
    });
  });

  describe("given a scoped api key denied cost:view", () => {
    /** @scenario "A scoped api key denied cost:view does not see costs" */
    it("does not see costs", async () => {
      const { authz } = authzApiKeyAnswering(false);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await resolveApiKeyProtections({
        authz,
        dataPrivacy,
        projectId: "project-1",
        credential: API_KEY_CREDENTIAL,
      });

      expect(resolved.canSeeCosts).toBe(false);
    });
  });

  describe("given the data-privacy policy read throws", () => {
    /** @scenario "A thrown data-privacy read hides captured content from an api key rather than defaulting it open" */
    it("hides captured content instead of letting the failure widen access", async () => {
      const { authz } = authzApiKeyAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => {
        throw new Error("data-privacy resolver unavailable");
      });

      const resolved = await resolveApiKeyProtections({
        authz,
        dataPrivacy,
        projectId: "project-1",
        credential: API_KEY_CREDENTIAL,
      });

      // Costs are unaffected: only the data-privacy read failed.
      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
      });
    });
  });

  describe("given a policy visible to signed-in members but not to the public", () => {
    /** @scenario "A restrict policy visible to members answers false for an api key, which is never a member" */
    it("answers false — an api key resolves the PUBLIC cut, not the member cut", async () => {
      const { authz } = authzApiKeyAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => ({
        ...PLATFORM_DEFAULT_DATA_PRIVACY,
        categories: {
          ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
          input: {
            disposition: "restrict",
            audience: {
              allMembers: true,
              admins: false,
              members: false,
              viewers: false,
              projectOwner: false,
              groupIds: [],
            },
          },
        },
      }));

      const resolved = await resolveApiKeyProtections({
        authz,
        dataPrivacy,
        projectId: "project-1",
        credential: API_KEY_CREDENTIAL,
      });

      expect(resolved.canSeeCapturedInput).toBe(false);
    });
  });
});

describe("given a job judging a project's own rows", () => {
  describe("when nobody is asking", () => {
    it("reads the public cut of the content and the project's own costs", async () => {
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await resolveProjectProtections({ dataPrivacy, projectId: "project-1" });

      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
      });
    });

    it("hides captured content when the policy cannot be read", async () => {
      const { dataPrivacy } = dataPrivacyResolving(async () => {
        throw new Error("the policy store is away");
      });

      const resolved = await resolveProjectProtections({ dataPrivacy, projectId: "project-1" });

      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
      });
    });
  });
});
