/**
 * The in-process twin of the pending seat role changes: the same week of keeping, the same one
 * waiting change per organization, and the same settle-once rule as Redis.
 * @vitest-environment node
 * @see specs/licensing/role-change-seat.feature
 */
import { describe, expect, it } from "vitest";

import type { PendingSeatRoleChangeRecord } from "../../pending-seat-role-change.repository.ts";
import { MemoryPendingSeatRoleChangeRepository } from "../memory.pending-seat-role-change.repository.ts";

const ORG = "org_acme";
const DAY_MS = 24 * 60 * 60 * 1000;

function change(id: string, invoiceId: string): PendingSeatRoleChangeRecord {
  return {
    id,
    organizationId: ORG,
    userId: `user-${id}`,
    role: "ADMIN",
    requestedBy: { id: "user-ada", name: null, email: null },
    payment: { kind: "invoice", invoiceId, seats: 3 },
    url: "https://pay.example",
    status: "waiting",
    reason: null,
    createdAt: 0,
  };
}

describe("MemoryPendingSeatRoleChangeRepository", () => {
  describe("when a week has passed since the change was saved", () => {
    it("keeps it the day before and reads nothing after", async () => {
      const clock = { now: 0 };
      const pending = MemoryPendingSeatRoleChangeRepository.create({ now: () => clock.now });
      const saved = change("change-a", "in_a");
      await pending.save(saved);

      clock.now = 6 * DAY_MS;
      expect(await pending.findById({ organizationId: ORG, id: saved.id })).toEqual([saved]);
      expect(await pending.findWaitingForOrganization({ organizationId: ORG })).toEqual([saved]);

      clock.now = 7 * DAY_MS;
      expect(await pending.findById({ organizationId: ORG, id: saved.id })).toEqual([]);
      expect(await pending.findWaitingForOrganization({ organizationId: ORG })).toEqual([]);
      expect(await pending.findByPayment({ organizationId: ORG, payment: saved.payment })).toEqual(
        [],
      );
      expect(
        await pending.findLatestForMember({ organizationId: ORG, userId: saved.userId }),
      ).toEqual([]);
    });
  });

  describe("when a claim is held past the claim period", () => {
    it("passes the change on unless its holder renewed the claim, as Redis does", async () => {
      const clock = { now: 0 };
      const pending = MemoryPendingSeatRoleChangeRepository.create({ now: () => clock.now });
      const ref = { organizationId: ORG, id: "change-a" };
      await pending.claim({ ...ref, token: "renewing" });
      await pending.claim({ organizationId: ORG, id: "change-b", token: "silent" });

      clock.now = 100_000;
      expect(await pending.renew({ ...ref, token: "renewing" })).toBe(true);
      clock.now = 200_000;

      expect(await pending.claim({ ...ref, token: "next" })).toBe(false);
      expect(await pending.claim({ organizationId: ORG, id: "change-b", token: "next" })).toBe(
        true,
      );
      expect(await pending.renew({ organizationId: ORG, id: "change-b", token: "silent" })).toBe(
        false,
      );
    });
  });

  describe("when two changes with different payments are saved for one organization", () => {
    it("reads only the latest as the organization's waiting change, as Redis does", async () => {
      const pending = MemoryPendingSeatRoleChangeRepository.create();
      await pending.save(change("change-a", "in_a"));
      const latest = change("change-b", "in_b");
      await pending.save(latest);

      expect(await pending.findWaitingForOrganization({ organizationId: ORG })).toEqual([latest]);
    });
  });

  describe("when a settled change is settled again", () => {
    it("keeps the first outcome and answers false", async () => {
      const pending = MemoryPendingSeatRoleChangeRepository.create();
      const saved = change("change-a", "in_a");
      await pending.save(saved);

      expect(await pending.settle({ organizationId: ORG, id: saved.id, status: "applied" })).toBe(
        true,
      );
      expect(
        await pending.settle({
          organizationId: ORG,
          id: saved.id,
          status: "seat_only",
          reason: "x",
        }),
      ).toBe(false);
      expect(await pending.findById({ organizationId: ORG, id: saved.id })).toEqual([
        { ...saved, status: "applied", reason: null },
      ]);
    });
  });
});
