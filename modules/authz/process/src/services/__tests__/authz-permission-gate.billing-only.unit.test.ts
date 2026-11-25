/**
 * @vitest-environment node
 * The permission gate refuses a Billing-only member everything but billing, with the
 * `permission_denied` code a caller sees (ADR-205).
 * @see ../../../../../../specs/licensing/billing-only-invite.feature
 */
import type { AuthzPermission } from "@langwatch/authorization";
import {
  AuthzEngine,
  type AuthzScopeRef,
  BILLING_ROLE_KEY,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { AuthzPermissionGateService } from "../authz-permission-gate.service.ts";

const ORG = "org-1";
const engine = new AuthzEngine();
const orgScope = { type: "organization", id: ORG } as const;
const projectScope = {
  type: "project",
  id: "proj-1",
  teamId: "team-1",
  organizationId: ORG,
} as const;

const billingOnlyGrants: CollectedGrants = {
  principal: { type: "user", id: "user-payer" },
  organizationId: ORG,
  organizationRole: "EXTERNAL",
  isOrgMember: true,
  membershipDisabled: false,
  bindings: [
    { roleKey: BILLING_ROLE_KEY, scopeType: "ORGANIZATION", scopeId: ORG, viaGroupId: null },
  ],
  customRolePermissions: new Map(),
};

function gate(): AuthzPermissionGateService {
  const unused = vi.fn(async () => {
    throw new Error("not part of this decision");
  });
  return AuthzPermissionGateService.create({
    check: async ({ permission, scope }: { permission: string; scope: AuthzScopeRef }) =>
      engine.decide({ grants: billingOnlyGrants, permission, scope }),
    proofs: { authorize: unused },
    collector: { findScopeRef: unused },
    can: unused,
    canAnyByIds: unused,
    checkByIds: unused,
    getScope: unused,
  } as never);
}

async function authorize(permission: AuthzPermission, scope: AuthzScopeRef) {
  return gate().authorize({
    principal: billingOnlyGrants.principal,
    permission,
    scope: scope as never,
  });
}

describe("given a Billing-only member", () => {
  describe("when they ask for traces, a project or organization management", () => {
    /** @scenario "A Billing-only member reaches billing and nothing else" */
    it("is refused with permission_denied each time", async () => {
      await expect(authorize("traces:view", projectScope)).rejects.toMatchObject({
        code: "permission_denied",
      });
      await expect(authorize("project:view", projectScope)).rejects.toMatchObject({
        code: "permission_denied",
      });
      await expect(authorize("organization:manage", orgScope)).rejects.toMatchObject({
        code: "permission_denied",
      });
    });
  });

  describe("when they open the subscription, seat requests or the member list", () => {
    /** @scenario "A Billing-only member reaches billing and nothing else" */
    it("is let through", async () => {
      await expect(authorize("subscription:manage", orgScope)).resolves.toBeDefined();
      await expect(authorize("seatRequests:manage", orgScope)).resolves.toBeDefined();
      await expect(authorize("members:view", orgScope)).resolves.toBeDefined();
    });
  });
});
