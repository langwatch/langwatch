/**
 * @vitest-environment node
 * The seat twin reads a held seat by the rule the cap counts by (seat-rotation.feature), so the
 * seat peak's holds and the cap cannot disagree (ADR-002).
 */
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { nowInstant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationSeatRepository } from "../memory/memory.organization-seat.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ACME = "org_acme";
const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

function seeded() {
  const memory = MemoryOrganizationDatabase.create();
  for (const userId of ["ada", "mia"]) {
    memory.users.set(userId, {
      id: userId,
      name: userId,
      email: `${userId}@acme.com`,
      deactivatedAt: null,
    });
    memory.organizationUsers.push({
      userId,
      organizationId: ACME,
      role: OrganizationUserRole.MEMBER,
      disabledAt: null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
  }
  const heldUntil = nowInstant().add({ hours: 24 * 30 });
  memory.seatHolds.push({
    organizationId: ACME,
    userId: "linus",
    email: "linus@acme.com",
    name: "Linus",
    seatTakenAt: EPOCH,
    heldUntil,
    reason: "REMOVED",
  });
  return { memory, heldUntil, seats: MemoryOrganizationSeatRepository.create({ memory }) };
}

function inviteLinus(memory: MemoryOrganizationDatabase): void {
  memory.invites.set("inv-linus", {
    id: "inv-linus",
    email: "LINUS@acme.com",
    inviteCode: "code",
    expiration: null,
    status: "PENDING",
    organizationId: ACME,
    teamIds: "",
    teamAssignments: null,
    role: OrganizationUserRole.MEMBER,
    requestedBy: null,
    subscriptionId: null,
    acceptedByUserId: null,
    acceptedViaIdentifierId: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  });
}

describe("a seat held for somebody who left", () => {
  describe("when a full invitation names the held person's address", () => {
    /** @scenario "A full invitation to a held person's address takes the hold's place" */
    it("stops counting the hold while the invitation is live, and counts it again after", async () => {
      const { memory, heldUntil, seats } = seeded();
      inviteLinus(memory);

      expect(await seats.findCountedHold({ organizationId: ACME, userId: "linus" })).toEqual([]);
      expect(
        await seats.findCountedHold({
          organizationId: ACME,
          userId: "linus",
          ignoringInviteId: "inv-linus",
        }),
      ).toEqual([{ userId: "linus", heldUntil: heldUntil.epochMilliseconds }]);
      expect(
        await seats.findHoldUserIdsByEmail({ organizationId: ACME, email: "Linus@ACME.com" }),
      ).toEqual(["linus"]);
      expect(await seats.findSeatHolders(ACME)).toContainEqual({
        holder: { kind: "hold", userId: "linus", expiresAt: heldUntil.epochMilliseconds },
        seat: "none",
        suppressedBy: "inv-linus",
      });

      memory.invites.delete("inv-linus");

      expect(await seats.findCountedHold({ organizationId: ACME, userId: "linus" })).toEqual([
        { userId: "linus", heldUntil: heldUntil.epochMilliseconds },
      ]);
    });
  });

  describe("when counting opens", () => {
    /** @scenario "The opening count includes the seats held for people who left" */
    it("lists the hold as a full seat beside the members", async () => {
      const { heldUntil, seats } = seeded();

      const holders = await seats.findSeatHolders(ACME);

      expect(holders.filter(({ seat }) => seat === "full")).toHaveLength(3);
      expect(holders.filter(({ holder }) => holder.kind === "hold")).toHaveLength(1);
      expect(holders).toContainEqual({
        holder: { kind: "hold", userId: "linus", expiresAt: heldUntil.epochMilliseconds },
        seat: "full",
      });
      expect((await seats.countMemberSeats(ACME)).fullMembers).toBe(3);
    });
  });
});
