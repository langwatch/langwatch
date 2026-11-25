// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 * Which members the plan sync identifies, from nurturing's member copy.
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import {
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import {
  copiesOver,
  liveMapsOver,
  ownerFact,
} from "../../eventing/__tests__/nurturing-organization-copies.test-helpers.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
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

function planSyncOver(members = MemoryNurturingOrganizationMemberRepository.create()) {
  const sent: CioBatchCall[][] = [];
  const record = async (calls: CioBatchCall[]) => void sent.push(calls);
  const planSync = NurturingPlanSyncService.create({
    customerIo: { batchOrThrow: record },
    admins: { adminOf: async () => ({ kind: "admin", userId: "admin-1" }) },
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

  describe("when Customer.io refuses a live change", () => {
    it("rejects, and sends the change on a retry", async () => {
      const sent: CioBatchCall[][] = [];
      let refusing = true;
      const send = async (calls: CioBatchCall[]) => {
        if (refusing) throw new Error("refused");
        sent.push(calls);
      };
      const planSync = NurturingPlanSyncService.create({
        customerIo: { batchOrThrow: send },
        admins: { adminOf: async () => ({ kind: "admin", userId: "admin-1" }) },
        members: MemoryNurturingOrganizationMemberRepository.create(),
      });

      await expect(planSync.planChanged(change)).rejects.toThrow("refused");

      refusing = false;
      await planSync.planChanged(change);
      expect(sent).toHaveLength(2);
    });
  });

  describe("when the plan fold hands over an organization with no active member", () => {
    it("sends nothing, as nobody is there to tell", async () => {
      const { planSync, sent } = planSyncOver();

      await planSync.planChanged({ ...change, memberUserIds: [] });
      await planSync.planCaughtUp({ ...change, memberUserIds: [], fromCatchUp: true });

      expect(sent).toEqual([]);
    });
  });

  describe("when a catch-up fact meets a member the copy holds no row for", () => {
    /** @scenario "A catch-up fact identifies no member without a member-copy row, a live one still does" */
    it("identifies only the member with a row, still groups the admin, and a live fact identifies both", async () => {
      const members = MemoryNurturingOrganizationMemberRepository.create();
      await members.recordMembershipChange({
        organizationId: "org-1",
        userId: "user-1",
        change: "joined",
        at: 1_000,
      });
      const catchUp = planSyncOver(members);

      await catchUp.planSync.planCaughtUp({ ...change, fromCatchUp: true });

      expect(catchUp.sent.flat().map(({ type, userId }) => [type, userId])).toEqual([
        ["group", "admin-1"],
        ["identify", "user-1"],
      ]);
      const live = planSyncOver(members);

      await live.planSync.planChanged(change);

      expect(live.sent.flat().map(({ type, userId }) => [type, userId])).toEqual([
        ["group", "admin-1"],
        ["identify", "user-1"],
        ["identify", "user-2"],
      ]);
    });
  });

  describe("when a catch-up fact meets a member whose row for this organization records a stale leave", () => {
    it("still identifies them: billing lists them active", async () => {
      const members = MemoryNurturingOrganizationMemberRepository.create();
      for (const [userId, change] of [
        ["user-1", "joined"],
        ["user-2", "joined"],
        ["user-2", "left"],
      ] as const) {
        await members.recordMembershipChange({
          organizationId: "org-1",
          userId,
          change,
          at: change === "left" ? 2_000 : 1_000,
        });
      }
      const { planSync, sent } = planSyncOver(members);

      await planSync.planCaughtUp({ ...change, fromCatchUp: true });

      expect(sent.flat().map(({ type, userId }) => [type, userId])).toEqual([
        ["group", "admin-1"],
        ["identify", "user-1"],
        ["identify", "user-2"],
      ]);
    });
  });

  describe("when a person is in a paid team and their own free organization", () => {
    /** @scenario "A person whose paid team is their latest join is never told free by the resync" */
    it.each<[string, ("org-a" | "org-b")[]]>([
      ["paid team's fact first", ["org-a", "org-b"]],
      ["free organization's fact first", ["org-b", "org-a"]],
    ])("never tells them free once their memberships are listed (%s)", async (_order, order) => {
      // Without the listed members the copy holds no row for alice, so org-b's fact finds her in
      // no other organization (membersWhoseLatestOrganizationIsElsewhere) and identifies her as
      // free. Copying organization's member_listed facts makes her latest organization known.
      const members = MemoryNurturingOrganizationMemberRepository.create();
      const copyMember = liveMapsOver({
        ...copiesOver(MemoryNurturingRepositories.create()),
        members,
      });
      for (const [organizationId, joinedAt] of [
        ["org-b", 1_000],
        ["org-a", 2_000],
      ] as const) {
        await copyMember(
          ownerFact({
            type: ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
            aggregateType: ORGANIZATION_AGGREGATE_TYPE,
            aggregateId: organizationId,
            tenantId: organizationId,
            data: {
              tenantId: organizationId,
              organizationId,
              userId: "alice",
              joinedAt,
              backfilled: true,
              occurredAt: 5_000,
            },
          }),
        );
      }
      const { planSync, sent } = planSyncOver(members);
      const facts: Record<"org-a" | "org-b", NurturingSignalOf<"subscription_changed">> = {
        "org-a": { ...change, organizationId: "org-a", memberUserIds: ["alice"], plan: "LAUNCH" },
        "org-b": {
          ...change,
          organizationId: "org-b",
          memberUserIds: ["alice"],
          plan: "FREE",
          hasSubscription: false,
        },
      };

      for (const organizationId of order) {
        await planSync.planCaughtUp({
          ...facts[organizationId],
          fromCatchUp: true,
        });
      }

      const identifies = sent.flat().filter((call) => call.type === "identify");
      expect(identifies.map(({ userId }) => userId)).toEqual(["alice"]);
      expect(identifies.map((call) => ("traits" in call ? call.traits?.plan : undefined))).toEqual([
        "launch",
      ]);
      expect(sent.flat().filter((call) => call.type === "group")).toHaveLength(2);
    });
  });
});
