/**
 * @see modules/organization/specs/seat-peak.feature
 * Seats moved by writes organization does not make reach the fold as corrections (ADR-002 §6).
 */
import type { MemberType } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import type { RecordSeatChangedCommandData } from "../../eventing/seat-peak.events.ts";
import type { OrganizationSeatHolding } from "../../repositories/organization-seat.repository.ts";
import type { SeatKind } from "../../rules/seat-holder.rules.ts";
import {
  emptySeatPeak,
  foldSeatPeak,
  type SeatPeakState,
  seatPeakMonthOf,
} from "../../rules/seat-peak.rules.ts";
import { SeatPeakCorrectionService } from "../seat-peak-correction.service.ts";

const ORG = "org-1";
const OPENED_AT = Date.UTC(2026, 10, 2, 9);
const LATER = Date.UTC(2026, 10, 2, 12);
const MONTH = seatPeakMonthOf(OPENED_AT);

const MEMBER_TYPE_OF_SEAT: Record<SeatKind, MemberType | null> = {
  full: "FullMember",
  lite: "LiteMember",
  developer: "Developer",
  none: null,
};

function member(userId: string, seat: SeatKind): OrganizationSeatHolding {
  return { holder: { kind: "member", userId }, seat };
}

function fullMembers(count: number): OrganizationSeatHolding[] {
  return Array.from({ length: count }, (_, index) => member(`full-${index}`, "full"));
}

/** An organization whose count opened from `opening`, its seats now `live`. */
function organization({
  opening,
  live = opening,
  invitations = [],
}: {
  opening: OrganizationSeatHolding[];
  live?: OrganizationSeatHolding[];
  invitations?: OrganizationSeatHolding[];
}) {
  let state: SeatPeakState = foldSeatPeak({
    state: emptySeatPeak(),
    fact: {
      type: "seat_snapshot_taken",
      data: {
        tenantId: ORG,
        organizationId: ORG,
        holders: [...opening, ...invitations],
        occurredAt: OPENED_AT,
      },
    },
  });
  let seats = live;
  const sent: RecordSeatChangedCommandData[] = [];
  const fold = (change: RecordSeatChangedCommandData) => {
    state = foldSeatPeak({ state, fact: { type: "seat_changed", data: change } });
  };
  const service = SeatPeakCorrectionService.create({
    seats: {
      findSeatHolders: async () => seats,
      findMemberSeat: async ({ userId }) => {
        const held = seats.find(
          ({ holder }) => holder.kind === "member" && holder.userId === userId,
        );
        return MEMBER_TYPE_OF_SEAT[held?.seat ?? "none"];
      },
    },
    peaks: { getState: async () => state },
    organizationIdsForMember: async () => [ORG],
    changes: () => ({
      send: async (change) => {
        sent.push(change);
        fold(change);
      },
    }),
  });
  return {
    service,
    sent,
    seatsNow: (next: OrganizationSeatHolding[]) => {
      seats = next;
    },
    /** A change organization's own writer recorded, arriving late. */
    deliverLate: fold,
    month: () => state.months[MONTH],
    counts: () => state.counts,
  };
}

const source = (
  cause: RecordSeatChangedCommandData["cause"],
  eventId = "evt-1",
  occurredAt = LATER,
) => ({ eventId, occurredAt, cause });

/** A writer's change to a member, dated `occurredAt`. */
function writerChange({
  userId,
  from,
  to,
  occurredAt,
}: {
  userId: string;
  from: SeatKind;
  to: SeatKind;
  occurredAt: number;
}): RecordSeatChangedCommandData {
  return {
    tenantId: ORG,
    organizationId: ORG,
    holder: { kind: "member", userId },
    from,
    to,
    cause: "role_changed",
    actorUserId: null,
    occurredAt,
    changeId: `seatchange_${userId}_${occurredAt}`,
  };
}

