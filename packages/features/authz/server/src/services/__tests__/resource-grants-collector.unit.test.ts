import { describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub";
import { liveShareLinkRow, ORG, PROJECT, TEAM, traceScope } from "./support/resource-fixtures";

const customRoleBinding = [
  {
    role: "CUSTOM" as const,
    customRoleId: "cr-1",
    scopeType: "PROJECT" as const,
    scopeId: PROJECT,
    viaGroupId: null,
  },
];

describe("collector at the resource tier", () => {
  describe("collectGrants for an anonymous principal", () => {
    it("returns the empty snapshot without touching storage", async () => {
      const reader = makeReader();
      const grants = await AuthzCollectorService.create({
        reader,
      }).collectGrants({
        principal: { type: "anonymous" },
        organizationId: ORG,
      });
      expect(grants.bindings).toEqual([]);
      expect(grants.isOrgMember).toBe(false);
      expect(grants.legacyTeamMemberships).toEqual([]);
      expect(reader.tryFindOrganizationMembership).not.toHaveBeenCalled();
      expect(reader.findUserBindings).not.toHaveBeenCalled();
    });
  });

  describe("collectGrants for an apiKey principal", () => {
    it("reads only the key's bindings — a key has no membership of its own", async () => {
      const reader = makeReader({
        findApiKeyBindings: vi.fn().mockResolvedValue(customRoleBinding),
        findCustomRolePermissions: vi
          .fn()
          .mockResolvedValue([{ id: "cr-1", permissions: ["traces:view"] }]),
      });

      const grants = await AuthzCollectorService.create({
        reader,
      }).collectGrants({
        principal: { type: "apiKey", id: "key-1" },
        organizationId: ORG,
      });

      expect(grants.organizationRole).toBeNull();
      expect(grants.isOrgMember).toBe(false);
      expect(grants.legacyTeamMemberships).toEqual([]);
      expect(reader.tryFindOrganizationMembership).not.toHaveBeenCalled();
      expect(reader.findLegacyTeamMemberships).not.toHaveBeenCalled();
      expect(reader.findCustomRolePermissions).toHaveBeenCalledWith({
        organizationId: ORG,
        principal: { type: "apiKey", id: "key-1" },
        customRoleIds: ["cr-1"],
      });
    });
  });

  describe("when a custom role's stored payload is malformed", () => {
    const collectWith = async (permissions: unknown) => {
      const reader = makeReader({
        tryFindOrganizationMembership: vi
          .fn()
          .mockResolvedValue({ role: "MEMBER", disabled: false }),
        findUserBindings: vi.fn().mockResolvedValue(customRoleBinding),
        findCustomRolePermissions: vi.fn().mockResolvedValue([{ id: "cr-1", permissions }]),
      });
      const grants = await AuthzCollectorService.create({
        reader,
      }).collectGrants({
        principal: { type: "user", id: "alice" },
        organizationId: ORG,
      });
      return grants.customRolePermissions.get("cr-1");
    };

    it("degrades a string payload to no permissions", async () => {
      expect(await collectWith("oops")).toEqual([]);
    });

    it("degrades a null payload to no permissions", async () => {
      expect(await collectWith(null)).toEqual([]);
    });

    it("keeps the string entries of a mixed array and drops the rest", async () => {
      expect(await collectWith(["ok", 42])).toEqual(["ok"]);
    });
  });

  describe("collectResourceGrants (ShareLink shim, ADR-057)", () => {
    it("returns nothing for non-resource scopes without querying", async () => {
      const reader = makeReader();
      const grants = await AuthzCollectorService.create({
        reader,
      }).collectResourceGrants({
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
      const grants = await AuthzCollectorService.create({
        reader,
      }).collectResourceGrants({
        scope: traceScope(),
      });
      expect(grants).toEqual([]);
      expect(reader.findShareLinks).not.toHaveBeenCalled();
    });

    it("asks the repository for exactly the presented links, self plus parents", async () => {
      const reader = makeReader({
        findShareLinks: vi.fn().mockResolvedValue([
          {
            ...liveShareLinkRow,
            resourceType: "THREAD",
            resourceId: "thread-1",
          },
        ]),
      });

      const grants = await AuthzCollectorService.create({
        reader,
      }).collectResourceGrants({
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
          { ...liveShareLinkRow, visibility: "ORGANIZATION" },
          { ...liveShareLinkRow, visibility: "PROJECT" },
        ]),
      });
      const grants = await AuthzCollectorService.create({
        reader,
      }).collectResourceGrants({
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(grants.map((grant) => grant.audience)).toEqual([
        { kind: "organization", id: ORG },
        { kind: "project", id: PROJECT },
      ]);
    });

    it("anchors a project audience to the row's project, not the scope's", async () => {
      // A row can only be reached through a query already scoped to the
      // project, so the two agree in production - but the grant must read
      // its anchor off the row, never off the request-shaped scope.
      const reader = makeReader({
        findShareLinks: vi.fn().mockResolvedValue([
          {
            ...liveShareLinkRow,
            projectId: "proj-from-row",
            visibility: "PROJECT",
          },
        ]),
      });
      const grants = await AuthzCollectorService.create({
        reader,
      }).collectResourceGrants({
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(grants[0]?.projectId).toBe("proj-from-row");
      expect(grants[0]?.audience).toEqual({
        kind: "project",
        id: "proj-from-row",
      });
    });

    /** @scenario "The resource-tier collect never pins an organization's head beyond one read" */
    it("collects share links on a pass-scoped reader, never on the root reader", async () => {
      // The composition root holds ONE collector for the process's
      // lifetime, and a routed reader memoizes its head decision per
      // instance. Reading on the root instance would pin the organization's
      // head until the pod restarted — the binding tier already opens a
      // pass per snapshot, and the resource tier must hold the same line.
      const passReader = makeReader({
        findShareLinks: vi.fn().mockResolvedValue([liveShareLinkRow]),
      });
      const rootReader = makeReader();
      const reader = { ...rootReader, beginPass: vi.fn(() => passReader) };

      const grants = await AuthzCollectorService.create({
        reader,
      }).collectResourceGrants({
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });

      expect(reader.beginPass).toHaveBeenCalledTimes(1);
      expect(passReader.findShareLinks).toHaveBeenCalledTimes(1);
      expect(rootReader.findShareLinks).not.toHaveBeenCalled();
      expect(grants).toHaveLength(1);
    });

    /** @scenario "Expired and view-exhausted share links grant nothing" */
    it("drops expired and view-exhausted links before the engine sees them", async () => {
      const reader = makeReader({
        findShareLinks: vi
          .fn()
          .mockResolvedValue([
            { ...liveShareLinkRow, expiresAt: new Date(Date.now() - 1000) },
            { ...liveShareLinkRow, maxViews: 1, viewCount: 1 },
            liveShareLinkRow,
          ]),
      });
      const grants = await AuthzCollectorService.create({
        reader,
      }).collectResourceGrants({
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(grants).toHaveLength(1);
      expect(grants[0]?.audience).toEqual({ kind: "anyone" });
    });
  });

  describe("given an injected clock at the expiry boundary", () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    const collectAt = async (expiresAt: Date) => {
      const reader = makeReader({
        findShareLinks: vi.fn().mockResolvedValue([{ ...liveShareLinkRow, expiresAt }]),
      });
      return AuthzCollectorService.create({
        reader,
        now: () => now,
      }).collectResourceGrants({
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
    };

    it("drops a link expiring exactly now", async () => {
      expect(await collectAt(new Date(now.getTime()))).toEqual([]);
    });

    it("keeps a link expiring one millisecond from now", async () => {
      expect(await collectAt(new Date(now.getTime() + 1))).toHaveLength(1);
    });
  });
});

describe("tryResolveResourceScopeRef", () => {
  it("derives the project lineage from storage, never the caller", async () => {
    const reader = makeReader({
      tryFindProjectLineage: vi.fn().mockResolvedValue({ teamId: TEAM, organizationId: ORG }),
    });
    const scope = await AuthzCollectorService.create({
      reader,
    }).tryResolveResourceScopeRef({
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
    expect(reader.tryFindProjectLineage).toHaveBeenCalledWith({
      projectId: PROJECT,
    });
  });

  it("returns null for an unknown project", async () => {
    const reader = makeReader();
    expect(
      await AuthzCollectorService.create({ reader }).tryResolveResourceScopeRef({
        projectId: "proj-ghost",
        kind: "trace",
        id: "trace-1",
      }),
    ).toBeNull();
  });

  it("gives a thread no parents — threads are the top of the shareable tree", async () => {
    const reader = makeReader({
      tryFindProjectLineage: vi.fn().mockResolvedValue({ teamId: TEAM, organizationId: ORG }),
    });
    const scope = await AuthzCollectorService.create({
      reader,
    }).tryResolveResourceScopeRef({
      projectId: PROJECT,
      kind: "thread",
      id: "thread-1",
      parentThreadId: "thread-9",
    });
    expect(scope).toMatchObject({ kind: "thread", parents: undefined });
  });
});
