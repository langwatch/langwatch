import { HandledError, NotFoundError } from "@langwatch/handled-error";

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
