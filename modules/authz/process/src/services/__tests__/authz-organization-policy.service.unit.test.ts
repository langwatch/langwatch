/**
 * ADR-185 §2: an organisation can keep braids to its admins; no row means off, and a change is
 * audited and bumps the epoch.
 * @see modules/authz/specs/braids.feature
 */
import { describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzAuditTrailRepository } from "../../repositories/memory/memory.authz-audit-trail.repository.ts";
import { MemoryAuthzOrganizationPolicyRepository } from "../../repositories/memory/memory.authz-organization-policy.repository.ts";
import { RedisAuthzEpochRepository } from "../../repositories/redis/redis.authz-epoch.repository.ts";
import {
  AuthzOrganizationPolicyService,
  BRAIDS_POLICY_CHANGED_ACTION,
} from "../authz-organization-policy.service.ts";

const ORG = "org_acme";
const ANA = { type: "user", id: "user_ana" } as const;

async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function setup({ epochDown = false } = {}) {
  const memory = AuthzMemoryStore.create();
  let bumps = 0;
  const epoch = RedisAuthzEpochRepository.create({
    redis: {
      get: async () => null,
      incr: async () => (epochDown ? Promise.reject(new Error("down")) : ++bumps),
    } as never,
  });
  const policies = MemoryAuthzOrganizationPolicyRepository.create();
  const service = AuthzOrganizationPolicyService.create({
    policies,
    epoch,
    auditTrail: MemoryAuthzAuditTrailRepository.create({ memory }),
  });
  return { service, policies, memory, bumps: () => bumps };
}

describe("AuthzOrganizationPolicyService", () => {
  describe("given an organisation that never changed who may braid", () => {
    it("reads the setting as off", async () => {
      const { service } = setup();

      expect(await service.getOrganizationPolicy({ organizationId: ORG })).toMatchObject({
        braidsOrganizationAdminsOnly: false,
        updatedByUserId: null,
      });
    });
  });

  describe("when ana keeps braids to the organisation's admins", () => {
    it("stores it, writes the audit entry and moves the epoch", async () => {
      const { service, memory, bumps } = setup();

      const policy = await service.setBraidsPolicy({
        organizationId: ORG,
        braidsOrganizationAdminsOnly: true,
        actor: ANA,
      });

      expect(policy).toMatchObject({
        braidsOrganizationAdminsOnly: true,
        updatedByUserId: "user_ana",
      });
      expect(memory.auditLogs).toEqual([
        expect.objectContaining({
          action: BRAIDS_POLICY_CHANGED_ACTION,
          userId: "user_ana",
          organizationId: ORG,
          metadata: { braidsOrganizationAdminsOnly: true, previous: false },
        }),
      ]);
      expect(bumps()).toBe(1);
    });
  });

  describe("when the epoch cannot move", () => {
    it("keeps the stored setting and reports the failure", async () => {
      const { service, policies } = setup({ epochDown: true });

      expect(
        await refusalOf(
          service.setBraidsPolicy({
            organizationId: ORG,
            braidsOrganizationAdminsOnly: true,
            actor: ANA,
          }),
        ),
      ).toBe("authz_epoch_bump_failed");
      expect((await policies.getPolicy({ organizationId: ORG })).braidsOrganizationAdminsOnly).toBe(
        true,
      );
    });
  });
});
