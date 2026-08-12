import {
  AuthzEngine,
  type AuthzScopeRef,
  type CollectedBinding,
  type CollectedGrants,
  type ResourceGrant,
} from "@langwatch/authz";
import { describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import type { AuthzGrantsRepository } from "../authz-grants.repository";
import type { AuthzReadRepository } from "../authz-read.repository";
import { AuthzService } from "../authz.service";
import { GrantsService, GrantValidationError } from "../grants.service";

const engine = new AuthzEngine();

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "proj-1";

const traceScope = (
  partial: Partial<Extract<AuthzScopeRef, { type: "resource" }>> = {},
): AuthzScopeRef => ({
  type: "resource",
  kind: "trace",
  id: "trace-1",
  projectId: PROJECT,
  teamId: TEAM,
  organizationId: ORG,
  ...partial,
});

const grantOn = (partial: Partial<ResourceGrant> = {}): ResourceGrant => ({
  kind: "trace",
  id: "trace-1",
  projectId: PROJECT,
  permission: "traces:view",
  audience: { kind: "anyone" },
  ...partial,
});

function makeGrants({
  bindings = [] as CollectedBinding[],
  organizationRole = null as CollectedGrants["organizationRole"],
  isOrgMember = organizationRole != null,
  legacyTeamMemberships = [] as CollectedGrants["legacyTeamMemberships"],
  customRolePermissions = new Map<string, readonly string[]>(),
  principal = { type: "anonymous" } as CollectedGrants["principal"],
}: Partial<CollectedGrants> = {}): CollectedGrants {
  return {
    principal,
    organizationId: ORG,
    organizationRole,
    isOrgMember,
    bindings,
    legacyTeamMemberships,
    customRolePermissions,
  };
}

const binding = (
  partial: Partial<CollectedBinding> &
    Pick<CollectedBinding, "scopeType" | "scopeId">,
): CollectedBinding => ({
  role: "MEMBER",
  customRoleId: null,
  viaGroupId: null,
  ...partial,
});

/** A reader whose every method resolves empty; tests override the reads
 *  their scenario turns on. */
function makeReader(
  overrides: Partial<AuthzReadRepository> = {},
): AuthzReadRepository {
  return {
    findOrganizationRole: vi.fn().mockResolvedValue(null),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    findProjectLineage: vi.fn().mockResolvedValue(null),
    findTeamOrganization: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("resource-tier grants (ADR-092 §8)", () => {
  describe("given trace t1 is shared with anyone", () => {
    const resourceGrants = [grantOn()];

    it("grants an anonymous caller traces:view on t1, marked public", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope(),
        resourceGrants,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("resource-grant");
      expect(decision.audience).toBe("public");
    });

    /** @scenario "A share token grants exactly one permission on exactly one resource" */
    it("denies the same caller on a different trace in the same project", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope({ id: "trace-2" }),
        resourceGrants,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("no-membership");
    });

    /** @scenario "A share token grants exactly one permission on exactly one resource" */
    it("denies a permission the grant does not carry", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:update",
        scope: traceScope(),
        resourceGrants,
      });
      expect(decision.allowed).toBe(false);
    });

    /** @scenario "Resource grants are anchored to their project" */
    it("denies a same-id trace anchored to a different project", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope({
          projectId: "proj-other",
          teamId: "team-other",
        }),
        resourceGrants,
      });
      expect(decision.allowed).toBe(false);
    });

    it("keeps a project member on the binding path, audience member", () => {
      const decision = engine.decide({
        grants: makeGrants({
          principal: { type: "user", id: "user-1" },
          organizationRole: "MEMBER",
          bindings: [binding({ scopeType: "PROJECT", scopeId: PROJECT })],
        }),
        permission: "traces:view",
        scope: traceScope(),
        resourceGrants,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("binding");
      expect(decision.audience).toBe("member");
    });
  });

  describe("given a shared thread and a trace inside it", () => {
    const resourceGrants = [grantOn({ kind: "thread", id: "thread-1" })];

    /** @scenario "A shared thread covers its traces and their children" */
    it("covers the trace through its parent link — one grant, no child rows", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope({
          parents: [{ kind: "thread", id: "thread-1" }],
        }),
        resourceGrants,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("resource-grant");
    });

    it("does not cover a trace outside the thread", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope(),
        resourceGrants,
      });
      expect(decision.allowed).toBe(false);
    });
  });

  describe("when a grant names each audience kind", () => {
    const checkWith = ({
      audience,
      grants,
    }: {
      audience: ResourceGrant["audience"];
      grants: CollectedGrants;
    }) =>
      engine.decide({
        grants,
        permission: "traces:view",
        scope: traceScope(),
        resourceGrants: [grantOn({ audience })],
      });

    /** @scenario "A resource grant can name any audience" */
    it("user: matches only that signed-in user", () => {
      const audience = { kind: "user", id: "user-1" } as const;
      const dave = makeGrants({ principal: { type: "user", id: "user-1" } });
      const other = makeGrants({ principal: { type: "user", id: "user-2" } });
      expect(checkWith({ audience, grants: dave }).allowed).toBe(true);
      expect(checkWith({ audience, grants: dave }).audience).toBe("member");
      expect(checkWith({ audience, grants: other }).allowed).toBe(false);
      expect(checkWith({ audience, grants: makeGrants() }).allowed).toBe(false);
    });

    it("apiKey: matches only that key principal", () => {
      const audience = { kind: "apiKey", id: "key-1" } as const;
      const key = makeGrants({ principal: { type: "apiKey", id: "key-1" } });
      const other = makeGrants({ principal: { type: "apiKey", id: "key-2" } });
      expect(checkWith({ audience, grants: key }).allowed).toBe(true);
      expect(checkWith({ audience, grants: other }).allowed).toBe(false);
    });

    it("team: matches a member of that team, via binding or legacy row", () => {
      const audience = { kind: "team", id: TEAM } as const;
      const viaBinding = makeGrants({
        principal: { type: "user", id: "user-1" },
        bindings: [binding({ scopeType: "TEAM", scopeId: TEAM })],
      });
      const viaLegacy = makeGrants({
        principal: { type: "user", id: "user-1" },
        legacyTeamMemberships: [
          {
            teamId: TEAM,
            role: "VIEWER",
            customRoleId: null,
            isPersonal: false,
          },
        ],
      });
      const otherTeam = makeGrants({
        principal: { type: "user", id: "user-2" },
        bindings: [binding({ scopeType: "TEAM", scopeId: "team-other" })],
      });
      expect(checkWith({ audience, grants: viaBinding }).allowed).toBe(true);
      expect(checkWith({ audience, grants: viaLegacy }).allowed).toBe(true);
      expect(checkWith({ audience, grants: otherTeam }).allowed).toBe(false);
    });

    it("project: matches a caller with a binding on that project", () => {
      const audience = { kind: "project", id: PROJECT } as const;
      const member = makeGrants({
        principal: { type: "user", id: "user-1" },
        bindings: [binding({ scopeType: "PROJECT", scopeId: PROJECT })],
      });
      expect(checkWith({ audience, grants: member }).allowed).toBe(true);
      expect(checkWith({ audience, grants: makeGrants() }).allowed).toBe(false);
    });

    it("organization: matches any org member and nobody else", () => {
      const audience = { kind: "organization", id: ORG } as const;
      const member = makeGrants({
        principal: { type: "user", id: "user-1" },
        organizationRole: "MEMBER",
      });
      const outsider = makeGrants({
        principal: { type: "user", id: "user-2" },
      });
      expect(checkWith({ audience, grants: member }).allowed).toBe(true);
      expect(checkWith({ audience, grants: outsider }).allowed).toBe(false);
      expect(checkWith({ audience, grants: makeGrants() }).allowed).toBe(false);
    });

    it("group: matches a caller holding a binding via that group", () => {
      const audience = { kind: "group", id: "group-1" } as const;
      const member = makeGrants({
        principal: { type: "user", id: "user-1" },
        bindings: [
          binding({
            scopeType: "PROJECT",
            scopeId: "proj-other",
            viaGroupId: "group-1",
          }),
        ],
      });
      expect(checkWith({ audience, grants: member }).allowed).toBe(true);
      expect(checkWith({ audience, grants: makeGrants() }).allowed).toBe(false);
    });
  });

  describe("when the scope is not a resource", () => {
    it("ignores resource grants entirely", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: {
          type: "project",
          id: PROJECT,
          teamId: TEAM,
          organizationId: ORG,
        },
        resourceGrants: [grantOn()],
      });
      expect(decision.allowed).toBe(false);
    });
  });

  describe("when the grant and the scope disagree on kind", () => {
    it("a trace grant never covers a thread of the same id", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope({ kind: "thread", id: "x" }),
        resourceGrants: [grantOn({ id: "x" })],
      });
      expect(decision.allowed).toBe(false);
    });
  });
});

