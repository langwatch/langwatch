import {
  type AuthzScopeRef,
  type CollectedBinding,
  type CollectedGrants,
  decide,
  type ResourceGrant,
} from "@langwatch/authz";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  collectGrants,
  collectResourceGrants,
  resolveResourceScopeRef,
} from "../collector";
import { GrantsService, GrantValidationError } from "../grants";
import { check, effectivePermissions } from "../service";

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

describe("resource-tier grants (ADR-092 §8)", () => {
  describe("given trace t1 is shared with anyone", () => {
    const resourceGrants = [grantOn()];

    it("grants an anonymous caller traces:view on t1, marked public", () => {
      const decision = decide({
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
      const decision = decide({
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
      const decision = decide({
        grants: makeGrants(),
        permission: "traces:update",
        scope: traceScope(),
        resourceGrants,
      });
      expect(decision.allowed).toBe(false);
    });

    /** @scenario "Resource grants are anchored to their project" */
    it("denies a same-id trace anchored to a different project", () => {
      const decision = decide({
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
      const decision = decide({
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
      const decision = decide({
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
      const decision = decide({
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
      decide({
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
      const decision = decide({
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
      const decision = decide({
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
    it("returns the empty snapshot without touching the database", async () => {
      const grants = await collectGrants({
        prisma: {} as PrismaClient,
        principal: { type: "anonymous" },
        organizationId: ORG,
      });
      expect(grants.bindings).toEqual([]);
      expect(grants.isOrgMember).toBe(false);
      expect(grants.legacyTeamMemberships).toEqual([]);
    });
  });

  describe("collectResourceGrants (ShareLink shim, ADR-057)", () => {
    const liveRow = {
      resourceType: "TRACE",
      resourceId: "trace-1",
      projectId: PROJECT,
      visibility: "PUBLIC",
      expiresAt: null,
      maxViews: null,
      viewCount: 0,
    };

    it("returns nothing for non-resource scopes without querying", async () => {
      const grants = await collectResourceGrants({
        prisma: {} as PrismaClient,
        scope: {
          type: "project",
          id: PROJECT,
          teamId: TEAM,
          organizationId: ORG,
        },
      });
      expect(grants).toEqual([]);
    });

    /** @scenario "A share link that is not presented grants nothing" */
    it("returns nothing when no token was presented — possession is the gate", async () => {
      const findMany = vi.fn();
      const prisma = { shareLink: { findMany } } as unknown as PrismaClient;
      const grants = await collectResourceGrants({
        prisma,
        scope: traceScope(),
      });
      expect(grants).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it("reads presented links for the resource and its parents", async () => {
      const findMany = vi
        .fn()
        .mockResolvedValue([
          { ...liveRow, resourceType: "THREAD", resourceId: "thread-1" },
        ]);
      const prisma = { shareLink: { findMany } } as unknown as PrismaClient;

      const grants = await collectResourceGrants({
        prisma,
        scope: traceScope({
          parents: [{ kind: "thread", id: "thread-1" }],
          shareTokens: ["tok-1"],
        }),
      });

      expect(findMany).toHaveBeenCalledWith({
        where: {
          projectId: PROJECT,
          token: { in: ["tok-1"] },
          OR: [
            { resourceType: "TRACE", resourceId: "trace-1" },
            { resourceType: "THREAD", resourceId: "thread-1" },
          ],
        },
        select: {
          resourceType: true,
          resourceId: true,
          projectId: true,
          visibility: true,
          expiresAt: true,
          maxViews: true,
          viewCount: true,
        },
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
      const findMany = vi.fn().mockResolvedValue([
        { ...liveRow, visibility: "ORGANIZATION" },
        { ...liveRow, visibility: "PROJECT" },
      ]);
      const prisma = { shareLink: { findMany } } as unknown as PrismaClient;
      const grants = await collectResourceGrants({
        prisma,
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(grants.map((grant) => grant.audience)).toEqual([
        { kind: "organization", id: ORG },
        { kind: "project", id: PROJECT },
      ]);
    });

    /** @scenario "Expired and view-exhausted share links grant nothing" */
    it("drops expired and view-exhausted links before the engine sees them", async () => {
      const findMany = vi
        .fn()
        .mockResolvedValue([
          { ...liveRow, expiresAt: new Date(Date.now() - 1000) },
          { ...liveRow, maxViews: 1, viewCount: 1 },
          liveRow,
        ]);
      const prisma = { shareLink: { findMany } } as unknown as PrismaClient;
      const grants = await collectResourceGrants({
        prisma,
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(grants).toHaveLength(1);
      expect(grants[0]?.audience).toEqual({ kind: "anyone" });
    });
  });
});

describe("resolveResourceScopeRef", () => {
  it("derives the project lineage from the database, never the caller", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      team: { id: TEAM, organizationId: ORG },
    });
    const prisma = { project: { findUnique } } as unknown as PrismaClient;
    const scope = await resolveResourceScopeRef({
      prisma,
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
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: PROJECT },
      select: { team: { select: { id: true, organizationId: true } } },
    });
  });

  it("returns null for an unknown project", async () => {
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    expect(
      await resolveResourceScopeRef({
        prisma,
        projectId: "proj-ghost",
        kind: "trace",
        id: "trace-1",
      }),
    ).toBeNull();
  });

  it("gives a thread no parents — threads are the top of the shareable tree", async () => {
    const prisma = {
      project: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ team: { id: TEAM, organizationId: ORG } }),
      },
    } as unknown as PrismaClient;
    const scope = await resolveResourceScopeRef({
      prisma,
      projectId: PROJECT,
      kind: "thread",
      id: "thread-1",
      parentThreadId: "thread-9",
    });
    expect(scope).toMatchObject({ kind: "thread", parents: undefined });
  });
});

describe("authz service on a resource scope", () => {
  describe("given a live public share link for trace t1 and no session", () => {
    const prisma = {
      shareLink: {
        findMany: vi.fn().mockResolvedValue([
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
      },
    } as unknown as PrismaClient;

    it("check() walks token collection through to a public grant", async () => {
      const decision = await check({
        prisma,
        principal: { type: "anonymous" },
        permission: "traces:view",
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("resource-grant");
      expect(decision.audience).toBe("public");
    });

    it("effectivePermissions() is exactly the shared permission", async () => {
      const permissions = await effectivePermissions({
        prisma,
        principal: { type: "anonymous" },
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(permissions).toEqual(["traces:view"]);
    });
  });
});

describe("GrantsService and resource scopes", () => {
  describe("when a role binding is attached at a resource scope", () => {
    /** @scenario "Resource-tier access is granted by sharing, never by a role binding" */
    it("rejects before touching storage — shares are not bindings", async () => {
      const service = new GrantsService({} as PrismaClient);
      await expect(
        service.attach({
          actor: { userId: "admin-1" },
          who: { type: "user", id: "user-1" },
          role: { builtin: "MEMBER" },
          where: traceScope(),
        }),
      ).rejects.toBeInstanceOf(GrantValidationError);
    });

    /** @scenario "Resource-tier access is granted by sharing, never by a role binding" */
    it("rejects replace() toward a resource scope the same way", async () => {
      const service = new GrantsService({} as PrismaClient);
      await expect(
        service.replace({
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
