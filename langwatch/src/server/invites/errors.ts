/**
 * Custom error types for invite domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */

/**
 * Message thrown by `organization.acceptInvite` when the invite has already
 * been consumed. Shared between server (where it's thrown) and client (where
 * it's matched to trigger a redirect) so the two cannot drift.
 */
export const INVITE_ALREADY_ACCEPTED_MESSAGE =
  "Invite was already accepted" as const;

export class DuplicateInviteError extends Error {
  constructor(email: string) {
    super(`An active invitation for ${email} already exists`);
    this.name = "DuplicateInviteError";
  }
}

export class InviteNotFoundError extends Error {
  constructor(
    message = "Invitation not found or is not waiting for approval"
  ) {
    super(message);
    this.name = "InviteNotFoundError";
  }
}

export class OrganizationNotFoundError extends Error {
  constructor() {
    super("Organization not found");
    this.name = "OrganizationNotFoundError";
  }
}
