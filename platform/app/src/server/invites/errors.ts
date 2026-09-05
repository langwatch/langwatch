/**
 * Custom error types for invite domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */
import { HandledError } from "@langwatch/handled-error";

import { remediation } from "../app-layer/error-remediation";

/**
 * Message thrown by `organization.acceptInvite` when the invite has already
 * been consumed. Shared between server (where it's thrown) and client (where
 * it's matched to trigger a redirect) so the two cannot drift.
 */
export const INVITE_ALREADY_ACCEPTED_MESSAGE =
  "Invite was already accepted" as const;

export const INVITE_NOT_READY_MESSAGE =
  "Invite is not ready to be accepted" as const;

/**
 * An invite for this email is already pending in the organization.
 *
 * Handled (409): the tRPC router keeps its own instanceof mapping, and the
 * REST surface answers the code directly, so a provisioning tool can treat
 * the conflict as already-done. `email` is in `meta` because a batch invite
 * needs to say WHICH address collided.
 */
export class DuplicateInviteError extends HandledError {
  declare readonly code: "duplicate_invite";

  constructor(email: string) {
    super(
      "duplicate_invite",
      `An active invitation for ${email} already exists`,
      {
        httpStatus: 409,
        meta: { email },
        ...remediation("duplicate_invite"),
      },
    );
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

/**
 * The invitation exists but its window has passed. Distinct from
 * `invite_not_found` on purpose: an expired invitation is recoverable — the
 * inviter resends it in one click (D11) — so the person holding the link
 * gets told to ask for a fresh one instead of a dead end.
 */
export class InviteExpiredError extends HandledError {
  declare readonly code: "invite_expired";

  constructor() {
    super("invite_expired", "This invitation has expired", {
      httpStatus: 410,
    });
    this.name = "InviteExpiredError";
  }
}

export class InviteNotFoundError extends HandledError {
  declare readonly code: "invite_not_found";

  constructor(message = "Invitation not found or is not waiting for approval") {
    super("invite_not_found", message, { httpStatus: 404 });
    this.name = "InviteNotFoundError";
  }
}

/**
 * An invite's team assignment named a team outside the organization.
 *
 * Refused loudly on the API surface: silently dropping the assignment (the
 * lenient mode the invite form uses) would let a provisioning tool believe
 * the team membership was granted.
 */
export class TeamNotInOrganizationError extends HandledError {
  declare readonly code: "team_not_in_organization";

  constructor(teamId: string) {
    super(
      "team_not_in_organization",
      "That team does not belong to this organization",
      { httpStatus: 422, meta: { teamId } },
    );
    this.name = "TeamNotInOrganizationError";
  }
}

/**
 * Somebody is signed in, and the account they are signed in as is not the
 * one the invitation names.
 *
 * Not a refusal: the way out is to sign in as the invited account, and the
 * screen offers exactly that. The hint is what makes the offer actionable —
 * "sign in as the right account" is useless advice to somebody holding three
 * of them.
 *
 * The hint is MASKED, and the whole address never leaves the server. An
 * invite code is a bearer token that reaches inboxes, chat logs and support
 * threads; `auth.inviteLanding` already refuses to name the invited
 * address for that reason, and a mismatch is not the place to hand it over.
 * Enough survives the mask to recognize an address you own, and not enough
 * to learn one you do not.
 */
export class InviteWrongAccountError extends HandledError {
  declare readonly code: "invite_wrong_account";

  constructor(invitedHint: string) {
    super(
      "invite_wrong_account",
      "This invitation was sent to a different account",
      { httpStatus: 403, meta: { invitedHint } },
    );
    this.name = "InviteWrongAccountError";
  }
}

/**
 * A resend or a fresh-invitation request came too soon after the last one.
 *
 * Both sides of the invitation can trigger an email — the admin resending
 * and the invitee asking again — so both are throttled, and both land here.
 * `retryAfterSeconds` is what lets the screen say how long instead of "try
 * again later".
 */
export class InviteThrottledError extends HandledError {
  declare readonly code: "invite_throttled";

  constructor(retryAfterSeconds: number) {
    super(
      "invite_throttled",
      "That invitation was just sent. Give it a moment before sending another",
      { httpStatus: 429, meta: { retryAfterSeconds } },
    );
    this.name = "InviteThrottledError";
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
