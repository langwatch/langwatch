/**
 * Organization's seat changes (ADR-002): a write that takes or gives back a seat appends one
 * change to the outbox in its own transaction, and organization_seat_peak folds it.
 * Spec: modules/organization/specs/seat-peak.feature
 */
import type { MemberType } from "@langwatch/entitlement-contract";
import type { ProcessStore } from "@langwatch/eventing";

import type {
  RecordSeatChangedCommandData,
  SeatHolder,
  SeatKind,
} from "../eventing/seat-peak.events.ts";

export const SEAT_PEAK_PROCESS_NAME = "organizationSeatPeak" as const;
export const SEAT_PEAK_RECORD_INTENT = "recordSeatChange" as const;
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

/** A live invitation whose expiry moved keeps its seat, but the fold must learn the new expiry. */
export function movesAnInvitationExpiry({
  before,
  after,
}: {
  before: HeldSeat;
  after: HeldSeat;
}): boolean {
  if (before.holder.kind !== "invitation" || after.holder.kind !== "invitation") return false;
  if (before.seat !== after.seat || after.seat === "none") return false;
  return before.holder.expiresAt !== after.holder.expiresAt;
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
