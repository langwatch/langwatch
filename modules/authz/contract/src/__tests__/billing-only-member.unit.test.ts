/**
 * What a Billing-only member reaches: a Lite membership with the Billing grant at the
 * organization and no team binding (ADR-205).
 * Spec: specs/licensing/billing-only-invite.feature
 */
import { describe, expect, it } from "vitest";

import type { AuthzScopeRef, CollectedBinding, CollectedGrants } from "../authz.ts";
import { AuthzEngine } from "../engine.ts";
import { BILLING_ROLE_KEY } from "../roles.ts";

const engine = new AuthzEngine();
const ORG = "org-1";
const orgScope: AuthzScopeRef = { type: "organization", id: ORG };
const projectScope: AuthzScopeRef = {
  type: "project",
  id: "proj-1",
  teamId: "team-1",
  organizationId: ORG,
};

const billingAtOrganization: CollectedBinding = {
  roleKey: BILLING_ROLE_KEY,
  scopeType: "ORGANIZATION",
  scopeId: ORG,
  viaGroupId: null,
};

function billingOnlyMember({
  bindings = [billingAtOrganization],
  principal = { type: "user", id: "user-payer" },
}: Partial<Pick<CollectedGrants, "bindings" | "principal">> = {}): CollectedGrants {
  return {
    principal,
    organizationId: ORG,
    organizationRole: "EXTERNAL",
    isOrgMember: true,
    membershipDisabled: false,
    bindings,
    customRolePermissions: new Map(),
  };
}

function allowed({
  grants,
  permission,
  scope = orgScope,
}: {
  grants: CollectedGrants;
  permission: string;
  scope?: AuthzScopeRef;
}): boolean {
  return engine.decide({ grants, permission, scope }).allowed;
}

describe("given a Billing-only member", () => {
  const grants = billingOnlyMember();

  it("refuses traces, projects and organization management", () => {
    expect(allowed({ grants, permission: "traces:view", scope: projectScope })).toBe(false);
    expect(allowed({ grants, permission: "project:view", scope: projectScope })).toBe(false);
    expect(allowed({ grants, permission: "organization:manage" })).toBe(false);
  });

  it("allows the subscription, seat requests and the member list", () => {
    expect(allowed({ grants, permission: "subscription:manage" })).toBe(true);
    expect(allowed({ grants, permission: "seatRequests:manage" })).toBe(true);
    expect(allowed({ grants, permission: "members:view" })).toBe(true);
  });

  /** @scenario "A Billing-only member pays the upgrade on Free" */
  it("may start the upgrade checkout", () => {
    expect(allowed({ grants, permission: "subscription:upgrade" })).toBe(true);
  });
});

describe("given Billing reached any other way than a person's own organization grant", () => {
  /** @scenario "Billing only is not granted through a group or an API key" */
  it("confers nothing through a group or on an API key", () => {
    const viaGroup = billingOnlyMember({
      bindings: [{ ...billingAtOrganization, viaGroupId: "grp-1" }],
    });
    const onApiKey = billingOnlyMember({ principal: { type: "apiKey", id: "key-1" } });

    for (const grants of [viaGroup, onApiKey]) {
      expect(allowed({ grants, permission: "subscription:manage" })).toBe(false);
      expect(allowed({ grants, permission: "seatRequests:manage" })).toBe(false);
    }
  });
});
