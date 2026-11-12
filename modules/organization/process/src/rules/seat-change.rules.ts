/**
 * Organization's seat changes (ADR-002): a write that takes or gives back a seat appends one
 * change to the outbox in its own transaction, and organization_seat_peak folds it.
 * Spec: modules/organization/specs/seat-peak.feature
 */
import type { MemberType } from "@langwatch/entitlement-contract";
import type { ProcessStore } from "@langwatch/eventing";

import type { RecordSeatChangedCommandData } from "../eventing/seat-peak.events.ts";
import type { SeatHolder, SeatKind } from "./seat-holder.rules.ts";

export const SEAT_PEAK_PROCESS_NAME = "organizationSeatPeak" as const;
export const SEAT_PEAK_RECORD_INTENT = "recordSeatChanged" as const;
export const SEAT_PEAK_PRUNE_INTENT = "pruneSeatChanges" as const;
/** The tenant's one seat-change outbox instance. */
const SEAT_PEAK_PROCESS_KEY = "seats";

const SEAT_KIND_OF_MEMBER_TYPE: Record<MemberType, SeatKind> = {
  FullMember: "full",
  LiteMember: "lite",
  Developer: "developer",
};

/** The seat a holder takes, by the rule the cap counts by; no member type is no seat. */
export function seatKindOf(memberType: MemberType | null): SeatKind {
  return memberType === null ? "none" : SEAT_KIND_OF_MEMBER_TYPE[memberType];
}

/** A change that moves no seat records nothing (an admin made from a member). */
export function movesASeat({ from, to }: { from: SeatKind; to: SeatKind }): boolean {
  return from !== to;
}

type HeldSeat = Readonly<{ holder: SeatHolder; seat: SeatKind }>;

/**
 * A live invitation or hold whose expiry moved keeps its seat, but the fold must learn the new
 * expiry.
 */
export function movesAnInvitationExpiry({
  before,
  after,
}: {
  before: HeldSeat;
  after: HeldSeat;
}): boolean {
  if (before.holder.kind === "member" || after.holder.kind !== before.holder.kind) return false;
  if (before.seat !== after.seat || after.seat === "none") return false;
  return before.holder.expiresAt !== after.holder.expiresAt;
}

/** One holder's seat as the fold last recorded it and as it stands now. */
export type SeatReading = Readonly<{ holder: SeatHolder; recorded: SeatKind; live: SeatKind }>;

/**
 * The holders an organization-wide re-read corrects (ADR-002 §6): those it finds in a metered
 * seat the fold has not recorded. A seat given back is left to its writer's own change, so the
 * correction, dated at its source, never outranks a late admission and cannot lose a seat.
 */
export function organizationSeatCorrections({
  readings,
}: {
  readings: readonly SeatReading[];
}): SeatReading[] {
  return readings.filter(({ recorded, live }) => isMetered(live) && live !== recorded);
}

function isMetered(seat: SeatKind): boolean {
  return seat === "full" || seat === "lite";
}

type SeatChangeAppend = Omit<Parameters<ProcessStore["appendIntents"]>[0], "transaction">;

/** The outbox append that carries one seat change, keyed by the change's own id. */
export function seatChangeAppend({
  change,
}: {
  change: RecordSeatChangedCommandData;
}): SeatChangeAppend {
  return {
    ref: {
      processName: SEAT_PEAK_PROCESS_NAME,
      projectId: change.tenantId,
      processKey: SEAT_PEAK_PROCESS_KEY,
    },
    tenantId: change.tenantId,
    sourceEventId: null,
    messages: [
      {
        messageKey: change.changeId,
        intentType: SEAT_PEAK_RECORD_INTENT,
        payload: change,
        traceCarrier: {},
      },
    ],
    now: change.occurredAt,
  };
}
