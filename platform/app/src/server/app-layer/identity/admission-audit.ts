/**
 * The audit action a Developer admission writes (ADR-143).
 *
 * A Full member's admission reaches the audit page through the
 * organisation-wide grant the ledger attaches for them. A Developer gets no
 * grant, so the membership row itself is the admission and every path that
 * creates one (domain join, approved join request, single sign-on, an
 * accepted invitation) writes
 * this row so the join is visible to administrators after the fact.
 */
export const DEVELOPER_ADMISSION_AUDIT_ACTION =
  "organization.member.admitted" as const;

export const DEVELOPER_ADMISSION_VIA = [
  "domain-join",
  "join-request-approved",
  "sso",
  "invite",
] as const;
export type DeveloperAdmissionVia = (typeof DEVELOPER_ADMISSION_VIA)[number];
