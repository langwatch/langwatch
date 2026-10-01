/** @vitest-environment node */

import type { RestCredentialPrincipal } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type * as dataPrivacyContractModule from "@langwatch/data-privacy-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  WorkbenchProtectionsService,
  type WorkbenchProtectionsDependencies,
} from "../workbench-protections.service.ts";
import {
  authzGranting,
  EVERY_CATALOGUE_PERMISSION,
  NO_CATALOGUE_PERMISSION,
  PROJECT_SCOPE,
} from "./lwql-catalogue-access.fixture.ts";

function serviceOver(
  input: Partial<WorkbenchProtectionsDependencies>,
): WorkbenchProtectionsService {
  return WorkbenchProtectionsService.create({
    authz: input.authz ?? createApiFixture<AuthzApi>({}, "unused authz"),
    dataPrivacy: input.dataPrivacy ?? createApiFixture<DataPrivacyApi>({}, "unused data privacy"),
    projects: input.projects ?? createApiFixture<ProjectApi>({}, "unused projects"),
  });
}

/** Every permission answers the same boolean, so a case only has to name one. */
function authzAnswering(granted: boolean, groupIds: readonly string[] = []) {
  return authzGranting({ grants: () => granted, groupIds });
}

/** A policy restricting input to one group and output to admins only. */
function inputRestrictedTo(groupId: string): dataPrivacyContractModule.ResolvedDataPrivacy {
  const nobody = {
    allMembers: false,
    admins: false,
    members: false,
    viewers: false,
    projectOwner: false,
    groupIds: [],
  };
  return {
    ...PLATFORM_DEFAULT_DATA_PRIVACY,
    categories: {
      ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
      input: { disposition: "restrict", audience: { ...nobody, groupIds: [groupId] } },
      output: { disposition: "restrict", audience: { ...nobody, admins: true } },
    },
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

describe("resolveMemberProtections", () => {
  describe("given a member permitted every declared check", () => {
    /** @scenario "A member permitted every declared check sees costs and captured content" */
    it("sees costs and the default policy's captured content", async () => {
      const { authz } = authzAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveMemberProtections({
        userId: "user-1",
        projectId: "project-1",
      });

      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
        catalogue: EVERY_CATALOGUE_PERMISSION,
      });
    });
  });

  describe("given a member denied every declared check", () => {
    /** @scenario "A member denied every declared check sees neither costs nor captured content" */
    it("sees neither costs nor captured content", async () => {
      const { authz } = authzAnswering(false);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveMemberProtections({
        userId: "user-1",
        projectId: "project-1",
      });

      expect(resolved).toEqual({
        canSeeCosts: false,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        catalogue: NO_CATALOGUE_PERMISSION,
      });
    });

    it("still asks the catalogue and both membership checks for this one project", async () => {
      const { authz, checks } = authzAnswering(false);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      await serviceOver({ authz, dataPrivacy }).resolveMemberProtections({
        userId: "user-1",
        projectId: "project-1",
      });

      const member = { type: "user", id: "user-1" };
      for (const permission of ["cost:view", "traces:view", "project:update"]) {
        expect(checks).toContainEqual({ principal: member, permission, scope: PROJECT_SCOPE });
      }
    });
  });

  describe("given the data-privacy policy read throws", () => {
    /** @scenario "A thrown data-privacy read hides captured content rather than defaulting it open" */
    it("hides captured content instead of letting the failure widen access", async () => {
      const { authz } = authzAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => {
        throw new Error("data-privacy resolver unavailable");
      });

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveMemberProtections({
        userId: "user-1",
        projectId: "project-1",
      });

      // Costs are unaffected: only the data-privacy read failed.
      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        catalogue: EVERY_CATALOGUE_PERMISSION,
      });
    });
  });
});

