import { GroupNotFoundError, MemberNotFoundError } from "@langwatch/organization-contract";

/** The organization feature's refusal for a user who holds no membership row. */
export function isMemberNotFound(error: unknown): boolean {
  return MemberNotFoundError.is(error);
}

/** The organization feature's refusal for a group outside the organization asked about. */
export function isGroupNotFound(error: unknown): boolean {
  return GroupNotFoundError.is(error);
}

/**
 * Whether a seat shares in the organization's gateway keys through membership alone. Neither a
 * Developer (ADR-171) nor a Lite Member holds an organization-scoped binding, so the seat decides.
 */
export function seatSharesOrganizationKeys(role: string): boolean {
  return role !== "DEVELOPER" && role !== "EXTERNAL";
}
