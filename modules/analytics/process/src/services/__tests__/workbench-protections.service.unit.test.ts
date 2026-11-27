/** @vitest-environment node */

import type { RestCredentialPrincipal } from "@langwatch/authorization";
import { builtinRoleGrants, type AuthzApi } from "@langwatch/authz-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type * as dataPrivacyContractModule from "@langwatch/data-privacy-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { analyticsProof } from "../../repositories/__tests__/analytics-proof.fixture.ts";
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
    projects:
      input.projects ?? createApiFixture<ProjectApi>({ findById: async () => null }, "no project"),
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

/** Input and output both restricted to admins only. */
function bothRestrictedToAdmins(): dataPrivacyContractModule.ResolvedDataPrivacy {
  const adminsOnly = {
    disposition: "restrict" as const,
    audience: {
      allMembers: false,
      admins: true,
      members: false,
      viewers: false,
      projectOwner: false,
      groupIds: [],
    },
  };
  return {
    ...PLATFORM_DEFAULT_DATA_PRIVACY,
    categories: {
      ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
      input: adminsOnly,
      output: adminsOnly,
    },
  };
}

/** Grants every check and records who and where each membership question named. */
function tokenPermissionChecks() {
  const permissionChecks: { userId: string; permission: string; projectId: string | undefined }[] =
    [];
  const { authz } = authzGranting({
    grants: () => true,
    overrides: {
      hasPermission: async ({ userId, permission, projectId }) => {
        permissionChecks.push({ userId, permission, projectId });
        return true;
      },
    },
  });
  return { authz, permissionChecks };
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

const ACCESS_TOKEN_CREDENTIAL: RestCredentialPrincipal = {
  kind: "cliAccessToken",
  userId: "user-1",
  organizationId: "org-1",
  projectId: "project-1",
  teamId: "team-1",
};

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

  describe("given an aggregate whose member project B hides captured input", () => {
    /** @scenario "The strictest member privacy policy applies" */
    it("hides captured input, reading one policy across the aggregate and its members", async () => {
      const { authz } = authzAnswering(true);
      const asked: (readonly string[])[] = [];
      const dataPrivacy = createApiFixture<DataPrivacyApi>(
        {
          getResolvedForProject: async () => PLATFORM_DEFAULT_DATA_PRIVACY,
          getResolvedForProjects: async ({ projectIds }) => {
            asked.push(projectIds);
            return projectIds.includes("project_b")
              ? inputRestrictedTo("nobody")
              : PLATFORM_DEFAULT_DATA_PRIVACY;
          },
        },
        "workbench data privacy",
      );

      const resolved = await serviceOver({ authz, dataPrivacy }).resolveMemberProtections({
        userId: "user-1",
        projectId: "project-1",
        authorization: analyticsProof({
          projectId: "project-1",
          shared: [
            { projectId: "project_a", from: 0 },
            { projectId: "project_b", from: 0 },
          ],
        }),
      });

      expect(asked).toEqual([["project-1", "project_a", "project_b"]]);
      expect(resolved.canSeeCapturedInput).toBe(false);
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
      for (const permission of ["cost:view", "traces:view", "traces:update", "project:manage"]) {
        expect(checks).toContainEqual({ principal: member, permission, scope: PROJECT_SCOPE });
      }
    });
  });

  describe("given input and output restricted to admins", () => {
    /** The real built-in role's grants, so a test cannot drift from what the role holds. */
    function authzAsRole(role: "admin" | "member" | "viewer") {
      return authzGranting({
        grants: ({ permission }) => builtinRoleGrants({ role, permission }),
      });
    }

    /** @scenario "Analytics hides content restricted to admins from a plain member, as the trace view does" */
    it("hides captured content from a project Member, who holds project:update but is no admin", async () => {
      const { dataPrivacy } = dataPrivacyResolving(async () => bothRestrictedToAdmins());

      const resolved = await serviceOver({
        authz: authzAsRole("member").authz,
        dataPrivacy,
      }).resolveMemberProtections({ userId: "user-1", projectId: "project-1" });

      expect(resolved.canSeeCapturedInput).toBe(false);
      expect(resolved.canSeeCapturedOutput).toBe(false);
    });

    /** @scenario "Analytics hides content restricted to admins from a plain member, as the trace view does" */
    it("shows captured content to a project Admin", async () => {
      const { dataPrivacy } = dataPrivacyResolving(async () => bothRestrictedToAdmins());

      const resolved = await serviceOver({
        authz: authzAsRole("admin").authz,
        dataPrivacy,
      }).resolveMemberProtections({ userId: "user-1", projectId: "project-1" });

      expect(resolved.canSeeCapturedInput).toBe(true);
      expect(resolved.canSeeCapturedOutput).toBe(true);
    });

    it("shows captured content restricted to the owner to the member who owns the project", async () => {
      const ownerOnly = {
        disposition: "restrict" as const,
        audience: {
          ...bothRestrictedToAdmins().categories.input.audience,
          admins: false,
          projectOwner: true,
        },
      };
      const { dataPrivacy } = dataPrivacyResolving(async () => ({
        ...PLATFORM_DEFAULT_DATA_PRIVACY,
        categories: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories, input: ownerOnly },
      }));
      const { projects } = projectsWith({
        ...projectWith({ id: "project-1", lwqlKey: "lwql-secret" }),
        ownerUserId: "user-1",
      });

      const resolved = await serviceOver({
        authz: authzAsRole("member").authz,
        dataPrivacy,
        projects,
      }).resolveMemberProtections({ userId: "user-1", projectId: "project-1" });

      expect(resolved.canSeeCapturedInput).toBe(true);
    });

    /** @scenario "Owner-only content stays hidden when a read spans a project the viewer does not own" */
    it("hides owner-only content when the read also spans a project the member does not own", async () => {
      const ownerOnly = {
        disposition: "restrict" as const,
        audience: {
          ...bothRestrictedToAdmins().categories.input.audience,
          admins: false,
          projectOwner: true,
        },
      };
      const dataPrivacy = createApiFixture<DataPrivacyApi>(
        {
          getResolvedForProjects: async () => ({
            ...PLATFORM_DEFAULT_DATA_PRIVACY,
            categories: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories, input: ownerOnly },
          }),
        },
        "workbench data privacy",
      );
      const projects = createApiFixture<ProjectApi>(
        {
          findById: async (id) => ({
            ...projectWith({ id, lwqlKey: "lwql-secret" }),
            ownerUserId: id === "project-1" ? "user-1" : "someone-else",
          }),
        },
        "workbench projects",
      );

      const resolved = await serviceOver({
        authz: authzAsRole("member").authz,
        dataPrivacy,
        projects,
      }).resolveMemberProtections({
        userId: "user-1",
        projectId: "project-1",
        authorization: analyticsProof({
          projectId: "project-1",
          shared: [{ projectId: "project_b", from: 0 }],
        }),
      });

      expect(resolved.canSeeCapturedInput).toBe(false);
    });

    it("hides owner-only content when the project owner read throws", async () => {
      const ownerOnly = {
        disposition: "restrict" as const,
        audience: {
          ...bothRestrictedToAdmins().categories.input.audience,
          admins: false,
          projectOwner: true,
        },
      };
      const { dataPrivacy } = dataPrivacyResolving(async () => ({
        ...PLATFORM_DEFAULT_DATA_PRIVACY,
        categories: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories, input: ownerOnly },
      }));
      const projects = createApiFixture<ProjectApi>(
        { findById: () => Promise.reject(new Error("projects unreadable")) },
        "workbench projects",
      );

      const resolved = await serviceOver({
        authz: authzAsRole("member").authz,
        dataPrivacy,
        projects,
      }).resolveMemberProtections({ userId: "user-1", projectId: "project-1" });

      expect(resolved.canSeeCapturedInput).toBe(false);
    });

    /** The member's built-in role at each project; none where the map names none. */
    function authzWithRoleAt(roleAt: Record<string, "admin" | "member">) {
      return authzGranting({
        grants: ({ permission }) => builtinRoleGrants({ role: "admin", permission }),
        overrides: {
          hasPermission: async ({ permission, projectId }) => {
            const role = projectId === undefined ? undefined : roleAt[projectId];
            return role !== undefined && builtinRoleGrants({ role, permission });
          },
        },
      }).authz;
    }

    function spanningProjectB(roleAt: Record<string, "admin" | "member">) {
      return serviceOver({
        authz: authzWithRoleAt(roleAt),
        dataPrivacy: createApiFixture<DataPrivacyApi>(
          { getResolvedForProjects: async () => bothRestrictedToAdmins() },
          "workbench data privacy",
        ),
      }).resolveMemberProtections({
        userId: "user-1",
        projectId: "project-1",
        authorization: analyticsProof({
          projectId: "project-1",
          shared: [{ projectId: "project_b", from: 0 }],
        }),
      });
    }

    /** @scenario "Admins-only content stays hidden when a read spans a project where the viewer is no admin" */
    it("hides it from this project's Admin when the read also spans a project where they are only a Member", async () => {
      const resolved = await spanningProjectB({ "project-1": "admin", project_b: "member" });

      expect(resolved.canSeeCapturedInput).toBe(false);
      expect(resolved.canSeeCapturedOutput).toBe(false);
    });

    it("shows it to an Admin of every project the read spans", async () => {
      const resolved = await spanningProjectB({ "project-1": "admin", project_b: "admin" });

      expect(resolved.canSeeCapturedInput).toBe(true);
      expect(resolved.canSeeCapturedOutput).toBe(true);
    });

    it("keeps captured content open across the read when they hold no role at the other project", async () => {
      const resolved = await serviceOver({
        authz: authzWithRoleAt({ "project-1": "admin" }),
        dataPrivacy: createApiFixture<DataPrivacyApi>(
          { getResolvedForProjects: async () => PLATFORM_DEFAULT_DATA_PRIVACY },
          "workbench data privacy",
        ),
      }).resolveMemberProtections({
        userId: "user-1",
        projectId: "project-1",
        authorization: analyticsProof({
          projectId: "project-1",
          shared: [{ projectId: "project_b", from: 0 }],
        }),
      });

      expect(resolved.canSeeCapturedInput).toBe(true);
    });

    it("hides captured content from a Viewer", async () => {
      const { dataPrivacy } = dataPrivacyResolving(async () => bothRestrictedToAdmins());

      const resolved = await serviceOver({
        authz: authzAsRole("viewer").authz,
        dataPrivacy,
      }).resolveMemberProtections({ userId: "user-1", projectId: "project-1" });

      expect(resolved.canSeeCapturedInput).toBe(false);
      expect(resolved.canSeeCapturedOutput).toBe(false);
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

  describe("given input restricted to the project owner and a caller who owns the project", () => {
    it("shows the owner the input, read off the project it already loaded", async () => {
      const ownerOnlyInput = {
        ...PLATFORM_DEFAULT_DATA_PRIVACY,
        categories: {
          ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
          input: {
            disposition: "restrict" as const,
            audience: {
              ...bothRestrictedToAdmins().categories.input.audience,
              admins: false,
              projectOwner: true,
            },
          },
        },
      };
      const { dataPrivacy } = dataPrivacyResolving(async () => ownerOnlyInput);
      const { projects, findById } = projectsWith({
        ...projectWith({ id: "project-1", lwqlKey: "lwql-secret" }),
        ownerUserId: "user-1",
      });

      const caller = await serviceOver({
        authz: authzGranting({
          grants: ({ permission }) => builtinRoleGrants({ role: "member", permission }),
        }).authz,
        dataPrivacy,
        projects,
      }).resolveRunCaller({ userId: "user-1", projectId: "project-1" });

      expect(caller.protections.canSeeCapturedInput).toBe(true);
      expect(findById).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given no content audience that names the project owner", () => {
  it("never reads who owns the projects the read spans", async () => {
    const { authz } = authzAnswering(true);
    const dataPrivacy = createApiFixture<DataPrivacyApi>(
      { getResolvedForProjects: async () => bothRestrictedToAdmins() },
      "workbench data privacy",
    );
    const { projects, findById } = projectsWith(null);

    const resolved = await serviceOver({ authz, dataPrivacy, projects }).resolveMemberProtections({
      userId: "user-1",
      projectId: "project-1",
      authorization: analyticsProof({
        projectId: "project-1",
        shared: [{ projectId: "project_b", from: 0 }],
      }),
    });

    expect(resolved.canSeeCapturedInput).toBe(true);
    expect(findById).not.toHaveBeenCalled();
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

  describe("given an admin's project-bound access token and content restricted to admins", () => {
    /** @scenario "A project-bound access token reads captured content as its person" */
    it("shows the content, as the workbench shows it to that admin", async () => {
      const asked = tokenPermissionChecks();
      const { dataPrivacy, getResolvedForProject } = dataPrivacyResolving(async () =>
        bothRestrictedToAdmins(),
      );

      const resolved = await serviceOver({
        authz: asked.authz,
        dataPrivacy,
      }).resolveApiKeyProtections({ projectId: "project-1", credential: ACCESS_TOKEN_CREDENTIAL });

      expect(resolved.canSeeCapturedInput).toBe(true);
      expect(resolved.canSeeCapturedOutput).toBe(true);
      expect(resolved.canSeeCosts).toBe(true);
      expect(asked.permissionChecks).toContainEqual({
        userId: "user-1",
        permission: "project:manage",
        projectId: "project-1",
      });
      expect(asked.permissionChecks.every((c) => c.userId === "user-1")).toBe(true);
      expect(asked.permissionChecks.every((c) => c.projectId === "project-1")).toBe(true);
      expect(getResolvedForProject).toHaveBeenCalledWith({ projectId: "project-1" });
    });
  });

  describe("given an admin's access token and input restricted to a group they are not in", () => {
    it("hides the input, as the workbench hides it from that admin", async () => {
      const asked = tokenPermissionChecks();
      const { dataPrivacy, getResolvedForProject } = dataPrivacyResolving(async () =>
        inputRestrictedTo("group-a"),
      );

      const resolved = await serviceOver({
        authz: asked.authz,
        dataPrivacy,
      }).resolveApiKeyProtections({ projectId: "project-1", credential: ACCESS_TOKEN_CREDENTIAL });

      expect(resolved.canSeeCapturedInput).toBe(false);
      expect(resolved.canSeeCapturedOutput).toBe(true);
      expect(asked.permissionChecks.every((c) => c.userId === "user-1")).toBe(true);
      expect(getResolvedForProject).toHaveBeenCalledWith({ projectId: "project-1" });
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
