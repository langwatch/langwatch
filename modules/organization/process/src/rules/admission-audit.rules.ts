/**
 * The audit row a Developer admission writes (ADR-171). A Full member's
 * admission reaches the audit page through its organisation-wide grant; a
 * Developer gets none, so every admission route writes this row instead.
 */
export const DEVELOPER_ADMISSION_AUDIT_ACTION = "organization.member.admitted" as const;

/** The route a Developer admission arrived by, recorded as `via` on the audit row. */
export const DEVELOPER_ADMISSION_VIA = [
  "domain-join",
  "join-request-approved",
  "sso",
  "invite",
] as const;
export type DeveloperAdmissionVia = (typeof DEVELOPER_ADMISSION_VIA)[number];
