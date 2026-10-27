// Where a provisioned or joining person lands (specs/licensing/seat-limit-at-provisioning.feature):
// the requested role while a full seat is free, else Lite (EXTERNAL), else Lite held pending.
// A Developer is its own seat (ADR-171), so the full seats never move it.
export type AdmissionSeat<Requested extends string> = Readonly<{
  role: Requested | "EXTERNAL";
  /** No access until an admin frees a seat: the membership is written disabled. */
  pending: boolean;
}>;

export function admissionSeat<Requested extends "ADMIN" | "MEMBER" | "DEVELOPER">({
  requested,
  fullSeatFree,
  liteSeatFree,
}: Readonly<{
  requested: Requested;
  fullSeatFree: boolean;
  liteSeatFree: boolean;
}>): AdmissionSeat<Requested> {
  if (requested === "DEVELOPER" || fullSeatFree) return { role: requested, pending: false };
  return { role: "EXTERNAL", pending: !liteSeatFree };
}

/** What `OrganizationApi.createMembership` answers: the row's seat, and whether it waits. */
export type OrganizationAdmission = Readonly<{
  outcome: "created" | "already-present";
  seat: "MEMBER" | "DEVELOPER" | "EXTERNAL";
  pending: boolean;
}>;
