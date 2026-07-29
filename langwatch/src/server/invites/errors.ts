/**
 * Custom error types for invite domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */
import { HandledError } from "@langwatch/handled-error";

/**
 * Message thrown by `organization.acceptInvite` when the invite has already
 * been consumed. Shared between server (where it's thrown) and client (where
 * it's matched to trigger a redirect) so the two cannot drift.
 */
export const INVITE_ALREADY_ACCEPTED_MESSAGE =
  "Invite was already accepted" as const;

export const INVITE_NOT_READY_MESSAGE =
  "Invite is not ready to be accepted" as const;

export class DuplicateInviteError extends Error {
  constructor(email: string) {
    super(`An active invitation for ${email} already exists`);
    this.name = "DuplicateInviteError";
  }
}

/**
 * The address being invited already belongs to a member of this organization.
 *
 * Handled rather than silently allowed: inviting someone who is already here
 * used to succeed, writing a pending invite row beside the membership it
 * duplicated. The admin saw a new "Invited" line under a table that already
 * listed that person as an ADMIN, and nothing said the two were the same
 * human. Whatever they were actually trying to do — change a role, add a team
 * — did not happen, and they had no way to know.
 *
 * `email` is in `meta` because the client renders it: an invite form takes
 * several addresses at once, so "one of these is already a member" is not an
 * answer.
 */
export class AlreadyOrganizationMemberError extends HandledError {
  declare readonly code: "already_organization_member";

  constructor(email: string) {
    super(
      "already_organization_member",
      "This person is already a member of the organization",
      { meta: { email }, httpStatus: 409, fault: "customer" },
    );
    this.name = "AlreadyOrganizationMemberError";
  }
}

export class InviteNotFoundError extends Error {
  constructor(message = "Invitation not found or is not waiting for approval") {
    super(message);
    this.name = "InviteNotFoundError";
  }
}

export class InviteNotReadyError extends Error {
  constructor(inviteId: string, status: string) {
    super(
      `Cannot apply invite ${inviteId}: status is ${status}, expected PENDING`,
    );
    this.name = "InviteNotReadyError";
  }
}

export class OrganizationNotFoundError extends Error {
  constructor() {
    super("Organization not found");
    this.name = "OrganizationNotFoundError";
  }
}
