import { LWQL_MAX_MEMBER_PROJECTS } from "@langwatch/analytics-contract/langwatch-ql-limits";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
/**
 * The query door's scope: which projects one API key reads, and what it sees of them.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LangWatchQLQueryScopeService } from "../langwatch-ql-query-scope.service.ts";
import { project } from "./project.fixture.ts";

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
  const checked: string[] = [];
  const service = LangWatchQLQueryScopeService.create({
    projects: createApiFixture<ProjectApi>({
      findById: (id) => Promise.resolve(input.projects.find((p) => p.id === id) ?? null),
      listByOrganization: ({ organizationId, limit, projectIds }) => {
        const data = input.projects.filter(
          (p) =>
            organizationId === ORGANIZATION_ID &&
            !p.archivedAt &&
            (!projectIds || projectIds.includes(p.id)),
        );
        return Promise.resolve({ data, pagination: { page: 1, limit, total: data.length } });
      },
    }),
    authz: createApiFixture<AuthzApi>({
      hasApiKeyPermission: ({ scope, permission }) => {
        asked.push({ projectId: scope.id, permission });
        return Promise.resolve(input.grants[scope.id]?.includes(permission) === true);
      },
      hasPermission: ({ permission, projectId }) => {
        checked.push(projectId ?? "");
        return Promise.resolve(input.grants[projectId ?? ""]?.includes(permission) === true);
      },
      getScope: ({ projectId = "" }) =>
        Promise.resolve({
          type: "project",
          id: projectId,
          teamId: `team-${projectId}`,
          organizationId: ORGANIZATION_ID,
        }),
      can: () => Promise.resolve(false),
      canBatchPermissionsByIds: ({ permissions, projects }) =>
        Promise.resolve({
          organizationRole: null,
          byPermission: new Map(
            permissions.map((permission) => [
              permission,
              {
                teams: new Map(),
                projects: new Map(
                  projects.map(({ projectId }) => [
                    projectId,
                    input.grants[projectId]?.includes(permission) === true,
                  ]),
                ),
              },
            ]),
          ),
        }),
    }),
    dataPrivacy: createApiFixture<DataPrivacyApi>({
      getResolvedForProject: ({ projectId }) =>
        Promise.resolve(input.privacy?.[projectId] ?? PLATFORM_DEFAULT_DATA_PRIVACY),
    }),
  });

  return { service, asked, checked };
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
        catalogue: { permissions: [] },
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
      catalogue: { permissions: ["analytics:view", "cost:view"] },
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

describe("given a run that names one project", () => {
  describe("when the key reads that project among others", () => {
    /** @scenario "A run naming a project reads only that project, under its own protections" */
    it("reads that project alone and redacts by its protections only", async () => {
      const { service, asked } = scopeOver({
        projects: [project("a"), project("b")],
        grants: { a: ["analytics:view", "cost:view"], b: ["analytics:view", "cost:view"] },
        privacy: { b: INPUT_HIDDEN_FROM_THE_PUBLIC },
      });

      const scope = await service.resolve({ reach: KEY, projects: ["a"] });

      expect(scope.projects).toEqual([{ id: "a", lwqlKey: "lwql-a" }]);
      expect(scope.protections.canSeeCapturedInput).toBe(true);
      expect(scope.protections.canSeeCosts).toBe(true);
      expect(asked.some(({ projectId }) => projectId === "b")).toBe(false);
    });
  });

  describe("when no project is named", () => {
    /** @scenario "A run naming no project keeps the key's whole readable scope" */
    it("spans every readable project, the strictest protection across them", async () => {
      const { service } = scopeOver({
        projects: [project("a"), project("b")],
        grants: { a: ["analytics:view"], b: ["analytics:view"] },
        privacy: { b: INPUT_HIDDEN_FROM_THE_PUBLIC },
      });

      const scope = await service.resolve({ reach: KEY });

      expect(scope.projects.map((p) => p.id)).toEqual(["a", "b"]);
      expect(scope.protections.canSeeCapturedInput).toBe(false);
    });
  });

  describe("when the key cannot read the named project", () => {
    /** @scenario "A run naming a project the key cannot read is refused as not found" */
    it("refuses a project of its organization it lacks analytics:view on", async () => {
      const { service } = scopeOver({
        projects: [project("a"), project("b")],
        grants: { a: ["analytics:view"], b: ["cost:view"] },
      });

      await expect(service.resolve({ reach: KEY, projects: ["b"] })).rejects.toMatchObject({
        code: "project_not_found",
      });
    });

    /** @scenario "AC210c Compatibility: a write naming a project that does not exist, lies in another organization or cannot be read is refused alike" */
    it("refuses the same project when asked whether a write may store it", async () => {
      const { service } = scopeOver({
        projects: [project("a"), project("b")],
        grants: { a: ["analytics:view"], b: ["cost:view"] },
      });

      await expect(
        service.assertReadableByKey({ reach: KEY, projectIds: ["a"] }),
      ).resolves.toBeUndefined();
      await expect(
        service.assertReadableByKey({ reach: KEY, projectIds: ["a", "b"] }),
      ).rejects.toMatchObject({ code: "project_not_found" });
    });

    it("refuses a project outside its organization exactly like one that does not exist", async () => {
      const { service } = scopeOver({
        projects: [project("a")],
        grants: { a: ["analytics:view"] },
      });
      const otherOrganization = service.resolve({
        reach: { ...KEY, organizationId: "org-2" },
        projects: ["a"],
      });
      const missing = service.resolve({ reach: KEY, projects: ["nope"] });

      await expect(otherOrganization).rejects.toMatchObject({ code: "project_not_found" });
      await expect(missing).rejects.toMatchObject({ code: "project_not_found" });
    });

    it("refuses the organization's internal governance project", async () => {
      const { service } = scopeOver({
        projects: [project("gov", { kind: "internal_governance" })],
        grants: { gov: ["analytics:view"] },
      });

      await expect(service.resolve({ reach: KEY, projects: ["gov"] })).rejects.toMatchObject({
        code: "project_not_found",
      });
    });
  });

  describe("when a legacy project key names a project", () => {
    it("reads its own project when it names it", async () => {
      const { service } = scopeOver({ projects: [project("a")], grants: {} });

      const scope = await service.resolve({
        reach: { kind: "project", projectId: "a" },
        projects: ["a"],
      });

      expect(scope.projects).toEqual([{ id: "a", lwqlKey: "lwql-a" }]);
    });

    /** @scenario "A run naming a project the key cannot read is refused as not found" */
    it("refuses any other project, existing or not", async () => {
      const { service } = scopeOver({ projects: [project("a"), project("b")], grants: {} });

      await expect(
        service.resolve({ reach: { kind: "project", projectId: "a" }, projects: ["b"] }),
      ).rejects.toMatchObject({ code: "project_not_found" });
    });
  });
});

