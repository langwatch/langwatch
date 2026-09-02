/**
 * The two credential kinds a browser-served BYTE endpoint accepts, arbitrated.
 *
 * Browsers fire `<audio src="/api/files/:id">` and `<img src="/api/user-avatar/…">`
 * with the session cookie and no custom headers, so a key-only chain would 401
 * the in-app player and every member list. These endpoints therefore accept
 * either a project API key or a browser session, decided by arbitration
 * (`arbitrateClaims`, specs/rbac/credential-arbitration.feature): a kind claims
 * the request iff it is in play — extractable API-key material in the headers,
 * or a cookie jar that resolves to a live session — and exactly one claim
 * proceeds.
 *
 *   - API key alone: the key decides, and its refusal is final. An invalid key
 *     is that key's own 401, never a silent retry as the session — masking one
 *     credential's failure with another identity was the bug class the old
 *     401/403 fallback carried.
 *   - Session alone: the session authenticates.
 *   - Both: refused as contested. Arbitration never ranks credentials — a
 *     precedence rule is a guess about which identity the caller meant.
 *   - Neither: structurally unauthenticated.
 *
 * On success `c.var.userId` (session path) or `c.var.apiKeyProjectId` (API-key
 * path) is set, so the handler applies the right gate.
 *
 * This process resolves both through the SAME services its framework chain and
 * its tRPC boundary do — `ApiKeyService` and `ApiHandlerManagedSession` — rather
 * than through a second middleware of its own, so the byte doors and every
 * other door cannot decide differently about one caller.
 */
import { getTokenType, type ApiKeyService } from "@langwatch/api-key-contract";
import { arbitrateClaims } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ApiHandlerManagedSessionPort } from "./api-handler-managed-session";
import { extractApiKeyRequestCredentials } from "./api-key-request-credentials";

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

export type ApiDualAuthVariables = {
  apiKeyProjectId?: string;
  userId?: string;
};

/**
 * Whether the Authorization material claims the request. A prefix-less token
 * is either a legacy project key (pre-`sk-lw-`, still valid) or a reverse
 * proxy's own Basic header riding along on an `<img>`/`<audio>` fetch — the
 * prefix cannot tell them apart. So: with a live session, an unknown-prefix
 * token abstains and the session decides; with no session it claims and the
 * key lookup decides. A recognized LangWatch prefix always claims.
 */
function apiKeyClaims({
  token,
  sessionUserId,
}: {
  token: string | null;
  sessionUserId: string | null;
}): boolean {
  if (token == null) return false;
  if (getTokenType(token) !== "unknown") return true;
  return sessionUserId == null;
}

/** The two credential kinds a browser-served byte endpoint accepts. */
type ByteEndpointClaim = { kind: "api-key" } | { kind: "session"; userId: string };

/** Builds the byte endpoints' verifier for one process's credential graph. */
export function createApiDualCredentialAuth(options: {
  apiKeys: ApiKeyService;
  session: ApiHandlerManagedSessionPort;
}): MiddlewareHandler<{ Variables: ApiDualAuthVariables }> {
  const { apiKeys, session } = options;

  return async (c, next) => {
    const credentials = extractApiKeyRequestCredentials(c.req.raw);
    // A session claims only when the cookie jar resolves to a live session:
    // the auth transport owns the cookie's name and shape, so resolution is
    // the one stable "this kind is in play" test. A stale or absent cookie
    // abstains, which also keeps an expired leftover cookie from contesting a
    // valid API-key request.
    const person = await session.resolve(c.req.raw);
    const sessionUserId = person?.user.id ?? null;
    const claimed = apiKeyClaims({ token: credentials?.token ?? null, sessionUserId });

    const arbitration = arbitrateClaims<ByteEndpointClaim>([
      claimed ? { kind: "api-key" } : null,
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

    // The claimed credential's failure is the request's failure; there is
    // nothing to fall back to.
    const resolved = credentials
      ? await apiKeys.tryResolveToken({
          token: credentials.token,
          ...(credentials.projectId ? { projectId: credentials.projectId } : {}),
        })
      : null;
    if (!resolved) {
      throw new HTTPException(401, { message: "unauthenticated" });
    }

    c.set("apiKeyProjectId", resolved.project.id);
    return next();
  };
}
