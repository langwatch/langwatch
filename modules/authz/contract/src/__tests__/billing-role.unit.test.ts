/**
 * The Billing role and the directory read every organization role holds.
 * Specs: specs/licensing/billing-role.feature,
 * modules/authz/specs/directory-read-for-every-role.feature
 */
import { describe, expect, it } from "vitest";

import { grantAttachedPayloadSchema } from "../authz-grant.events.ts";
import type { AuthzScopeRef, CollectedBinding, CollectedGrants } from "../authz.ts";
import { AuthzEngine } from "../engine.ts";
import { BILLING_PERMISSIONS, BILLING_ROLE_KEY } from "../roles.ts";

const engine = new AuthzEngine();
const ORG = "org-1";
const TEAM = "team-1";
const orgScope: AuthzScopeRef = { type: "organization", id: ORG };

function makeGrants({
  bindings = [] as CollectedBinding[],
  organizationRole = "MEMBER" as CollectedGrants["organizationRole"],
  principal = { type: "user", id: "user-1" } as CollectedGrants["principal"],
}: Partial<CollectedGrants> = {}): CollectedGrants {
  return {
    principal,
    organizationId: ORG,
    organizationRole,
    isOrgMember: organizationRole != null,
    membershipDisabled: false,
    bindings,
    customRolePermissions: new Map(),
  };
}

const billingAtOrganization: CollectedBinding = {
  roleKey: BILLING_ROLE_KEY,
  scopeType: "ORGANIZATION",
  scopeId: ORG,
  viaGroupId: null,
};

function allowed({ grants, permission }: { grants: CollectedGrants; permission: string }) {
  return engine.decide({ grants, permission, scope: orgScope }).allowed;
}

describe("the Billing role", () => {
  it("holds exactly its own bag", () => {
    expect([...BILLING_PERMISSIONS].toSorted()).toEqual(
      [
        "members:view",
        "organization:view",
        "seatRequests:manage",
        "seatRequests:view",
        "subscription:manage",
        "subscription:upgrade",
      ].toSorted(),
    );
  });

  describe("given a member who holds Billing on the organization", () => {
    const grants = makeGrants({ bindings: [billingAtOrganization] });

    /** @scenario "A Billing member approves seat requests but cannot invite" */
    it("allows seat requests and the subscription, and refuses organization:manage", () => {
      expect(allowed({ grants, permission: "seatRequests:manage" })).toBe(true);
      expect(allowed({ grants, permission: "subscription:manage" })).toBe(true);
      expect(allowed({ grants, permission: "organization:manage" })).toBe(false);
    });
  });

  describe("given a Lite Member who holds Billing", () => {
    /** @scenario "Billing is not a seat" */
    it("allows subscription:manage without the Lite cap withholding it", () => {
      const grants = makeGrants({
        organizationRole: "EXTERNAL",
        bindings: [billingAtOrganization],
      });
      const decision = engine.decide({
        grants,
        permission: "subscription:manage",
        scope: orgScope,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.denialReason).toBeUndefined();
    });
  });

  describe("given a Billing grant that is not a direct organization grant", () => {
    /** @scenario "Billing confers nothing outside a direct organization grant" */
    it("refuses it through a group, at a team, or on an API key", () => {
      const viaGroup = makeGrants({
        bindings: [{ ...billingAtOrganization, viaGroupId: "grp-1" }],
      });
      const atTeam = makeGrants({
        bindings: [{ ...billingAtOrganization, scopeType: "TEAM", scopeId: TEAM }],
      });
      const onApiKey = makeGrants({
        principal: { type: "apiKey", id: "key-1" },
        bindings: [billingAtOrganization],
      });
      for (const grants of [viaGroup, atTeam, onApiKey]) {
        expect(allowed({ grants, permission: "seatRequests:manage" })).toBe(false);
      }
    });
  });

  describe("when a grant event names Billing", () => {
    const payload = (overrides: Record<string, unknown>) => ({
      grantId: "grant-1",
      principal: { type: "user", id: "user-1" },
      roleKey: BILLING_ROLE_KEY,
      scope: { type: "ORGANIZATION", id: ORG },
      source: "checkout",
      actor: { type: "system", id: "system:billing-checkout" },
      ...overrides,
    });

    it("accepts a user at the organization scope", () => {
      expect(grantAttachedPayloadSchema.validate(payload({}))).toBe(true);
    });

    /** @scenario "A Billing grant below the organization is rejected" */
    it("rejects it at a team scope or for a group", () => {
      expect(
        grantAttachedPayloadSchema.validate(payload({ scope: { type: "TEAM", id: TEAM } })),
      ).toBe(false);
      expect(
        grantAttachedPayloadSchema.validate(payload({ principal: { type: "group", id: "grp-1" } })),
      ).toBe(false);
    });
  });
});

describe("the directory read", () => {
  /** @scenario "A Member lists members and roles" */
  it("allows a Member members:view on the organization", () => {
    expect(allowed({ grants: makeGrants(), permission: "members:view" })).toBe(true);
  });

  /** @scenario "A Lite Member lists members" */
  it("allows a Lite Member members:view on the organization", () => {
    expect(
      allowed({ grants: makeGrants({ organizationRole: "EXTERNAL" }), permission: "members:view" }),
    ).toBe(true);
  });

  /** @scenario "A Member cannot change a role" */
  it("refuses a Member organization:manage", () => {
    expect(allowed({ grants: makeGrants(), permission: "organization:manage" })).toBe(false);
  });
});
