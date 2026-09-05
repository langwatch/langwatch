/**
 * The two credential kinds a browser-served BYTE endpoint accepts, arbitrated.
 */
import { getTokenType, type ApiKeyService } from "@langwatch/api-key-contract";
import { arbitrateClaims, type AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ApiHandlerManagedCredentials } from "./api-handler-managed-credential";
import type { ApiHandlerManagedSessionPort } from "./api-handler-managed-session";
import { extractApiKeyRequestCredentials } from "./api-key-request-credentials";

/**
 * More than one credential kind claimed the request.
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
  /**
   * The resolved key's ceiling, bound to the credential this request carried.
   */
  apiKeyCeiling?: (permission: AuthzPermission) => Promise<void>;
};

/**
 * Whether the Authorization material claims the request. A prefix-less token is either a
 * legacy project key (pre-`sk-lw-`, still valid) or a reverse proxy's own Basic header
 * riding along on an `<img>`/`<audio>` fetch — the prefix cannot tell them apart.
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
  /** The SAME ceiling the framework chain enforces, for the API-key branch. */
  credentials: Pick<ApiHandlerManagedCredentials, "enforceCeiling">;
}): MiddlewareHandler<{ Variables: ApiDualAuthVariables }> {
  const { apiKeys, session, credentials: ceiling } = options;

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
    c.set("apiKeyCeiling", (permission) => ceiling.enforceCeiling({ resolved, permission }));
    return next();
  };
}
