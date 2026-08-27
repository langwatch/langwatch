import { describe, expect, it } from "vitest";
import { AuthzEngine } from "../src/engine";
import type {
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  LegacyTeamMembership,
  ResourceGrant,
} from "../src/authz";

const engine = new AuthzEngine();

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "proj-1";

const projectScope: AuthzScopeRef = {
  type: "project",
  id: PROJECT,
  teamId: TEAM,
  organizationId: ORG,
};
const otherProjectScope: AuthzScopeRef = {
  type: "project",
  id: "proj-other",
  teamId: "team-other",
  organizationId: ORG,
};
const orgScope: AuthzScopeRef = { type: "organization", id: ORG };
const teamScope: AuthzScopeRef = {
  type: "team",
  id: TEAM,
  organizationId: ORG,
};
const TRACE = "trace-1";
const traceScope: Extract<AuthzScopeRef, { type: "resource" }> = {
  type: "resource",
  kind: "trace",
  id: TRACE,
  shareTokens: ["share-token-1"],
  projectId: PROJECT,
  teamId: TEAM,
  organizationId: ORG,
};
const publicTraceGrant: ResourceGrant = {
  kind: "trace",
  id: TRACE,
  projectId: PROJECT,
  permission: "traces:view",
  audience: { kind: "anyone" },
};

function makeGrants({
  bindings = [] as CollectedBinding[],
  organizationRole = "MEMBER" as CollectedGrants["organizationRole"],
  isOrgMember = organizationRole != null,
  legacyTeamMemberships = [] as LegacyTeamMembership[],
  customRolePermissions = new Map<string, readonly string[]>(),
  principal = { type: "user", id: "user-1" } as CollectedGrants["principal"],
  membershipDisabled = false,
}: Partial<CollectedGrants> = {}): CollectedGrants {
  return {
    principal,
    organizationId: ORG,
    organizationRole,
    isOrgMember,
    membershipDisabled,
    bindings,
    legacyTeamMemberships,
    customRolePermissions,
  };
}

const binding = (
  partial: Partial<CollectedBinding> & Pick<CollectedBinding, "scopeType" | "scopeId">,
): CollectedBinding => ({
  role: "MEMBER",
  customRoleId: null,
  viaGroupId: null,
  ...partial,
});

