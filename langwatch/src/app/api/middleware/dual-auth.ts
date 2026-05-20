import type { Project } from "@prisma/client";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { getServerAuthSession } from "~/server/auth";
import { authMiddleware } from "./auth";

export type DualAuthVariables = {
  project?: Project;
  apiKeyProjectId?: string;
  userId?: string;
};

/**
 * Dual-auth middleware for browser-served byte endpoints.
 *
 * Browsers fire <audio src="/api/files/:id"> with the session cookie and no
 * custom headers — the standard authMiddleware (API key headers only) would
 * 401 these. So we try API-key auth first; if it returns 401/403 we accept
 * a valid session cookie. Any other failure (5xx, DB outage, malformed
 * config) surfaces to the caller instead of being silently retried as
 * session auth — masking real errors as 401 is its own bug class.
 *
 * On success, `c.var.userId` (session path) or `c.var.apiKeyProjectId`
 * (API-key path) is set so the handler can apply the right gate.
 *
 * CONTRACT — noop-next invocation of authMiddleware
 * --------------------------------------------------
 * `authMiddleware` is called with a no-op `next()` because the only useful
 * work it does here is the side effect of populating `c.var.project` (plus
 * `c.var.apiKeyProjectId` internally). We do NOT want it to advance to the
 * route handler — that is `dualAuth`'s job once both auth paths have been
 * tried.
 *
 * Context variables this middleware MUST populate before calling `next()`:
 *   - API-key path: `c.var.project` (set by authMiddleware) and
 *     `c.var.apiKeyProjectId` (derived here from project.id)
 *   - Session path: `c.var.userId` (set here from the session cookie)
 *
 * WARNING: if `authMiddleware` is ever changed so that `next` MUST run for
 * its side effects to take hold (e.g. audit logging written in a
 * post-`next` callback, telemetry spans flushed via `await next()`, OTel
 * span finalization), the API-key path of `dualAuth` will silently degrade —
 * `authMiddleware` will return without error but without populating
 * `c.var.project`. The runtime assertion below is the early-warning system
 * for exactly that scenario: it converts a silent degradation into a hard
 * 500 that surfaces in dev and test rather than rotting undetected in prod.
 */
export const dualAuth: MiddlewareHandler<{ Variables: DualAuthVariables }> =
  async (c, next) => {
    // Skip the API-key path entirely when the caller didn't send credentials —
    // authMiddleware ALWAYS rejects a credential-less request with a 401 JSON
    // response (not a thrown HTTPException), and an unconditional invocation
    // would leave c.res populated with a 401 body that no downstream cares
    // about. Detect both Authorization header forms (Basic / Bearer) and the
    // legacy X-Auth-Token header.
    const hasApiKeyCredentials =
      c.req.header("authorization") != null ||
      c.req.header("x-auth-token") != null;

    if (hasApiKeyCredentials) {
      try {
        await authMiddleware(c, async () => {
          /* no-op: just want the side effect of populating c.var.project */
        });
        const project = c.get("project");
        if (project) {
          c.set("apiKeyProjectId", project.id);
          return await next();
        }
        // authMiddleware returned without throwing AND without populating
        // c.var.project — it produced a 401 JSON response via c.json() (its
        // failure shape for malformed/expired credentials). Fall through to
        // session auth: the caller may also have a valid session cookie.
      } catch (err) {
        if (err instanceof HTTPException) {
          const status = err.status as number;
          // 401 / 403 — fall through to session auth. Anything else is a real
          // server-side failure; let it bubble up to onError as a 5xx.
          if (status !== 401 && status !== 403) throw err;
        } else {
          // Non-HTTPException: don't swallow.
          throw err;
        }
      }
    }

    const session = await getServerAuthSession({ req: c.req.raw });
    if (!session?.user?.id) {
      throw new HTTPException(401, { message: "unauthenticated" });
    }
    c.set("userId", session.user.id);
    return next();
  };
