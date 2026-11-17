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
import { MemoryNurturingOrganizationPlanRepository } from "../../repositories/memory/memory.nurturing-organization-plan.repository.ts";
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

function planSyncOver(
  members = MemoryNurturingOrganizationMemberRepository.create(),
  plans = MemoryNurturingOrganizationPlanRepository.create(),
) {
  const sent: CioBatchCall[][] = [];
  const record = async (calls: CioBatchCall[]) => void sent.push(calls);
  const planSync = NurturingPlanSyncService.create({
    customerIo: { batch: record, batchOrThrow: record },
    admins: { adminOf: async () => ({ kind: "admin", userId: "admin-1" }) },
    members,
    plans,
  });
  return { planSync, sent, plans };
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

  describe("when the plan copy already holds a newer real fact", () => {
    it("sends nothing for an older live fact and keeps the newer one", async () => {
      const { planSync, sent, plans } = planSyncOver();
      const newer = { ...change, occurredAt: change.occurredAt + 1, plan: "GROWTH" };
      await planSync.planChanged(newer);
      sent.length = 0;

      await planSync.planChanged(change);

      expect(sent).toEqual([]);
      await expect(plans.findPlan({ organizationId: "org-1" })).resolves.toMatchObject({
        fact: { plan: "GROWTH" },
      });
    });

    it("sends nothing for a catch-up fact with the same stamp", async () => {
      const { planSync, sent } = planSyncOver();
      await planSync.planChanged(change);
      sent.length = 0;

      await planSync.planCaughtUp({ ...change, fromCatchUp: true });

      expect(sent).toEqual([]);
    });
  });

  describe("when the resync's newer catch-up fact meets an older real one", () => {
    it("sends the catch-up's plan and replaces the copy, so the resync corrects a wrong plan", async () => {
      const { planSync, sent, plans } = planSyncOver();
      await planSync.planChanged({ ...change, plan: "FREE" });
      sent.length = 0;

      const later = { ...change, occurredAt: change.occurredAt + 1, fromCatchUp: true };
      await planSync.planCaughtUp(later);

      const planOf = (call: CioBatchCall) => ("traits" in call ? call.traits?.plan : undefined);
      expect(sent.flat().map(planOf)).toEqual(["launch", "launch", "launch"]);
      await expect(plans.findPlan({ organizationId: "org-1" })).resolves.toMatchObject({
        fact: { plan: "LAUNCH", fromCatchUp: true },
      });
    });
  });
});
