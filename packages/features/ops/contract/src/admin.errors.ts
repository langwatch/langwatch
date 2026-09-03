import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class CannotImpersonateDeactivatedUserError extends HandledError {
  constructor(userId: string) {
    super("cannot_impersonate_deactivated_user", "Cannot impersonate a deactivated user", {
      httpStatus: 400,
      meta: { userId },
    });
    this.name = "CannotImpersonateDeactivatedUserError";
  }
}

export class CannotImpersonateAdminError extends HandledError {
  constructor(userId: string) {
    super("cannot_impersonate_admin", "Cannot impersonate another admin", {
      httpStatus: 403,
      meta: { userId },
    });
    this.name = "CannotImpersonateAdminError";
  }
}

export class UserToImpersonateNotFoundError extends NotFoundError {
  constructor(userId: string) {
    super("user_to_impersonate_not_found", "User to impersonate", userId);
    this.name = "UserToImpersonateNotFoundError";
  }
}

/**
 * The answer to "you are not an admin", which deliberately says nothing more.
 *
 * A 404 rather than a 403 so the admin surface doesn't confirm its own
 * existence to whoever is probing it, and the generic `not_found` code rather
 * than something naming the backoffice, for the same reason. It goes through
 * the handled channel anyway so the response carries a trace id — an operator
 * whose session quietly stopped being an admin has something to quote.
 *
 * The identifying fields are the part that has to stay out. `NotFoundError`
 * builds `"<resource> not found: <id>"` and puts the id in `meta`, so the
 * earlier spelling answered `{ error: "not_found", message: "Route not found:
 * /api/admin", id: "/api/admin" }` — byte-for-byte distinguishable from the
 * framework's own 404 for a path that was never registered, which told a
 * prober the route exists and they merely lack the session for it. Only the
 * code and the trace id are carried now.
 *
 * It lives in the operations contract rather than beside one surface because
 * there are two — the flat REST admin API and the back office's tRPC
 * procedures — and a denial that differed between them would be the oracle
 * this error exists to remove. One class, one answer, both surfaces; the
 * contract is the one module both transports may import.
 */
export class AdminSurfaceHiddenError extends HandledError {
  declare readonly code: "not_found";

  constructor() {
    super("not_found", "Not found", { httpStatus: 404, fault: "customer" });
    this.name = "AdminSurfaceHiddenError";
  }
}
