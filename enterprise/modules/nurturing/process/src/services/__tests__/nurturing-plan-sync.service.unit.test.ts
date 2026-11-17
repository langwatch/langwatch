// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 * Which members the plan sync identifies, from nurturing's member copy.
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { NurturingPlanSyncService } from "../nurturing-plan-sync.service.ts";

const change: NurturingSignalOf<"subscription_changed"> = {
  kind: "subscription_changed",
  sourceEventId: "event-1",
  tenantId: "org-1",
  occurredAt: Date.UTC(2026, 8, 29),
  organizationId: "org-1",
  memberUserIds: ["user-1", "user-2"],
  hasSubscription: true,
  plan: "LAUNCH",
};

function planSyncOver(members: MemoryNurturingOrganizationMemberRepository) {
  const sent: CioBatchCall[][] = [];
  const record = async (calls: CioBatchCall[]) => void sent.push(calls);
  const planSync = NurturingPlanSyncService.create({
    customerIo: { batch: record, batchOrThrow: record },
    admins: { adminOf: async () => "admin-1" },
    members,
  });
  return { planSync, sent };
}

describe("NurturingPlanSyncService", () => {
  describe("when a member's only row in the copy is a current one in another organization", () => {
    it("groups the admin and does not identify that member", async () => {
      const members = MemoryNurturingOrganizationMemberRepository.create();
      await members.recordMembershipChange({
        organizationId: "org-2",
        userId: "user-2",
        change: "joined",
        at: 1_000,
      });
      const { planSync, sent } = planSyncOver(members);

      await planSync.planChanged(change);

      expect(sent.flat().map(({ type, userId }) => [type, userId])).toEqual([
        ["group", "admin-1"],
        ["identify", "user-1"],
      ]);
    });
  });
});
