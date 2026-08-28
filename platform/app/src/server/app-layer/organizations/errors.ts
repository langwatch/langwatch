import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";


export class OrganizationNotFoundForTeamError extends NotFoundError {
  declare readonly code: "organization_not_found_for_team";

  constructor(teamId: string, options: { reasons?: readonly Error[] } = {}) {
    super("organization_not_found_for_team", "Organization for team", teamId, {
      meta: { teamId },
      ...options,
    });
    this.name = "OrganizationNotFoundForTeamError";
  }
}

/**
 * The organization has no ADMIN member, so an action that has to reach one —
 * a budget-increase request, for instance — has nowhere to go.
 *
 * `fault: "platform"` even at 412: nobody holding this screen can fix it. The
 * requester did everything right, and no retry of theirs will work until
 * somebody with the keys adds an administrator, which is why the registry copy
 * for `no_admin_configured` names who to ask instead of offering a retry.
 *
 * Before this the router threw `new TRPCError({ message: "no_admin_found" })`
 * and the page branched on that string — a second, hand-written code system of
 * exactly the kind ADR-045 exists to prevent, and one the customer read raw.
 */
export class NoAdminConfiguredError extends HandledError {
  declare readonly code: "no_admin_configured";

  constructor() {
    // No `meta`: nothing renders an organization id, and `meta` is a client
    // contract rather than a place to park context. The id belongs in the log
    // line at the throw site.
    super("no_admin_configured", "Organization has no administrator", {
      httpStatus: 412,
      fault: "platform",
    });
    this.name = "NoAdminConfiguredError";
  }
}

/** The user id is not a member of the caller's organization. */
export class MemberNotFoundError extends NotFoundError {
  declare readonly code: "member_not_found";

  constructor(userId: string) {
    super("member_not_found", "Organization member", userId, {
      meta: { userId },
    });
    this.name = "MemberNotFoundError";
  }
}

/**
 * An admin tried to disable their own membership. Refused so an organization
 * cannot lock itself out through its last acting administrator; disabling
 * anyone else remains a normal, reversible operation.
 */
export class CannotDisableSelfError extends HandledError {
  declare readonly code: "cannot_disable_self";

  constructor() {
    super("cannot_disable_self", "You cannot disable your own membership", {
      httpStatus: 400,
    });
    this.name = "CannotDisableSelfError";
  }
}

/**
 * Disabling this membership would leave the organization without an active
 * administrator, so nobody could sign in and undo it. Raised by the storage
 * guard itself so every path that disables a member trips it, and handled so
 * the REST surface answers a stable 400 instead of an unknown 500.
 */
export class CannotDisableLastAdminError extends HandledError {
  declare readonly code: "cannot_disable_last_admin";

  constructor() {
    super(
      "cannot_disable_last_admin",
      "Cannot disable the last active administrator of an organization",
      { httpStatus: 400 },
    );
    this.name = "CannotDisableLastAdminError";
  }
}

/**
 * Demoting this membership would leave the organization without an
 * administrator, the same lockout the disable guard refuses. Raised by the
 * storage guard itself so every role-change path trips it, and handled so the
 * REST surface answers a stable 400 instead of an unknown 500.
 */
export class CannotDemoteLastAdminError extends HandledError {
  declare readonly code: "cannot_demote_last_admin";

  constructor() {
    super(
      "cannot_demote_last_admin",
      "Cannot demote the last administrator of an organization",
      { httpStatus: 400 },
    );
    this.name = "CannotDemoteLastAdminError";
  }
}

/**
 * Removing this membership would leave the organization without an active
 * administrator, the same lockout the disable and demote guards refuse, and
 * the only irreversible one of the three. Raised by the storage guard itself
 * so every removal path trips it, and handled so the REST surface answers a
 * stable 400 instead of an unknown 500.
 */
export class CannotRemoveLastAdminError extends HandledError {
  declare readonly code: "cannot_remove_last_admin";

  constructor() {
    super(
      "cannot_remove_last_admin",
      "Cannot remove the last active administrator of an organization",
      { httpStatus: 400 },
    );
    this.name = "CannotRemoveLastAdminError";
  }
}

/** The removal named the caller's own membership. Same guard as disabling. */
export class CannotRemoveSelfError extends HandledError {
  declare readonly code: "cannot_remove_self";

  constructor() {
    super("cannot_remove_self", "You cannot remove yourself from the organization", {
      httpStatus: 400,
    });
    this.name = "CannotRemoveSelfError";
  }
}

/**
 * The change needs a member seat the plan does not have left: re-enabling a
 * disabled member, moving an external member to a full seat, or inviting
 * beyond the allowance. 403, not 402: the plan exists and the credential is
 * fine, the allowance is simply used up, and freeing a seat fixes it without
 * a purchase.
 *
 * `meta` is typed to the three fields the client presentation registry and the
 * upgrade modal read, so a construction that omits them or misspells one is a
 * compile error rather than an allowance rendered as "undefined of undefined".
 */
export class MemberSeatLimitReachedError extends HandledError {
  declare readonly code: "member_seat_limit_reached";

  constructor(
    options: {
      meta?: { limitType: string; current: number; max: number };
    } = {},
  ) {
    super("member_seat_limit_reached", "The plan's member seats are all in use", {
      httpStatus: 403,
      ...(options.meta ? { meta: options.meta } : {}),
    });
    this.name = "MemberSeatLimitReachedError";
  }
}

/**
 * The requested organization slug is already claimed on this instance.
 * Deterministic 409 on the natural key, so provisioning tools can branch on
 * it (retry with another slug, or adopt the existing organization).
 */
export class OrganizationSlugTakenError extends HandledError {
  declare readonly code: "organization_slug_taken";

  constructor(slug: string) {
    super("organization_slug_taken", "An organization with this slug already exists", {
      httpStatus: 409,
      meta: { slug },
      ...remediation("organization_slug_taken"),
    });
    this.name = "OrganizationSlugTakenError";
  }
}
