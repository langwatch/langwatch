/**
 * The query door's scope: which projects one API key reads, and what it sees of them.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { LangWatchQLQueryScopeService } from "../langwatch-ql-query-scope.service.ts";

const ORGANIZATION_ID = "org-1";
const KEY = {
  kind: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: ORGANIZATION_ID,
} as const;

const INPUT_HIDDEN_FROM_THE_PUBLIC: ResolvedDataPrivacy = {
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
};

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    slug: id,
    apiKey: `legacy-${id}`,
    lwqlKey: `lwql-${id}`,
    teamId: `team-${id}`,
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
    ...overrides,
  };
}

/**
 * An organization of projects, the key's grants per project and permission, and each project's
 * data-privacy policy. Every answer the service asks for is one of these.
 */
function scopeOver(input: {
  projects: readonly Project[];
  grants: Readonly<Record<string, readonly string[]>>;
  privacy?: Readonly<Record<string, ResolvedDataPrivacy>>;
}) {
  const asked: { projectId: string; permission: string }[] = [];
  const service = LangWatchQLQueryScopeService.create({
    projects: createApiFixture<ProjectApi>({
      findById: (id) => Promise.resolve(input.projects.find((p) => p.id === id) ?? null),
      listByOrganization: ({ organizationId, limit }) => {
        const data = input.projects.filter(
          (p) => organizationId === ORGANIZATION_ID && !p.archivedAt,
        );
        return Promise.resolve({ data, pagination: { page: 1, limit, total: data.length } });
      },
    }),
    authz: createApiFixture<AuthzApi>({
      hasApiKeyPermission: ({ scope, permission }) => {
        asked.push({ projectId: scope.id, permission });
        return Promise.resolve(input.grants[scope.id]?.includes(permission) === true);
      },
    }),
    dataPrivacy: createApiFixture<DataPrivacyApi>({
      getResolvedForProject: ({ projectId }) =>
        Promise.resolve(input.privacy?.[projectId] ?? PLATFORM_DEFAULT_DATA_PRIVACY),
    }),
  });

  return { service, asked };
}

describe("given an API key that reaches several projects of its organization", () => {
  /** @scenario "The readable project set is every project the key grants analytics:view on" */
  it("reads exactly the projects it holds analytics:view on", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("b"), project("c")],
      grants: { a: ["analytics:view", "cost:view"], b: ["cost:view"], c: ["analytics:view"] },
    });

    const scope = await service.resolve({ reach: KEY });

    expect(scope.projects).toEqual([
      { id: "a", lwqlKey: "lwql-a" },
      { id: "c", lwqlKey: "lwql-c" },
    ]);
  });

  it("never reads the organization's internal governance project", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("gov", { kind: "internal_governance" })],
      grants: { a: ["analytics:view"], gov: ["analytics:view"] },
    });

    const scope = await service.resolve({ reach: KEY });

    expect(scope.projects.map((p) => p.id)).toEqual(["a"]);
  });

  it("reads exactly one project when the key can read a single one", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("b")],
      grants: { b: ["analytics:view"] },
    });

    const scope = await service.resolve({ reach: KEY });

    expect(scope.projects).toEqual([{ id: "b", lwqlKey: "lwql-b" }]);
  });

  it("asks no grant at all for an organization with no projects", async () => {
    const { service, asked } = scopeOver({ projects: [], grants: {} });

    const scope = await service.resolve({ reach: KEY });

    expect(scope.projects).toEqual([]);
    expect(asked).toEqual([]);
  });

  /** @scenario "The query door resolves any key to its readable-project scope" */
  it("resolves a key holding the permission nowhere to an empty scope that offers no content", async () => {
    const { service } = scopeOver({ projects: [project("a")], grants: {} });

    await expect(service.resolve({ reach: KEY })).resolves.toEqual({
      projects: [],
      protections: {
        canSeeCosts: false,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
      },
    });
  });

  /** @scenario "The query door redacts content to the strictest protection across the readable set" */
  it("offers a content category only when every readable project grants it", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("b")],
      grants: { a: ["analytics:view", "cost:view"], b: ["analytics:view", "cost:view"] },
      privacy: { b: INPUT_HIDDEN_FROM_THE_PUBLIC },
    });

    const scope = await service.resolve({ reach: KEY });

    expect(scope.protections).toEqual({
      canSeeCosts: true,
      canSeeCapturedInput: false,
      canSeeCapturedOutput: true,
    });
  });
});

describe("given a legacy project key", () => {
  /** @scenario "The query door resolves any key to its readable-project scope" */
  it("reads exactly its own project and asks no grant of the key", async () => {
    const { service, asked } = scopeOver({ projects: [project("a"), project("b")], grants: {} });

    const scope = await service.resolve({ reach: { kind: "project", projectId: "a" } });

    expect(scope.projects).toEqual([{ id: "a", lwqlKey: "lwql-a" }]);
    expect(scope.protections.canSeeCosts).toBe(true);
    expect(asked).toEqual([]);
  });

  it("refuses by code when its project no longer exists", async () => {
    const { service } = scopeOver({ projects: [], grants: {} });

    await expect(
      service.resolve({ reach: { kind: "project", projectId: "gone" } }),
    ).rejects.toMatchObject({ code: "project_not_found" });
  });
});
