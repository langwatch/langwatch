/**
 * ADR-201 §2: the setting that keeps braids to organisation admins is read on every user
 * snapshot, and a failed read refuses rather than reading as "off".
 * Spec: modules/authz/specs/braids.feature
 */
import type { CollectedBinding } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub.ts";
import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub.ts";
import { MemoryAuthzOrganizationPolicyRepository } from "../../repositories/memory/memory.authz-organization-policy.repository.ts";
import { AuthzCollectorService } from "../authz-collector.service.ts";
import { AuthzService } from "../authz.service.ts";

const ORG = "org_acme";
const SPECIALISTS = { projectId: "proj_specialists", teamId: "team_agents", organizationId: ORG };
const teamAdmin: CollectedBinding = {
  roleKey: "admin",
  scopeType: "TEAM",
  scopeId: "team_agents",
  viaGroupId: null,
};

const reader = () =>
  makeReader({
    findProjectLineage: vi.fn().mockResolvedValue(SPECIALISTS),
    findOrganizationMembership: vi.fn().mockResolvedValue({ role: "MEMBER", disabled: false }),
    findUserBindings: vi.fn().mockResolvedValue([teamAdmin]),
  });

class PolicyStoreDownError extends Error {}
const failingPolicies = {
  getPolicy: () => Promise.reject(new PolicyStoreDownError("policy store unreachable")),
};

describe("AuthzCollectorService reading who may braid", () => {
  describe("given an organisation that keeps braids to its admins", () => {
    it("marks a user's snapshot with the setting", async () => {
      const policies = MemoryAuthzOrganizationPolicyRepository.create();
      await policies.setBraidsOrganizationAdminsOnly({
        organizationId: ORG,
        braidsOrganizationAdminsOnly: true,
        updatedByUserId: "user_ana",
      });

      const grants = await AuthzCollectorService.create({
        reader: reader(),
        policies,
      }).collectGrants({ principal: { type: "user", id: "user_tom" }, organizationId: ORG });

      expect(grants.braidsOrganizationAdminsOnly).toBe(true);
    });
  });

  describe("given the setting cannot be read", () => {
    it("refuses the snapshot rather than reading the setting as off", async () => {
      await expect(
        AuthzCollectorService.create({ reader: reader(), policies: failingPolicies }).collectGrants(
          { principal: { type: "user", id: "user_tom" }, organizationId: ORG },
        ),
      ).rejects.toBeInstanceOf(PolicyStoreDownError);
    });

    /** @scenario "A braid decision whose organisation setting cannot be read is refused" */
    it("refuses a team admin's braid decision rather than allowing it", async () => {
      const authz = AuthzService.create({
        isOnEngine: async () => true,
        repository: reader(),
        policies: failingPolicies,
        listing: new StubAuthzListingRepository(),
        bindings: new StubAuthzManagedGrantRepository(),
      });

      await expect(
        authz.authorizeProjectPermission({
          userId: "user_tom",
          projectId: SPECIALISTS.projectId,
          permission: "braids:manage",
        }),
      ).rejects.toBeInstanceOf(PolicyStoreDownError);
    });
  });
});
