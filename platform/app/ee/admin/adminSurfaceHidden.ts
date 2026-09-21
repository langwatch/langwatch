import { HandledError } from "@langwatch/handled-error";

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
 * It lives here rather than beside one surface because there are now two —
 * the flat REST admin API and the back office's tRPC procedures — and a
 * denial that differed between them would be the oracle this error exists to
 * remove. One class, one answer, both surfaces.
 */
export class AdminSurfaceHiddenError extends HandledError {
  declare readonly code: "not_found";

  constructor() {
    super("not_found", "Not found", { httpStatus: 404, fault: "customer" });
    this.name = "AdminSurfaceHiddenError";
  }
}

export function adminSurfaceHidden(): AdminSurfaceHiddenError {
  return new AdminSurfaceHiddenError();
}
