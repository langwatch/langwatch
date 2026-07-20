/**
 * Guards a middleware against running more than once for the same request.
 *
 * Fifteen `SecuredApp` families are constructed with the bare
 * `basePath: "/api"` and every one is mounted at the router root
 * (`api.route("/", app.hono)`). Hono flattens each family's constructor
 * middleware into the composed router as an `ALL /api/*` entry — 30 of them
 * (tracer + logger per family) — and runs every entry registered *before* the
 * matched route. So a request handled by an early-mounted family ran the
 * logger ~10 times and a late-mounted one ~13 times, which is exactly the
 * 10-13 duplicate `request handled` lines and nested `GET api` spans seen in
 * production.
 *
 * Keyed on the raw `Request`, which is stable for the lifetime of the request
 * and collected with it. Doing it here rather than hoisting the middleware to
 * the parent router keeps it correct for the `SecuredApp`s mounted standalone
 * under Next.js route handlers, which never pass through `createApiRouter`.
 */
const claimed = new WeakMap<Request, Set<string>>();

/**
 * Returns true for the first caller with a given marker for this request and
 * false for every later one. The winner is the outermost middleware, which is
 * the one that wraps the whole request.
 */
export function claimOncePerRequest(req: Request, marker: string): boolean {
  let markers = claimed.get(req);
  if (!markers) {
    markers = new Set<string>();
    claimed.set(req, markers);
  }
  if (markers.has(marker)) return false;
  markers.add(marker);
  return true;
}