describe("authz engine decide()", () => {
  describe("given an org admin binding and a project viewer binding", () => {
    const bindings = [
      binding({ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG }),
      binding({ role: "VIEWER", scopeType: "PROJECT", scopeId: PROJECT }),
    ];
    const grants = makeGrants({ bindings });

    /** @scenario "Grants are an additive union across scopes" */
    it("grants via the union — the narrower binding is inert", () => {
      const decision = engine.decide({
        grants,
        permission: "traces:update",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("binding");
    });

    /** @scenario "Grants are an additive union across scopes" */
    it("reaches the same verdict with the bindings collected in the other order", () => {
      const decision = engine.decide({
        grants: makeGrants({ bindings: [...bindings].reverse() }),
        permission: "traces:update",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("binding");
    });
  });

  describe("given only a viewer binding on one project", () => {
    const grants = makeGrants({
      bindings: [binding({ role: "VIEWER", scopeType: "PROJECT", scopeId: PROJECT })],
    });

    it("grants view on that project", () => {
      expect(
        engine.decide({
          grants,
          permission: "traces:view",
          scope: projectScope,
        }).allowed,
      ).toBe(true);
    });

    /** @scenario "Narrow access is expressed by granting less, not by overriding" */
    it("denies update on that project", () => {
      const decision = engine.decide({
        grants,
        permission: "traces:update",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("no-binding");
    });

    /** @scenario "Narrow access is expressed by granting less, not by overriding" */
    it("denies everything on a different project (scope chain filter)", () => {
      expect(
        engine.decide({
          grants,
          permission: "traces:view",
          scope: otherProjectScope,
        }).allowed,
      ).toBe(false);
    });
  });

  describe("given the ADR-021 scope fence", () => {
    const customRolePermissions = new Map([["cr-1", ["governance:manage"]]]);

    /** @scenario "A permission can only be granted at scopes where its resource exists" */
    it("never grants an org-exclusive permission from a TEAM binding, even via custom role", () => {
      const grants = makeGrants({
        bindings: [
          binding({
            role: "CUSTOM",
            customRoleId: "cr-1",
            scopeType: "TEAM",
            scopeId: TEAM,
          }),
        ],
        customRolePermissions,
      });
      expect(
        engine.decide({
          grants,
          permission: "governance:manage",
          scope: projectScope,
        }).allowed,
      ).toBe(false);
    });

    it("grants the same permission from an ORGANIZATION binding", () => {
      const grants = makeGrants({
        bindings: [
          binding({
            role: "CUSTOM",
            customRoleId: "cr-1",
            scopeType: "ORGANIZATION",
            scopeId: ORG,
          }),
        ],
        customRolePermissions,
      });
      expect(
        engine.decide({
          grants,
          permission: "governance:manage",
          scope: orgScope,
        }).allowed,
      ).toBe(true);
    });
  });

  describe("given org-scoped built-in bindings (scope-conditional enum semantics)", () => {
    it("ADMIN at org scope grants everything", () => {
      const grants = makeGrants({
        bindings: [binding({ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG })],
      });
      expect(
        engine.decide({
          grants,
          permission: "governance:manage",
          scope: orgScope,
        }).allowed,
      ).toBe(true);
    });

    it("MEMBER at org scope grants only the org-member bag", () => {
      const grants = makeGrants({
        bindings: [binding({ role: "MEMBER", scopeType: "ORGANIZATION", scopeId: ORG })],
      });
      expect(
        engine.decide({
          grants,
          permission: "organization:view",
          scope: orgScope,
        }).allowed,
      ).toBe(true);
      expect(
        engine.decide({
          grants,
          permission: "organization:manage",
          scope: orgScope,
        }).allowed,
      ).toBe(false);
    });
  });

  describe("given a lite member (EXTERNAL org role)", () => {
    /** @scenario "Lite member capability comes from the lite-member role's own grants" */
    it("caps a team MEMBER binding at the lite-member bag", () => {
      const grants = makeGrants({
        organizationRole: "EXTERNAL",
        bindings: [binding({ role: "MEMBER", scopeType: "TEAM", scopeId: TEAM })],
      });
      expect(
        engine.decide({
          grants,
          permission: "annotations:create",
          scope: projectScope,
        }).allowed,
      ).toBe(true);
      const denied = engine.decide({
        grants,
        permission: "datasets:manage",
        scope: projectScope,
      });
      expect(denied.allowed).toBe(false);
      expect(denied.denialReason).toBe("lite-member-restricted");
    });

    it("honours an explicit non-empty custom role over the cap", () => {
      const grants = makeGrants({
        organizationRole: "EXTERNAL",
        bindings: [
          binding({
            role: "CUSTOM",
            customRoleId: "cr-2",
            scopeType: "TEAM",
            scopeId: TEAM,
          }),
        ],
        customRolePermissions: new Map([["cr-2", ["datasets:manage"]]]),
      });
      expect(
        engine.decide({
          grants,
          permission: "datasets:manage",
          scope: projectScope,
        }).allowed,
      ).toBe(true);
    });

    it("skips org-scoped non-CUSTOM bindings entirely", () => {
      const grants = makeGrants({
        organizationRole: "EXTERNAL",
        bindings: [binding({ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG })],
      });
      expect(
        engine.decide({
          grants,
          permission: "datasets:manage",
          scope: projectScope,
        }).allowed,
      ).toBe(false);
    });
  });

  describe("given an empty custom role", () => {
    it("falls through to the viewer-level CUSTOM bag (legacy quirk)", () => {
      const grants = makeGrants({
        bindings: [
          binding({
            role: "CUSTOM",
            customRoleId: "cr-empty",
            scopeType: "TEAM",
            scopeId: TEAM,
          }),
        ],
        customRolePermissions: new Map([["cr-empty", []]]),
      });
      expect(
        engine.decide({
          grants,
          permission: "datasets:view",
          scope: projectScope,
        }).allowed,
      ).toBe(true);
      expect(
        engine.decide({
          grants,
          permission: "datasets:manage",
          scope: projectScope,
        }).allowed,
      ).toBe(false);
    });
  });

  describe("given a pre-bindings user (TeamUser fallback)", () => {
    it("resolves project access through the chain team's legacy row", () => {
      const grants = makeGrants({
        legacyTeamMemberships: [
          {
            teamId: TEAM,
            role: "ADMIN",
            customRoleId: null,
            isPersonal: false,
          },
        ],
      });
      const decision = engine.decide({
        grants,
        permission: "project:delete",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("legacy-team-fallback");
    });

    it("skips the fallback when a chain binding exists", () => {
      const grants = makeGrants({
        bindings: [binding({ role: "VIEWER", scopeType: "PROJECT", scopeId: PROJECT })],
        legacyTeamMemberships: [
          {
            teamId: TEAM,
            role: "ADMIN",
            customRoleId: null,
            isPersonal: false,
          },
        ],
      });
      expect(
        engine.decide({
          grants,
          permission: "project:delete",
          scope: projectScope,
        }).allowed,
      ).toBe(false);
    });

    it("still applies the fallback when only off-chain bindings exist", () => {
      const grants = makeGrants({
        bindings: [
          binding({
            role: "ADMIN",
            scopeType: "PROJECT",
            scopeId: "proj-other",
          }),
        ],
        legacyTeamMemberships: [
          {
            teamId: TEAM,
            role: "ADMIN",
            customRoleId: null,
            isPersonal: false,
          },
        ],
      });
      expect(
        engine.decide({
          grants,
          permission: "project:delete",
          scope: projectScope,
        }).allowed,
      ).toBe(true);
    });
  });

  describe("given org-scope checks (legacy floor, gate, and team union)", () => {
    it("denies non-members outright, bindings or not", () => {
      const grants = makeGrants({
        organizationRole: null,
        isOrgMember: false,
        bindings: [binding({ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG })],
      });
      const decision = engine.decide({
        grants,
        permission: "organization:view",
        scope: orgScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("no-membership");
    });

    it("grants the org-member floor to any member with zero bindings", () => {
      const grants = makeGrants({ organizationRole: "MEMBER" });
      const decision = engine.decide({
        grants,
        permission: "organization:view",
        scope: orgScope,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("org-role-floor");
      expect(
        engine.decide({
          grants,
          permission: "organization:manage",
          scope: orgScope,
        }).allowed,
      ).toBe(false);
    });

    it("unions non-personal legacy team rows on any denial, even with bindings present", () => {
      const grants = makeGrants({
        bindings: [binding({ role: "MEMBER", scopeType: "ORGANIZATION", scopeId: ORG })],
        legacyTeamMemberships: [
          {
            teamId: TEAM,
            role: "ADMIN",
            customRoleId: null,
            isPersonal: false,
          },
        ],
      });
      expect(
        engine.decide({
          grants,
          permission: "gatewayBudgets:manage",
          scope: orgScope,
        }).allowed,
      ).toBe(true);
    });

    it("excludes personal-workspace teams from the org-scope union", () => {
      const grants = makeGrants({
        legacyTeamMemberships: [
          {
            teamId: "personal-team",
            role: "ADMIN",
            customRoleId: null,
            isPersonal: true,
          },
        ],
      });
      expect(
        engine.decide({
          grants,
          permission: "gatewayBudgets:manage",
          scope: orgScope,
        }).allowed,
      ).toBe(false);
    });

    it("never lets the team union grant org-exclusive permissions", () => {
      const grants = makeGrants({
        legacyTeamMemberships: [
          {
            teamId: TEAM,
            role: "ADMIN",
            customRoleId: null,
            isPersonal: false,
          },
        ],
      });
      expect(
        engine.decide({
          grants,
          permission: "organization:manage",
          scope: orgScope,
        }).allowed,
      ).toBe(false);
    });
  });

  describe("given a user with no OrganizationUser row", () => {
    const nonMember = (overrides: Partial<CollectedGrants> = {}) =>
      makeGrants({ organizationRole: null, isOrgMember: false, ...overrides });

    it("denies at project scope despite a PROJECT binding naming them", () => {
      const decision = engine.decide({
        grants: nonMember({
          bindings: [binding({ role: "ADMIN", scopeType: "PROJECT", scopeId: PROJECT })],
        }),
        permission: "traces:view",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("no-membership");
    });

    it("denies at team scope despite a TEAM binding naming them", () => {
      const decision = engine.decide({
        grants: nonMember({
          bindings: [binding({ role: "ADMIN", scopeType: "TEAM", scopeId: TEAM })],
        }),
        permission: "traces:view",
        scope: teamScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("no-membership");
    });

    it("denies at project scope despite a legacy TeamUser row", () => {
      const decision = engine.decide({
        grants: nonMember({
          legacyTeamMemberships: [
            {
              teamId: TEAM,
              role: "ADMIN",
              customRoleId: null,
              isPersonal: false,
            },
          ],
        }),
        permission: "project:delete",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("no-membership");
    });

    it("denies at resource scope despite a leftover binding on the resource's lineage", () => {
      // The membership gate defers on resource scopes so share links stay
      // reachable — but membership-before-bindings must still hold, or a
      // removed member's leftover PROJECT binding reads every trace under it.
      const decision = engine.decide({
        grants: nonMember({
          bindings: [binding({ role: "ADMIN", scopeType: "PROJECT", scopeId: PROJECT })],
        }),
        permission: "traces:view",
        scope: traceScope,
      });
      expect(decision.allowed).toBe(false);
    });

    it("denies at resource scope despite a leftover legacy TeamUser row", () => {
      const decision = engine.decide({
        grants: nonMember({
          legacyTeamMemberships: [
            {
              teamId: TEAM,
              role: "ADMIN",
              customRoleId: null,
              isPersonal: false,
            },
          ],
        }),
        permission: "traces:view",
        scope: traceScope,
      });
      expect(decision.allowed).toBe(false);
    });

    it("still resolves a presented share link through the resource tier", () => {
      const decision = engine.decide({
        grants: nonMember(),
        permission: "traces:view",
        scope: traceScope,
        resourceGrants: [publicTraceGrant],
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("resource-grant");
      expect(decision.audience).toBe("public");
    });
  });

  describe("given several resource grants matching the same trace", () => {
    const orgTraceGrant: ResourceGrant = {
      kind: "trace",
      id: TRACE,
      projectId: PROJECT,
      permission: "traces:view",
      audience: { kind: "organization", id: ORG },
    };
    const decideWith = (resourceGrants: ResourceGrant[]) =>
      engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope,
        resourceGrants,
      });

    it("picks the least-redacting audience whatever order the rows arrive in", () => {
      for (const resourceGrants of [
        [publicTraceGrant, orgTraceGrant],
        [orgTraceGrant, publicTraceGrant],
      ]) {
        const decision = decideWith(resourceGrants);
        expect(decision.allowed).toBe(true);
        expect(decision.via).toBe("resource-grant");
        expect(decision.audience).toBe("member");
      }
    });

    it("falls back to the public audience when only the public grant matches", () => {
      expect(decideWith([publicTraceGrant]).audience).toBe("public");
    });
  });

  describe("given the demo project", () => {
    /** @scenario "The demo project opens for signed-in callers only" */
    it("grants demo-bag permissions to any signed-in caller, and nothing else", () => {
      const grants = makeGrants({
        organizationRole: null,
        isOrgMember: false,
      });
      const view = engine.decide({
        grants,
        permission: "traces:view",
        scope: projectScope,
        demoProjectId: PROJECT,
      });
      expect(view.allowed).toBe(true);
      expect(view.via).toBe("demo-project");
      expect(
        engine.decide({
          grants,
          permission: "traces:update",
          scope: projectScope,
          demoProjectId: PROJECT,
        }).allowed,
      ).toBe(false);
    });

    /** @scenario "The demo project opens for signed-in callers only" */
    it("denies the demo bag to an api-key caller — legacy reaches it from the session path only", () => {
      const decision = engine.decide({
        grants: makeGrants({
          principal: { type: "apiKey", id: "key-1" },
          organizationRole: null,
          isOrgMember: false,
        }),
        permission: "traces:view",
        scope: projectScope,
        demoProjectId: PROJECT,
      });
      expect(decision.allowed).toBe(false);
    });

    /** @scenario "The demo project opens for signed-in callers only" */
    it("denies the demo bag to an anonymous caller — legacy only reaches it behind a session", () => {
      const decision = engine.decide({
        grants: makeGrants({
          principal: { type: "anonymous" },
          organizationRole: null,
          isOrgMember: false,
        }),
        permission: "traces:view",
        scope: projectScope,
        demoProjectId: PROJECT,
      });
      expect(decision.allowed).toBe(false);
    });
  });
});

describe("authz engine decideWithCeiling()", () => {
  const keyGrants = makeGrants({
    principal: { type: "apiKey", id: "key-1" },
    organizationRole: null,
    isOrgMember: false,
    bindings: [binding({ role: "MEMBER", scopeType: "PROJECT", scopeId: PROJECT })],
  });

  describe("given an owner whose access was reduced to viewer", () => {
    const ownerGrants = makeGrants({
      bindings: [binding({ role: "VIEWER", scopeType: "PROJECT", scopeId: PROJECT })],
    });

    /** @scenario "An API key is capped by its owner's current grants" */
    it("denies what the key alone would grant (owner ceiling)", () => {
      const decision = engine.decideWithCeiling({
        keyGrants,
        ownerGrants,
        permission: "datasets:manage",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("owner-ceiling");
    });

    it("still grants what both hold", () => {
      expect(
        engine.decideWithCeiling({
          keyGrants,
          ownerGrants,
          permission: "traces:view",
          scope: projectScope,
        }).allowed,
      ).toBe(true);
    });
  });

  describe("given an owner who holds more than the key", () => {
    const ownerGrants = makeGrants({
      bindings: [binding({ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG })],
    });

    /** @scenario "Promotion does not grow a scoped API key" */
    it("denies what only the owner holds — a scoped key never grows", () => {
      const decision = engine.decideWithCeiling({
        keyGrants,
        ownerGrants,
        permission: "project:delete",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("no-binding");
    });

    /** @scenario "Promotion does not grow a scoped API key" */
    it("allows the owner's own session the same permission — the ceiling is not what denied", () => {
      expect(
        engine.decide({
          grants: ownerGrants,
          permission: "project:delete",
          scope: projectScope,
        }).allowed,
      ).toBe(true);
    });
  });

  describe("given a lite-member owner", () => {
    /** @scenario "A lite member's API key is capped exactly like their session" */
    it("caps the key exactly like the owner's own session", () => {
      const ownerGrants = makeGrants({
        organizationRole: "EXTERNAL",
        bindings: [binding({ role: "MEMBER", scopeType: "TEAM", scopeId: TEAM })],
      });
      const decision = engine.decideWithCeiling({
        keyGrants,
        ownerGrants,
        permission: "datasets:manage",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("owner-ceiling");
    });
  });

  describe("given a service key (no owner)", () => {
    it("applies no ceiling", () => {
      expect(
        engine.decideWithCeiling({
          keyGrants,
          ownerGrants: null,
          permission: "datasets:manage",
          scope: projectScope,
        }).allowed,
      ).toBe(true);
    });
  });
});

describe("authz engine explain()", () => {
  it("renders the walk with the verdict first", () => {
    const grants = makeGrants({
      bindings: [
        binding({
          role: "VIEWER",
          scopeType: "TEAM",
          scopeId: TEAM,
          viaGroupId: "group-9",
        }),
      ],
    });
    const decision = engine.decide({
      grants,
      permission: "datasets:delete",
      scope: projectScope,
    });
    const lines = engine.explain({ decision, grants });
    expect(lines[0]).toContain("DENIED datasets:delete");
    expect(lines.join("\n")).toContain("via group group-9");
    expect(lines.join("\n")).toContain("denial reason: no-binding");
  });
  describe("given a membership an admin disabled to free its seat", () => {
    /**
     * The collector is what turns a disabled row into `isOrgMember: false`
     * (its bindings do not even come back from the reader, which fences on an
     * active membership). These cases pin what the ENGINE then does with that
     * snapshot: deny everywhere a member could act, and say which gate closed.
     */
    const disabled = (
      overrides: Partial<CollectedGrants> = {},
    ): CollectedGrants =>
      makeGrants({
        organizationRole: null,
        isOrgMember: false,
        membershipDisabled: true,
        ...overrides,
      });

    it("denies at organization scope, where a plain member holds the floor", () => {
      const decision = engine.decide({
        grants: disabled(),
        permission: "organization:view",
        scope: orgScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("membership-disabled");
    });

    it("denies at team and project scope", () => {
      for (const scope of [teamScope, projectScope]) {
        const decision = engine.decide({
          grants: disabled(),
          permission: "traces:view",
          scope,
        });
        expect(decision.allowed).toBe(false);
        expect(decision.denialReason).toBe("membership-disabled");
      }
    });

    it("names the disabled seat rather than the absence it causes", () => {
      // Reported as "no-membership" this would tell somebody who IS a member
      // that they are not, and point them at nothing they can do.
      const decision = engine.decide({
        grants: disabled(),
        permission: "traces:view",
        scope: projectScope,
      });
      expect(decision.denialReason).not.toBe("no-membership");
      expect(decision.denialReason).toBe("membership-disabled");
    });

    it("denies even where a stale binding survived on the scope chain", () => {
      // Belt and braces: the reader already withholds these rows. If one ever
      // reaches the engine, membership still decides before bindings do.
      const decision = engine.decide({
        grants: disabled({
          bindings: [binding({ role: "ADMIN", scopeType: "TEAM", scopeId: TEAM })],
        }),
        permission: "project:delete",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("membership-disabled");
    });

    /** @scenario A link that was public to anyone still opens for a disabled member */
    it("still resolves a public share link, which never depended on membership", () => {
      // ADR-057: a link anyone can open is not an organization privilege, so
      // disabling a seat does not close it. It drops to the public audience.
      const decision = engine.decide({
        grants: disabled(),
        permission: "traces:view",
        scope: traceScope,
        resourceGrants: [publicTraceGrant],
      });
      expect(decision.allowed).toBe(true);
      expect(decision.audience).toBe("public");
    });

    /** @scenario A link that was public to anyone still opens for a disabled member */
    it("loses the member-audience share link, which did depend on membership", () => {
      const decision = engine.decide({
        grants: disabled(),
        permission: "traces:view",
        scope: traceScope,
        resourceGrants: [
          {
            kind: "trace",
            id: TRACE,
            projectId: PROJECT,
            permission: "traces:view",
            audience: { kind: "organization", id: ORG },
          },
        ],
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("membership-disabled");
    });

    it("still sees the demo project, which every signed-in user sees", () => {
      // Not an oversight: the demo project is a product tour, granted to any
      // signed-in user before membership is consulted at all. Pinned so the
      // next reader does not "close" it and break the tour for everyone.
      const decision = engine.decide({
        grants: disabled(),
        permission: "traces:view",
        scope: projectScope,
        demoProjectId: PROJECT,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("demo-project");
    });

    /** @scenario A disabled member's API keys stop working */
    it("stops the API keys they own, through the owner ceiling", () => {
      // ADR-092 §9: effective(key) = grants(key) ∩ grants(owner). A disabled
      // owner grants nothing, so their personal keys stop too — which is the
      // point (a revoked person must not keep a live credential), and is the
      // one consequence of disabling that reaches beyond their own session.
      const decision = engine.decideWithCeiling({
        keyGrants: makeGrants({
          principal: { type: "apiKey", id: "key-1" },
          organizationRole: null,
          isOrgMember: false,
          bindings: [
            binding({ role: "ADMIN", scopeType: "TEAM", scopeId: TEAM }),
          ],
        }),
        ownerGrants: disabled(),
        permission: "traces:view",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("owner-ceiling");
    });

    /** @scenario A disabled member's API keys stop working */
    it("leaves a service key alone, because it has no owner to disable", () => {
      const decision = engine.decideWithCeiling({
        keyGrants: makeGrants({
          principal: { type: "apiKey", id: "key-2" },
          organizationRole: null,
          isOrgMember: false,
          bindings: [
            binding({ role: "ADMIN", scopeType: "TEAM", scopeId: TEAM }),
          ],
        }),
        ownerGrants: null,
        permission: "traces:view",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(true);
    });

    it("re-enabling restores access, because nothing else was taken away", () => {
      const decision = engine.decide({
        grants: makeGrants({
          organizationRole: "MEMBER",
          isOrgMember: true,
          membershipDisabled: false,
          bindings: [binding({ role: "ADMIN", scopeType: "TEAM", scopeId: TEAM })],
        }),
        permission: "project:delete",
        scope: projectScope,
      });
      expect(decision.allowed).toBe(true);
    });
  });
});
