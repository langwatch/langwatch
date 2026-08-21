import { arbitrateClaims } from "@langwatch/authz";
import { HandledError } from "@langwatch/handled-error";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Project } from "~/generated/prisma/client";
import { getTokenType } from "~/server/api-key/api-key-token.utils";
import { extractCredentials } from "~/server/api-key/auth-middleware";
import { getServerAuthSession } from "~/server/auth";
import { authMiddleware } from "./auth";

/**
 * More than one credential kind claimed the request. A knowable cause the
 * caller can act on — drop one credential — so it carries a stable `code`
 * rather than prose a caller would have to string-match, and is
 * distinguishable on the wire from the plain unauthenticated 401.
 */
export class ContestedCredentialsError extends HandledError {
  declare readonly code: "contested_credentials";

  constructor(kinds: readonly string[]) {
    super(
      "contested_credentials",
      "The request carries more than one credential. Send exactly one.",
      { httpStatus: 401, meta: { kinds: [...kinds] }, fault: "customer" },
    );
    this.name = "ContestedCredentialsError";
  }
}

export type DualAuthVariables = {
  project?: Project;
  apiKeyProjectId?: string;
  userId?: string;
};

/** The two credential kinds a browser-served byte endpoint accepts. */
type ByteEndpointClaim =
  | { kind: "api-key" }
  | { kind: "session"; userId: string };

/**
 * Dual-auth middleware for browser-served byte endpoints.
 *
 * Browsers fire <audio src="/api/files/:id"> with the session cookie and no
 * custom headers — the standard authMiddleware (API key headers only) would
 * 401 these. So the endpoint accepts either credential kind, decided by
 * arbitration (`arbitrateClaims`, specs/rbac/credential-arbitration.feature):
 * a kind claims the request iff it is in play — extractable API-key material
 * in the headers, or a cookie jar that resolves to a live session — and
 * exactly one claim proceeds.
 *
 *   - API key alone: the unified auth middleware decides, and its refusal is
 *     final. An invalid key is that key's own 401, never a silent retry as
 *     the session — masking one credential's failure with another identity
 *     was the bug class the old 401/403 fallback carried.
 *   - Session alone: the session authenticates.
 *   - Both: refused as contested. Arbitration never ranks credentials — a
 *     precedence rule is a guess about which identity the caller meant.
 *   - Neither: structurally unauthenticated.
 *
 * On success, `c.var.userId` (session path) or `c.var.apiKeyProjectId`
 * (API-key path) is set so the handler can apply the right gate.
 *
 * CONTRACT — noop-next invocation of authMiddleware
 * --------------------------------------------------
 * `authMiddleware` is called with a no-op `next()` because the only useful
 * work it does here is the side effect of populating `c.var.project` (plus
 * `c.var.apiKeyProjectId` internally). We do NOT want it to advance to the
 * route handler — that is `dualAuth`'s job once arbitration has decided.
 *
 * WARNING: if `authMiddleware` is ever changed so that `next` MUST run for
 * its side effects to take hold (e.g. audit logging written in a
 * post-`next` callback, telemetry spans flushed via `await next()`, OTel
 * span finalization), the API-key path of `dualAuth` will silently degrade —
 * `authMiddleware` will return without error but without populating
 * `c.var.project`, and the caller receives authMiddleware's own refusal
 * response rather than a silent pass.
 */
export const dualAuth: MiddlewareHandler<{
  Variables: DualAuthVariables;
}> = async (c, next) => {
  const apiKeyCredentials = extractCredentials((name) => c.req.header(name));
  // The API key claims only when its material could plausibly be ours. A
  // reverse proxy that terminates its own `auth_basic` (or a corporate proxy
  // injecting `Authorization: Basic base64(user:pass)` upstream) makes the
  // browser send a well-formed Basic header on every <img>/<audio> request;
  // `extractCredentials` would read it as a credential, and without this gate
  // it would contest with the session cookie and 401 every avatar and media
  // fetch on proxy-fronted deployments. `getTokenType` returns "unknown" for
  // anything without a LangWatch prefix, so a foreign header abstains and the
  // session decides — while a real `sk-lw-`/`pat-lw-`/`ik-lw-` credential
  // still claims and still contests a co-present session, which is the point.
  const apiKeyClaimed =
    apiKeyCredentials != null &&
    getTokenType(apiKeyCredentials.token) !== "unknown";
  // A session claims only when the cookie jar resolves to a live session:
  // better-auth owns the cookie's name and shape, so resolution is the one
  // stable "this kind is in play" test. A stale or absent cookie abstains,
  // which also keeps an expired leftover cookie from contesting a valid
  // API-key request.
  const session = await getServerAuthSession({ req: c.req.raw });
  const sessionUserId = session?.user?.id;

  const arbitration = arbitrateClaims<ByteEndpointClaim>([
    apiKeyClaimed ? { kind: "api-key" } : null,
    sessionUserId ? { kind: "session", userId: sessionUserId } : null,
  ]);

  if (arbitration.outcome === "unclaimed") {
    throw new HTTPException(401, { message: "unauthenticated" });
  }
  if (arbitration.outcome === "contested") {
    throw new ContestedCredentialsError(arbitration.kinds);
  }

  if (arbitration.claim.kind === "session") {
    c.set("userId", arbitration.claim.userId);
    return next();
  }

  const authResult = await authMiddleware(c, async () => {
    /* no-op: just want the side effect of populating c.var.project */
  });
  const project = c.get("project");
  if (!project) {
    // authMiddleware refused (it answers by returning a c.json response,
    // not by throwing) — that refusal response stands. The claimed
    // credential's failure is the request's failure; there is nothing to
    // fall back to. Invoked manually rather than through Hono's compose,
    // the returned Response must be handed back explicitly.
    if (authResult instanceof Response) return authResult;
    // Neither a project nor a refusal response: the silent degradation the
    // CONTRACT block above warns about (authMiddleware stopped populating
    // c.var.project as a side effect). Falling through here would let Hono
    // answer a bare 404 on a valid credential. Surface it as a logged 500
    // with a trace id instead, so the regression shows up in dev and test
    // rather than rotting in prod.
    throw new Error(
      "dualAuth: authMiddleware returned without populating project or a refusal response",
    );
  }
  c.set("apiKeyProjectId", project.id);
  return next();
};