describe("SeatPeakCorrectionService", () => {
  describe("given a Lite Member with a view-only custom role", () => {
    /** @scenario "A Lite Member given a custom role that edits takes a full seat" */
    it("records the Lite Member taking a full seat once the editing role is bound", async () => {
      const opening = [...fullMembers(10), member("lite-1", "lite")];
      const org = organization({ opening });
      org.seatsNow([...fullMembers(10), member("lite-1", "full")]);

      await org.service.correctMember({
        organizationId: ORG,
        userId: "lite-1",
        source: source("custom_role_changed"),
      });

      expect(org.sent).toMatchObject([
        { holder: { kind: "member", userId: "lite-1" }, from: "lite", to: "full" },
      ]);
      expect(org.month()?.fullPeak).toBe(11);
    });

    it("records the same correction once when the grant event is delivered twice", async () => {
      const org = organization({ opening: [member("lite-1", "lite")] });
      org.seatsNow([member("lite-1", "full")]);
      const twice = { organizationId: ORG, source: source("custom_role_changed") };

      await org.service.correctOrganization(twice);
      await org.service.correctOrganization(twice);

      expect(org.sent).toHaveLength(1);
      expect(org.counts()).toMatchObject({ full: 1, lite: 0 });
    });

    it("leaves a seat given back to the write that made it", async () => {
      const org = organization({ opening: [member("lite-1", "lite"), member("leaver", "full")] });
      org.seatsNow([member("lite-1", "lite")]);

      await org.service.correctOrganization({
        organizationId: ORG,
        source: source("custom_role_changed"),
      });

      expect(org.sent).toEqual([]);
    });

    it("keeps the full seat of a Lite Member whose admission reaches the fold after the role", async () => {
      const org = organization({ opening: [] });
      org.seatsNow([member("joiner", "full")]);

      await org.service.correctOrganization({
        organizationId: ORG,
        source: source("custom_role_changed"),
      });
      org.deliverLate(
        writerChange({ userId: "joiner", from: "none", to: "lite", occurredAt: LATER - 1_000 }),
      );

      expect(org.sent).toMatchObject([{ from: "none", to: "full" }]);
      expect(org.counts()).toMatchObject({ full: 1, lite: 0 });
    });

    it("corrects a pending invitation the role moved, not only members", async () => {
      const invitation = (seat: SeatKind): OrganizationSeatHolding => ({
        holder: { kind: "invitation", inviteId: "inv-1", expiresAt: null },
        seat,
      });
      const org = organization({ opening: [], invitations: [invitation("lite")] });
      org.seatsNow([invitation("full")]);

      await org.service.correctOrganization({
        organizationId: ORG,
        source: source("custom_role_changed"),
      });

      expect(org.sent).toMatchObject([
        { holder: { kind: "invitation", inviteId: "inv-1" }, from: "lite", to: "full" },
      ]);
      expect(org.counts()).toMatchObject({ full: 1, lite: 0 });
    });

    it("records a named member's live seat even when the fold shows it, outranking a late change", async () => {
      const org = organization({ opening: [member("lite-1", "full")] });

      await org.service.correctMember({
        organizationId: ORG,
        userId: "lite-1",
        source: source("custom_role_changed"),
      });
      org.deliverLate(
        writerChange({ userId: "lite-1", from: "full", to: "lite", occurredAt: LATER - 1_000 }),
      );

      expect(org.sent).toMatchObject([{ from: "full", to: "full", occurredAt: LATER }]);
      expect(org.counts()).toMatchObject({ full: 1, lite: 0 });
    });
  });

  describe("given a full member whose whole account is deactivated", () => {
    /** @scenario "A seat given back on any path lowers the running count" */
    it("gives their seat back, so the next full member raises no peak", async () => {
      const org = organization({ opening: [...fullMembers(9), member("leaver", "full")] });
      org.seatsNow(fullMembers(9));

      await org.service.correctAccount({
        userId: "leaver",
        source: source("account_deactivated"),
      });
      org.seatsNow([...fullMembers(9), member("joiner", "full")]);
      await org.service.correctMember({
        organizationId: ORG,
        userId: "joiner",
        source: source("admitted", "evt-2", LATER + 1),
      });

      expect(org.sent).toMatchObject([
        { cause: "account_deactivated", from: "full", to: "none" },
        { cause: "admitted", from: "none", to: "full" },
      ]);
      expect(org.month()?.fullPeak).toBe(10);
    });

    it("takes the seat again when the account is reactivated", async () => {
      const org = organization({ opening: [member("leaver", "full")], live: [] });
      await org.service.correctAccount({
        userId: "leaver",
        source: source("account_deactivated", "evt-1", LATER),
      });
      const deactivated = org.counts().full;
      org.seatsNow([member("leaver", "full")]);

      await org.service.correctAccount({
        userId: "leaver",
        source: source("account_reactivated", "evt-2", LATER + 60_000),
      });

      expect(deactivated).toBe(0);
      expect(org.counts().full).toBe(1);
      expect(org.sent.map(({ from, to, occurredAt }) => [from, to, occurredAt])).toEqual([
        ["full", "none", LATER],
        ["none", "full", LATER + 60_000],
      ]);
    });
  });

  describe("given an offboarding that deleted a pending invitation", () => {
    it("gives the invitation's seat back", async () => {
      const invitation: OrganizationSeatHolding = {
        holder: { kind: "invitation", inviteId: "inv-1", expiresAt: null },
        seat: "full",
      };
      const org = organization({ opening: [], invitations: [invitation] });

      await org.service.correctInvitations({
        organizationId: ORG,
        source: source("invitation_revoked"),
      });

      expect(org.sent).toMatchObject([
        { holder: { kind: "invitation", inviteId: "inv-1" }, from: "full", to: "none" },
      ]);
      expect(org.counts().full).toBe(0);
    });
  });
});