describe("collector at the resource tier", () => {
  describe("collectGrants for an anonymous principal", () => {
    it("returns the empty snapshot without touching storage", async () => {
      const reader = makeReader();
      const grants = await new AuthzCollectorService(reader).collectGrants({
        principal: { type: "anonymous" },
        organizationId: ORG,
      });
      expect(grants.bindings).toEqual([]);
      expect(grants.isOrgMember).toBe(false);
      expect(grants.legacyTeamMemberships).toEqual([]);
      expect(reader.findOrganizationRole).not.toHaveBeenCalled();
      expect(reader.findUserBindings).not.toHaveBeenCalled();
    });
  });

  describe("collectResourceGrants (ShareLink shim, ADR-057)", () => {
    const liveRow = {
      resourceType: "TRACE" as const,
      resourceId: "trace-1",
      projectId: PROJECT,
      visibility: "PUBLIC" as const,
      expiresAt: null,
      maxViews: null,
      viewCount: 0,
    };

    it("returns nothing for non-resource scopes without querying", async () => {
      const reader = makeReader();
      const grants = await new AuthzCollectorService(
        reader,
      ).collectResourceGrants({
        scope: {
          type: "project",
          id: PROJECT,
          teamId: TEAM,
          organizationId: ORG,
        },
      });
      expect(grants).toEqual([]);
      expect(reader.findShareLinks).not.toHaveBeenCalled();
    });

    /** @scenario "A share link that is not presented grants nothing" */
    it("returns nothing when no token was presented — possession is the gate", async () => {
      const reader = makeReader();
      const grants = await new AuthzCollectorService(
        reader,
      ).collectResourceGrants({
        scope: traceScope(),
      });
      expect(grants).toEqual([]);
      expect(reader.findShareLinks).not.toHaveBeenCalled();
    });

    it("asks the repository for exactly the presented links, self plus parents", async () => {
      const reader = makeReader({
        findShareLinks: vi
          .fn()
          .mockResolvedValue([
            { ...liveRow, resourceType: "THREAD", resourceId: "thread-1" },
          ]),
      });

      const grants = await new AuthzCollectorService(
        reader,
      ).collectResourceGrants({
        scope: traceScope({
          parents: [{ kind: "thread", id: "thread-1" }],
          shareTokens: ["tok-1"],
        }),
      });

      expect(reader.findShareLinks).toHaveBeenCalledWith({
        projectId: PROJECT,
        tokens: ["tok-1"],
        links: [
          { kind: "trace", id: "trace-1" },
          { kind: "thread", id: "thread-1" },
        ],
      });
      expect(grants).toEqual([
        {
          kind: "thread",
          id: "thread-1",
          projectId: PROJECT,
          permission: "traces:view",
          audience: { kind: "anyone" },
        },
      ]);
    });

    it("maps link visibility onto the matching audience", async () => {
      const reader = makeReader({
        findShareLinks: vi.fn().mockResolvedValue([
          { ...liveRow, visibility: "ORGANIZATION" },
          { ...liveRow, visibility: "PROJECT" },
        ]),
      });
      const grants = await new AuthzCollectorService(
        reader,
      ).collectResourceGrants({
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(grants.map((grant) => grant.audience)).toEqual([
        { kind: "organization", id: ORG },
        { kind: "project", id: PROJECT },
      ]);
    });

    /** @scenario "Expired and view-exhausted share links grant nothing" */
    it("drops expired and view-exhausted links before the engine sees them", async () => {
      const reader = makeReader({
        findShareLinks: vi
          .fn()
          .mockResolvedValue([
            { ...liveRow, expiresAt: new Date(Date.now() - 1000) },
            { ...liveRow, maxViews: 1, viewCount: 1 },
            liveRow,
          ]),
      });
      const grants = await new AuthzCollectorService(
        reader,
      ).collectResourceGrants({
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(grants).toHaveLength(1);
      expect(grants[0]?.audience).toEqual({ kind: "anyone" });
    });
  });
});

describe("resolveResourceScopeRef", () => {
  it("derives the project lineage from storage, never the caller", async () => {
    const reader = makeReader({
      findProjectLineage: vi
        .fn()
        .mockResolvedValue({ teamId: TEAM, organizationId: ORG }),
    });
    const scope = await new AuthzCollectorService(
      reader,
    ).resolveResourceScopeRef({
      projectId: PROJECT,
      kind: "trace",
      id: "trace-1",
      parentThreadId: "thread-1",
      shareTokens: ["tok-1"],
    });
    expect(scope).toEqual({
      type: "resource",
      kind: "trace",
      id: "trace-1",
      parents: [{ kind: "thread", id: "thread-1" }],
      shareTokens: ["tok-1"],
      projectId: PROJECT,
      teamId: TEAM,
      organizationId: ORG,
    });
    expect(reader.findProjectLineage).toHaveBeenCalledWith({
      projectId: PROJECT,
    });
  });

  it("returns null for an unknown project", async () => {
    const reader = makeReader();
    expect(
      await new AuthzCollectorService(reader).resolveResourceScopeRef({
        projectId: "proj-ghost",
        kind: "trace",
        id: "trace-1",
      }),
    ).toBeNull();
  });

  it("gives a thread no parents — threads are the top of the shareable tree", async () => {
    const reader = makeReader({
      findProjectLineage: vi
        .fn()
        .mockResolvedValue({ teamId: TEAM, organizationId: ORG }),
    });
    const scope = await new AuthzCollectorService(
      reader,
    ).resolveResourceScopeRef({
      projectId: PROJECT,
      kind: "thread",
      id: "thread-1",
      parentThreadId: "thread-9",
    });
    expect(scope).toMatchObject({ kind: "thread", parents: undefined });
  });
});

describe("AuthzService on a resource scope", () => {
  describe("given a live public share link for trace t1 and no session", () => {
    const reader = makeReader({
      findShareLinks: vi.fn().mockResolvedValue([
        {
          resourceType: "TRACE",
          resourceId: "trace-1",
          projectId: PROJECT,
          visibility: "PUBLIC",
          expiresAt: null,
          maxViews: null,
          viewCount: 0,
        },
      ]),
    });
    const authz = new AuthzService(new AuthzCollectorService(reader));

    it("check() walks token collection through to a public grant", async () => {
      const decision = await authz.check({
        principal: { type: "anonymous" },
        permission: "traces:view",
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("resource-grant");
      expect(decision.audience).toBe("public");
    });

    it("effectivePermissions() is exactly the shared permission", async () => {
      const permissions = await authz.effectivePermissions({
        principal: { type: "anonymous" },
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(permissions).toEqual(["traces:view"]);
    });
  });
});

describe("GrantsService and resource scopes", () => {
  const makeService = () =>
    new GrantsService({} as AuthzGrantsRepository, {
      audit: vi.fn().mockResolvedValue(undefined),
      newBindingId: () => "rb_test",
      bumpEpoch: vi.fn().mockResolvedValue(undefined),
    });

  describe("when a role binding is attached at a resource scope", () => {
    /** @scenario "Resource-tier access is granted by sharing, never by a role binding" */
    it("rejects before touching storage — shares are not bindings", async () => {
      await expect(
        makeService().attach({
          actor: { userId: "admin-1" },
          who: { type: "user", id: "user-1" },
          role: { builtin: "MEMBER" },
          where: traceScope(),
        }),
      ).rejects.toBeInstanceOf(GrantValidationError);
    });

    /** @scenario "Resource-tier access is granted by sharing, never by a role binding" */
    it("rejects replace() toward a resource scope the same way", async () => {
      await expect(
        makeService().replace({
          actor: { userId: "admin-1" },
          who: { type: "user", id: "user-1" },
          from: { type: "organization", id: ORG },
          to: traceScope(),
          role: { builtin: "MEMBER" },
        }),
      ).rejects.toBeInstanceOf(GrantValidationError);
    });
  });
});