describe("given a run that names projects", () => {
  const PERMITTED = { a: ["analytics:view"], b: ["analytics:view"] };

  /** @scenario "QP03b An organization, team or personal key that names no project is refused with a 422 naming the field" */
  it("refuses an organization key that names none, when the door requires them", async () => {
    const { service } = scopeOver({ projects: [project("a"), project("b")], grants: PERMITTED });

    const refusal = await service
      .resolve({ reach: KEY, requireProjects: true })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "projects_required",
      httpStatus: 422,
      message: 'Name the projects to query: send `projects`, a list of project ids, or "all"',
    });
  });

  /** @scenario "QP03 A project key reads its own project by default" */
  it("lets a project key read its own project without naming it", async () => {
    const { service } = scopeOver({ projects: [project("a")], grants: {} });

    const scope = await service.resolve({
      reach: { kind: "project", projectId: "a" },
      requireProjects: true,
    });

    expect(scope.projects).toEqual([{ id: "a", lwqlKey: "lwql-a" }]);
  });

  /** @scenario "QP03 A project key reads its own project by default" */
  it("lets a key whose scope is exactly one project read it without naming it", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("b")],
      grants: { a: ["analytics:view"] },
    });

    const scope = await service.resolve({ reach: KEY, requireProjects: true });

    expect(scope.projects).toEqual([{ id: "a", lwqlKey: "lwql-a" }]);
  });

  describe('when a statement asks for "all" the key can read', () => {
    /** @scenario "QP03f projects accepts the word all for every project the caller can read" */
    it("reads the projects it holds analytics:view on, in id order, and echoes that same set", async () => {
      const { service } = scopeOver({
        projects: [project("b"), project("a")],
        grants: PERMITTED,
      });

      const scope = await service.resolveAll({ reach: KEY });

      expect(scope.projects.map(({ id }) => id)).toEqual(["a", "b"]);
    });

    /** @scenario "QP03g The word all never reaches a project the caller cannot read, or another organization" */
    it("leaves out a project of its organization it holds no analytics:view on", async () => {
      const { service } = scopeOver({
        projects: [project("a"), project("b"), project("c")],
        grants: { a: ["analytics:view"], b: ["analytics:view"], c: ["cost:view"] },
      });

      const scope = await service.resolveAll({ reach: KEY });

      expect(scope.projects.map(({ id }) => id)).toEqual(["a", "b"]);
    });

    /** @scenario "QP03g The word all never reaches a project the caller cannot read, or another organization" */
    it("never reads a project of another organization, which the key's organization lacks", async () => {
      const { service } = scopeOver({ projects: [project("a")], grants: PERMITTED });

      await expect(
        service.resolveAll({ reach: { ...KEY, organizationId: "org-2" } }),
      ).rejects.toMatchObject({ code: "project_not_found" });
    });

    /** @scenario "QP03h The word all that resolves to no project, or to more than the cap, is refused" */
    it("refuses with the id-free not-found answer when the key reads no project", async () => {
      const { service } = scopeOver({ projects: [project("a")], grants: {} });

      await expect(service.resolveAll({ reach: KEY })).rejects.toMatchObject({
        code: "project_not_found",
        httpStatus: 404,
      });
    });
  });

  /** @scenario "QP12 A list that names one project twice reads it once, and params keeps the first place" */
  it("reads each named project once, in the order named", async () => {
    const { service } = scopeOver({ projects: [project("a"), project("b")], grants: PERMITTED });

    const scope = await service.resolve({ reach: KEY, projects: ["b", "a", "b"] });

    expect(scope.projects.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  /** @scenario "QP09b The refusal for an unreadable project is byte-identical to the one for a missing project" */
  it("answers an unreadable project and a missing one with the same body, naming neither", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("c")],
      grants: { a: ["analytics:view"] },
    });
    const bodyOf = async (projects: string[]) => {
      const refusal = await service
        .resolve({ reach: KEY, projects })
        .catch((error: unknown) => error);
      const { code, message, meta, httpStatus } = refusal as Record<string, unknown>;

      return JSON.stringify({ code, message, meta, httpStatus });
    };

    const unreadable = await bodyOf(["a", "c"]);
    const missing = await bodyOf(["a", "z"]);

    expect(unreadable).toBe(missing);
    expect(unreadable).not.toMatch(/"c"|"z"|\bc\b|\bz\b/);
  });

  /** @scenario "QP09 One unreadable project in the list refuses the run" */
  it("refuses the whole run when one named project is unreadable", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("c")],
      grants: { a: ["analytics:view"] },
    });

    await expect(service.resolve({ reach: KEY, projects: ["a", "c"] })).rejects.toMatchObject({
      code: "project_not_found",
      httpStatus: 404,
    });
  });

  /** @scenario "QP03d A project key naming another project is refused" */
  it("refuses a project key naming a project of its organization that is not its own", async () => {
    const { service } = scopeOver({ projects: [project("a"), project("b")], grants: {} });

    await expect(
      service.resolve({ reach: { kind: "project", projectId: "a" }, projects: ["b"] }),
    ).rejects.toMatchObject({ code: "project_not_found", httpStatus: 404 });
  });
});

