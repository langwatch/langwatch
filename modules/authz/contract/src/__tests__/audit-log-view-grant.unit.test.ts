/**
 * Who reads the audit trail: `auditLog:view` at the organization, and again at a project
 * the read is filtered to. Spec: specs/audit-log/audit-log.feature
 */
import { describe, expect, it } from "vitest";

import type { AuthzScopeRef, CollectedBinding, CollectedGrants } from "../authz.ts";
import { AuthzEngine } from "../engine.ts";
import { builtinRoleGrants } from "../roles.ts";

const engine = new AuthzEngine();

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "proj-1";

const orgScope: AuthzScopeRef = { type: "organization", id: ORG };
const projectScope: AuthzScopeRef = {
  type: "project",
  id: PROJECT,
  teamId: TEAM,
  organizationId: ORG,
};

function grantsOf({
  bindings,
  organizationRole = "MEMBER",
  customRolePermissions = new Map<string, readonly string[]>(),
}: {
  bindings: CollectedBinding[];
  organizationRole?: CollectedGrants["organizationRole"];
  customRolePermissions?: Map<string, readonly string[]>;
}): CollectedGrants {
  return {
    principal: { type: "user", id: "user-1" },
    organizationId: ORG,
    organizationRole,
    isOrgMember: true,
    membershipDisabled: false,
    bindings,
    customRolePermissions,
  };
}

function readsTrail({ grants, scope }: { grants: CollectedGrants; scope: AuthzScopeRef }): boolean {
  return engine.decide({ grants, permission: "auditLog:view", scope }).allowed;
}

describe("given the built-in team roles", () => {
  describe.each(["viewer", "member"] as const)("when the holder is a team %s", (roleKey) => {
    const grants = grantsOf({
      bindings: [{ roleKey, scopeType: "TEAM", scopeId: TEAM, viaGroupId: null }],
    });

    /** @scenario "The built-in Viewer and Member roles do not read the audit trail" */
    it("refuses the read at the organization and at a filtered project", () => {
      expect(builtinRoleGrants({ role: roleKey, permission: "auditLog:view" })).toBe(false);
      expect(readsTrail({ grants, scope: orgScope })).toBe(false);
      expect(readsTrail({ grants, scope: projectScope })).toBe(false);
    });
  });

  describe("when the holder is a team admin", () => {
    /** @scenario "An administrator reads the audit trail by default" */
    it("holds the grant on that team's projects", () => {
      const grants = grantsOf({
        bindings: [{ roleKey: "admin", scopeType: "TEAM", scopeId: TEAM, viaGroupId: null }],
      });
      expect(builtinRoleGrants({ role: "admin", permission: "auditLog:view" })).toBe(true);
      expect(readsTrail({ grants, scope: projectScope })).toBe(true);
    });
  });
});

describe("given an organization administrator", () => {
  /** @scenario "An administrator reads the audit trail by default" */
  it("allows the read at the organization and at a filtered project", () => {
    const grants = grantsOf({
      organizationRole: "ADMIN",
      bindings: [{ roleKey: "admin", scopeType: "ORGANIZATION", scopeId: ORG, viaGroupId: null }],
    });
    expect(readsTrail({ grants, scope: orgScope })).toBe(true);
    expect(readsTrail({ grants, scope: projectScope })).toBe(true);
  });
});

describe("given an organization-wide custom role", () => {
  const binding: CollectedBinding = {
    roleKey: "custom:auditor",
    scopeType: "ORGANIZATION",
    scopeId: ORG,
    viaGroupId: null,
  };

  /** @scenario "A custom role can grant the audit trail" */
  it("allows the read when the role lists auditLog:view", () => {
    const grants = grantsOf({
      bindings: [binding],
      customRolePermissions: new Map([["auditor", ["auditLog:view"]]]),
    });
    expect(readsTrail({ grants, scope: orgScope })).toBe(true);
  });

  /** @scenario "A custom role can grant the audit trail" */
  it("refuses the read when the role does not list it", () => {
    const grants = grantsOf({
      bindings: [binding],
      customRolePermissions: new Map([["auditor", ["traces:view"]]]),
    });
    expect(readsTrail({ grants, scope: orgScope })).toBe(false);
  });
});