describe("given a content audience that names a group", () => {
  it("shows the content to a member of that group", async () => {
    const { authz } = authzAnswering(true, ["group-a"]);
    const { dataPrivacy } = dataPrivacyResolving(async () => inputRestrictedTo("group-a"));

    const resolved = await serviceOver({ authz, dataPrivacy }).resolveMemberProtections({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(resolved.canSeeCapturedInput).toBe(true);
    expect(resolved.canSeeCapturedOutput).toBe(true);
  });

  it("hides it from a member of no such group", async () => {
    const { authz } = authzAnswering(true, ["group-b"]);
    const { dataPrivacy } = dataPrivacyResolving(async () => inputRestrictedTo("group-a"));

    const resolved = await serviceOver({ authz, dataPrivacy }).resolveMemberProtections({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(resolved.canSeeCapturedInput).toBe(false);
  });

  it("hides it when the group membership read throws", async () => {
    const { authz } = authzGranting({
      grants: () => true,
      overrides: { getAccessBreakdown: () => Promise.reject(new Error("groups unreadable")) },
    });
    const { dataPrivacy } = dataPrivacyResolving(async () => inputRestrictedTo("group-a"));

    const resolved = await serviceOver({ authz, dataPrivacy }).resolveMemberProtections({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(resolved.canSeeCapturedInput).toBe(false);
  });

  it("does not read groups when no audience names one", async () => {
    const { authz } = authzGranting({
      grants: () => true,
      overrides: { getAccessBreakdown: () => Promise.reject(new Error("groups were read")) },
    });
    const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

    await expect(
      serviceOver({ authz, dataPrivacy }).resolveMemberProtections({
        userId: "user-1",
        projectId: "project-1",
      }),
    ).resolves.toMatchObject({ canSeeCapturedInput: true });
  });
});

describe("resolveRunCaller", () => {
  describe("given a project that no longer exists", () => {
    /** @scenario "A run-caller resolution for a missing project refuses rather than running as no one" */
    it("refuses with project_not_found instead of resolving a caller for it", async () => {
      const { authz } = authzAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);
      const { projects } = projectsWith(null);

      await expect(
        serviceOver({ authz, dataPrivacy, projects }).resolveRunCaller({
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
        serviceOver({ authz, dataPrivacy, projects }).resolveRunCaller({
          userId: "user-1",
          projectId: "project-1",
        }),
      ).resolves.toEqual({
        project: { id: "project-1", lwqlKey: "lwql-secret" },
        protections: {
          canSeeCosts: true,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          catalogue: EVERY_CATALOGUE_PERMISSION,
        },
      });
    });
  });
});

describe("resolveApiKeyProtections", () => {
  describe("given a legacy project key", () => {
    /** @scenario "A legacy project key still reads costs without a grant lookup" */
    it("sees costs without asking authz, by credential class alone", async () => {
      const { authz, checks } = authzAnswering(false);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveApiKeyProtections({
        projectId: "project-1",
        credential: LEGACY_PROJECT_KEY_CREDENTIAL,
      });

      expect(resolved.canSeeCosts).toBe(true);
      expect(resolved.catalogue).toEqual(EVERY_CATALOGUE_PERMISSION);
      expect(checks).toEqual([]);
    });
  });

  describe("given a scoped api key granted cost:view", () => {
    /** @scenario "A key carrying the cost grant reads the query surface with costs" */
    it("sees costs, asked through the credential's own scope", async () => {
      const { authz, checks } = authzAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveApiKeyProtections({
        projectId: "project-1",
        credential: API_KEY_CREDENTIAL,
      });

      expect(resolved.canSeeCosts).toBe(true);
      expect(checks).toContainEqual({
        principal: { type: "apiKey", id: "key-1" },
        permission: "cost:view",
        scope: PROJECT_SCOPE,
      });
    });
  });

  describe("given a scoped api key denied cost:view", () => {
    /** @scenario "A key without the cost grant reads the query surface with costs redacted" */
    it("does not see costs", async () => {
      const { authz } = authzAnswering(false);
      const { dataPrivacy } = dataPrivacyResolving(async () => PLATFORM_DEFAULT_DATA_PRIVACY);

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveApiKeyProtections({
        projectId: "project-1",
        credential: API_KEY_CREDENTIAL,
      });

      expect(resolved.canSeeCosts).toBe(false);
    });
  });

  describe("given the data-privacy policy read throws", () => {
    /** @scenario "A thrown data-privacy read hides captured content from an api key rather than defaulting it open" */
    it("hides captured content instead of letting the failure widen access", async () => {
      const { authz } = authzAnswering(true);
      const { dataPrivacy } = dataPrivacyResolving(async () => {
        throw new Error("data-privacy resolver unavailable");
      });

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveApiKeyProtections({
        projectId: "project-1",
        credential: API_KEY_CREDENTIAL,
      });

      // Costs are unaffected: only the data-privacy read failed.
      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        catalogue: EVERY_CATALOGUE_PERMISSION,
      });
    });
  });

  describe("given a policy visible to signed-in members but not to the public", () => {
    /** @scenario "A restrict policy visible to members answers false for an api key, which is never a member" */
    it("answers false — an api key resolves the PUBLIC cut, not the member cut", async () => {
      const { authz } = authzAnswering(true);
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

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveApiKeyProtections({
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

      const { authz, checks } = authzAnswering(false);

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveProjectProtections({
        projectId: "project-1",
      });

      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
        catalogue: EVERY_CATALOGUE_PERMISSION,
      });
      expect(checks).toEqual([]);
    });

    it("hides captured content when the policy cannot be read", async () => {
      const { dataPrivacy } = dataPrivacyResolving(async () => {
        throw new Error("the policy store is away");
      });

      const { authz } = authzAnswering(false);

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveProjectProtections({
        projectId: "project-1",
      });

      expect(resolved).toEqual({
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        catalogue: EVERY_CATALOGUE_PERMISSION,
      });
    });
  });
});
