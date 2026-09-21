import { HandledError } from "@langwatch/handled-error";

export class LiteMemberRestrictedError extends HandledError {
  declare readonly code: "lite_member_restricted";

  constructor(resource: string) {
    super(
      "lite_member_restricted",
      "This feature is not available for your account",
      {
        meta: { resource },
        httpStatus: 401,
      },
    );
    this.name = "LiteMemberRestrictedError";
  }
}

/**
 * The caller is signed in and the project exists, but their role does not carry
 * the permission this operation requires.
 *
 * Handled, not a plain `Error`: we know exactly why it failed and the caller
 * has somewhere to go — ask an organization admin for the role. It was a bare
 * `new Error("You do not have permission to access this project resource")`,
 * which cost twice over. It reached customers as the generic "unknown"
 * state with a trace id, and `app/api/files/[[...route]]/app.ts` had to compare
 * that sentence word for word to tell a denial (403) from an outage (5xx) — so
 * rewording the copy would have silently reclassified every denial as a server
 * fault, with nothing to catch it.
 *
 * `permission` goes in `meta` because a client renders it: it is the difference
 * between "you can't do that" and "ask an admin for `datasets:manage`".
 */
/**
 * The caller still holds a membership in this organization, but an admin
 * disabled it to stay within the licensed seat count, so it grants nothing.
 *
 * Handled, and deliberately NOT folded into the generic denial: we know
 * exactly why the check failed, and the person can act on it — an admin can
 * return a seat to them. Reported as "you do not have permission" it would
 * read as a role problem they could fix by asking for a role; reported as "no
 * membership" it would tell someone who IS a member that they are not.
 *
 * Nothing here names who disabled them or how many seats the license covers:
 * that is the organization's business, and the person asking has an admin to
 * ask. No `meta` either: nothing renders one, and the scope a check was made
 * on is a project or team as often as an organization.
 */
export class MembershipDisabledError extends HandledError {
  declare readonly code: "membership_disabled";

  constructor() {
    super(
      "membership_disabled",
      "Your access to this organization has been disabled",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "MembershipDisabledError";
  }
}

export class ProjectPermissionDeniedError extends HandledError {
  declare readonly code: "project_permission_denied";

  constructor(permission: string) {
    super(
      "project_permission_denied",
      // Customer-safe: a permission slug is part of the product's vocabulary
      // (it is what an admin grants), not an internal detail.
      "You do not have permission to do this on this project",
      {
        meta: { permission },
        httpStatus: 403,
        fault: "customer",
      },
    );
    this.name = "ProjectPermissionDeniedError";
  }
}