describe("given a member's card that names projects", () => {
  const body = (refusal: unknown) => {
    const { code, message, meta, httpStatus } = refusal as Record<string, unknown>;

    return JSON.stringify({ code, message, meta, httpStatus });
  };
  const refusalOf = (run: Promise<unknown>) => run.catch((error: unknown) => error);

  /** @scenario "AC208d Project: a crafted card run naming another organization's project is refused" */
  it("refuses a project the member cannot read, with the body of a missing one", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("z")],
      grants: { a: ["analytics:view"] },
    });

    const foreign = await refusalOf(
      service.readableByMember({ userId: "user-1", projectIds: ["a", "z"] }),
    );
    const missing = await refusalOf(
      service.readableByMember({ userId: "user-1", projectIds: ["a", "nope"] }),
    );

    expect(foreign).toMatchObject({ code: "project_not_found", httpStatus: 404 });
    expect(body(foreign)).toBe(body(missing));
  });

  /** @scenario "QP10 A hand-made request naming another organization's project is refused" */
  it("gives the key door and the card door the same body for the same refusal", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("z")],
      grants: { a: ["analytics:view"] },
    });

    const card = await refusalOf(service.readableByMember({ userId: "user-1", projectIds: ["z"] }));
    const key = await refusalOf(service.resolve({ reach: KEY, projects: ["z"] }));

    expect(body(card)).toBe(body(key));
  });

  /** @scenario "QP09c Every door gives the same refusal body for the same missing project" */
  it("answers with the code and message alone, naming no project", async () => {
    const { service } = scopeOver({ projects: [project("a")], grants: {} });

    const refusal = await refusalOf(
      service.readableByMember({ userId: "user-1", projectIds: ["a"] }),
    );

    expect(JSON.parse(body(refusal))).toEqual({
      code: "project_not_found",
      message: "Project not found",
      meta: {},
      httpStatus: 404,
    });
  });

  /** @scenario "QP10b A deleted or archived project is refused like a missing one" */
  it("refuses a project gone from the live list as it refuses an unknown id", async () => {
    const archived = { ...project("e"), archivedAt: new Date() } as Project;
    const { service } = scopeOver({
      projects: [project("a"), archived],
      grants: { a: ["analytics:view"], e: ["analytics:view"] },
    });

    const gone = await refusalOf(service.resolve({ reach: KEY, projects: ["a", "e"] }));
    const unknown = await refusalOf(service.resolve({ reach: KEY, projects: ["a", "x"] }));

    expect(body(gone)).toBe(body(unknown));
  });

  /** @scenario "QP11 params.dashboard_context_projects is always a subset of the readable set" */
  it("refuses a widget's stored project once its read access is revoked, and reads the rest", async () => {
    const granted = scopeOver({
      projects: [project("a"), project("c")],
      grants: { a: ["analytics:view"], c: ["analytics:view"] },
    });
    const revoked = scopeOver({
      projects: [project("a"), project("c")],
      grants: { a: ["analytics:view"] },
    });

    expect(
      (await granted.service.resolve({ reach: KEY, projects: ["a", "c"] })).projects,
    ).toHaveLength(2);
    await expect(
      revoked.service.resolve({ reach: KEY, projects: ["a", "c"] }),
    ).rejects.toMatchObject({
      code: "project_not_found",
    });
    expect((await revoked.service.resolve({ reach: KEY, projects: ["a"] })).projects).toEqual([
      { id: "a", lwqlKey: "lwql-a" },
    ]);
  });

  /** @scenario "AC207d Project: a project that gets read access later is read without a new save" */
  it("reads a stored project once the member is given access, with no new save", async () => {
    const before = scopeOver({ projects: [project("c")], grants: {} });
    const after = scopeOver({ projects: [project("c")], grants: { c: ["analytics:view"] } });

    await expect(
      before.service.readableByMember({ userId: "user-1", projectIds: ["c"] }),
    ).rejects.toMatchObject({ code: "project_not_found" });
    expect(await after.service.readableByMember({ userId: "user-1", projectIds: ["c"] })).toEqual([
      { id: "c", lwqlKey: "lwql-c" },
    ]);
  });

  /** @scenario "AC208c Project: an alert or a scheduled report never reads a project its owner cannot" */
  it("refuses a run as an owner without read access, reading nothing from the project", async () => {
    const { service } = scopeOver({ projects: [project("a"), project("c")], grants: {} });

    await expect(
      service.resolveMemberProjects({ userId: "owner-1", projectIds: ["c"] }),
    ).rejects.toMatchObject({ code: "project_not_found", httpStatus: 404 });
  });

  /** @scenario "AC210c Compatibility: a write naming a project that does not exist, lies in another organization or cannot be read is refused alike" */
  it("refuses a missing, a foreign and an unreadable project with one body, wherever it sits in the list", async () => {
    const { service } = scopeOver({
      projects: [project("a"), project("c")],
      grants: { a: ["analytics:view"] },
    });
    const ask = (projectIds: string[]) =>
      refusalOf(service.readableByMember({ userId: "user-1", projectIds }));

    // A project of another organization is one the member holds no grant on: same branch.
    const [missing, unreadable, listedLate] = await Promise.all([
      ask(["x"]),
      ask(["c"]),
      ask(["a", "x"]),
    ]);

    expect(body(missing)).toBe(body(unreadable));
    expect(body(missing)).toBe(body(listedLate));
    expect(JSON.parse(body(missing))).toMatchObject({ code: "project_not_found", httpStatus: 404 });
    expect(body(missing)).not.toMatch(/"x"|"c"/);
  });

  it("refuses an archived and a governance project as it refuses a missing one", async () => {
    const archived = project("e", { archivedAt: new Date() });
    const governance = project("g", { kind: "internal_governance" });
    const { service } = scopeOver({
      projects: [project("a"), archived, governance],
      grants: { a: ["analytics:view"], e: ["analytics:view"], g: ["analytics:view"] },
    });
    const ask = (projectIds: string[]) =>
      refusalOf(service.readableByMember({ userId: "user-1", projectIds }));

    const missing = body(await ask(["x"]));

    expect(body(await ask(["e"]))).toBe(missing);
    expect(body(await ask(["g"]))).toBe(missing);
  });

  it("judges every named project before it refuses, so an early miss costs the same", async () => {
    const { service, checked } = scopeOver({
      projects: [project("a"), project("b")],
      grants: { a: ["analytics:view"], b: ["analytics:view"] },
    });

    await refusalOf(service.readableByMember({ userId: "user-1", projectIds: ["x", "a", "b"] }));

    expect(checked.toSorted()).toEqual(["a", "b", "x"]);
  });

  /** @scenario "AC207c Project: a query stores at most as many projects as a member's list may hold" */
  it("refuses a list over the member cap with a clear message, before any lookup", async () => {
    const { service, checked } = scopeOver({ projects: [], grants: {} });
    const projectIds = Array.from(
      { length: LWQL_MAX_MEMBER_PROJECTS + 1 },
      (_, index) => `p${index}`,
    );

    await expect(service.readableByMember({ userId: "user-1", projectIds })).rejects.toThrow(
      `name at most ${LWQL_MAX_MEMBER_PROJECTS} projects`,
    );
    expect(checked).toEqual([]);
  });

  it("lets an authz outage propagate instead of reading it as a missing project", async () => {
    const outage = new Error("authz unavailable");
    const failing = LangWatchQLQueryScopeService.create({
      projects: createApiFixture<ProjectApi>({ findById: () => Promise.resolve(project("a")) }),
      authz: createApiFixture<AuthzApi>({ hasPermission: () => Promise.reject(outage) }),
      dataPrivacy: createApiFixture<DataPrivacyApi>({}),
    });

    await expect(failing.readableByMember({ userId: "user-1", projectIds: ["a"] })).rejects.toBe(
      outage,
    );
  });
});
