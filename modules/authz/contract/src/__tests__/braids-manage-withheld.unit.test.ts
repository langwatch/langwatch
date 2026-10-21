/**
 * ADR-183 §2: who holds braids:manage. A key never does; while an organisation keeps braids to
 * its admins, only an organisation-wide binding confers it.
 * @see modules/authz/specs/braids.feature
 */
import { ALL_PERMISSIONS } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import type { AuthzScopeRef, CollectedBinding, CollectedGrants } from "../authz.ts";
import { AuthzEngine } from "../engine.ts";

const ORG = "org_acme";
const engine = new AuthzEngine();

function project(id: string, teamId: string): AuthzScopeRef {
  return { type: "project", id, teamId, organizationId: ORG };
}
const SPECIALISTS = project("proj_specialists", "team_agents");
const BILLING = project("proj_billing", "team_agents");
const ORCHESTRATOR = project("proj_orchestrator", "team_web");

function grants({
  bindings,
  principal = { type: "user", id: "user_tom" },
  braidsOrganizationAdminsOnly,
  organizationRole = "MEMBER",
}: {
  bindings: CollectedBinding[];
  principal?: CollectedGrants["principal"];
  braidsOrganizationAdminsOnly?: boolean;
  organizationRole?: CollectedGrants["organizationRole"];
}): CollectedGrants {
  return {
    principal,
    organizationId: ORG,
    organizationRole: principal.type === "user" ? organizationRole : null,
    isOrgMember: principal.type === "user",
    membershipDisabled: false,
    ...(braidsOrganizationAdminsOnly === undefined ? {} : { braidsOrganizationAdminsOnly }),
    bindings,
    customRolePermissions: new Map([["role_braider", ["braids:manage", "traces:view"]]]),
  };
}

const teamAdmin: CollectedBinding = {
  roleKey: "admin",
  scopeType: "TEAM",
  scopeId: "team_agents",
  viaGroupId: null,
};
const orgAdmin: CollectedBinding = {
  roleKey: "admin",
  scopeType: "ORGANIZATION",
  scopeId: ORG,
  viaGroupId: null,
};

function braids({ of, at }: { of: CollectedGrants; at: AuthzScopeRef }): boolean {
  return engine.decide({ grants: of, permission: "braids:manage", scope: at }).allowed;
}

describe("who holds braids:manage", () => {
  describe("given an organisation that never changed who may braid", () => {
    /** @scenario "Project admins may braid until the organisation keeps braids to its admins" */
    it("confers it on a team admin", () => {
      expect(braids({ of: grants({ bindings: [teamAdmin] }), at: SPECIALISTS })).toBe(true);
    });

    /** @scenario "A team admin may braid out of every project in that team and no other" */
    it("confers it on every project of the team and on no project of another", () => {
      const tom = grants({ bindings: [teamAdmin] });

      expect(braids({ of: tom, at: SPECIALISTS })).toBe(true);
      expect(braids({ of: tom, at: BILLING })).toBe(true);
      expect(braids({ of: tom, at: ORCHESTRATOR })).toBe(false);
    });

    /** @scenario "A custom role listing braids:manage braids only where it is bound" */
    it("confers it through a custom role only where that role is bound", () => {
      const rui = grants({
        bindings: [
          {
            roleKey: "custom:role_braider",
            scopeType: "PROJECT",
            scopeId: SPECIALISTS.id,
            viaGroupId: null,
          },
        ],
      });

      expect(braids({ of: rui, at: SPECIALISTS })).toBe(true);
      expect(braids({ of: rui, at: ORCHESTRATOR })).toBe(false);
    });
  });

  describe("given the organisation keeps braids to its admins", () => {
    it("withholds it from team and project bindings and leaves their other permissions", () => {
      const projectAdmin: CollectedBinding = {
        roleKey: "admin",
        scopeType: "PROJECT",
        scopeId: SPECIALISTS.id,
        viaGroupId: null,
      };
      const tom = grants({
        bindings: [teamAdmin, projectAdmin],
        braidsOrganizationAdminsOnly: true,
      });

      expect(braids({ of: tom, at: SPECIALISTS })).toBe(false);
      expect(
        engine.decide({ grants: tom, permission: "traces:view", scope: SPECIALISTS }).allowed,
      ).toBe(true);
    });

    it("still confers it through an organisation-wide binding", () => {
      const ana = grants({
        bindings: [orgAdmin],
        principal: { type: "user", id: "user_ana" },
        organizationRole: "ADMIN",
        braidsOrganizationAdminsOnly: true,
      });

      expect(braids({ of: ana, at: SPECIALISTS })).toBe(true);
    });
  });

  describe("given an API key bound as an organisation admin with every permission", () => {
    it("refuses braids:manage at every tier and grants what else it holds", () => {
      const key = grants({
        principal: { type: "apiKey", id: "key_ci" },
        bindings: [
          orgAdmin,
          teamAdmin,
          {
            roleKey: "custom:role_all",
            scopeType: "PROJECT",
            scopeId: SPECIALISTS.id,
            viaGroupId: null,
          },
        ],
      });
      const everything = {
        ...key,
        customRolePermissions: new Map([["role_all", [...ALL_PERMISSIONS]]]),
      };
      const organization: AuthzScopeRef = { type: "organization", id: ORG };
      const team: AuthzScopeRef = { type: "team", id: "team_agents", organizationId: ORG };

      for (const scope of [organization, team, SPECIALISTS, ORCHESTRATOR]) {
        expect(
          engine.decide({ grants: everything, permission: "braids:manage", scope }).allowed,
        ).toBe(false);
      }
      expect(
        engine.decide({ grants: everything, permission: "traces:view", scope: SPECIALISTS })
          .allowed,
      ).toBe(true);
    });
  });
});
