// Verify session cookies through Better Auth and AuthApi module.
import type { BrowserSessionApi, VerifiedBrowserSession } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import type { ApiRestBrowserCaller } from "../app-rest/api-rest.host.ts";
import type { ApiTrpcSessionResolver } from "../app-trpc/api-trpc.host.ts";

const logger = createLogger("langwatch:api:auth");

/**
 * The Better Auth instance's own session lookup, as this process reads it.
 * Structural rather than the library's type: the composition that builds the
 * instance hands it through unreshaped, and this is the one method read here.
 */
export type BetterAuthSessionLookup = Readonly<{
  api: Readonly<{
    getSession(input: { headers: Headers }): Promise<VerifiedBrowserSession | null>;
  }>;
}>;

/** The Better Auth request boundary required by the API process. */
export abstract class ApiBrowserSessionTransport {
  /** A missing or unusable Better Auth session resolves to null. */
  abstract tryResolveVerifiedSession(request: Request): Promise<VerifiedBrowserSession | null>;
}

/**
 * The cookie names a Better Auth session token can arrive under.
 */
const SESSION_TOKEN_COOKIE = /(?:^|;\s*)([^=;\s]*session_token)=/g;

/** The session-token cookie names on a request, values never read. */
function presentedSessionCookies(request: Request): string[] {
  const cookie = request.headers.get("cookie");
  if (!cookie) return [];
  return [...cookie.matchAll(SESSION_TOKEN_COOKIE)].flatMap(([, name]) => (name ? [name] : []));
}

/**
 * Adapts Better Auth's verified browser session lookup to the API process. Two failures
 * are told apart here, and keeping them apart is the point.
 */
export class BetterAuthBrowserSessionTransportAdapter extends ApiBrowserSessionTransport {
  static create(transport: BetterAuthSessionLookup): BetterAuthBrowserSessionTransportAdapter {
    return new BetterAuthBrowserSessionTransportAdapter(transport);
  }

  private constructor(private readonly transport: BetterAuthSessionLookup) {
    super();
  }

  async tryResolveVerifiedSession(request: Request): Promise<VerifiedBrowserSession | null> {
    const presented = presentedSessionCookies(request);
    try {
      const verified = await this.transport.api.getSession({ headers: request.headers });
      if (!verified && presented.length > 0) {
        logger.warn(
          { cookies: presented },
          "Better Auth rejected a browser session token this request presented; the caller is treated as anonymous",
        );
      }
      return verified;
    } catch (error) {
      logger.error(
        { error, cookies: presented },
        "Better Auth browser-session lookup failed; treating request as anonymous",
      );
      return null;
    }
  }
}

/** What this process resolves a session cookie into, once per request. */
export type ApiBrowserSessionResolver = (
  request: Request,
) => Promise<ApiRestBrowserCaller | null>;

// Joins two halves into one resolver. Composed once so doors agree on identity.
export function composeApiBrowserSession(options: {
  sessions: ApiBrowserSessionTransport;
  auth: BrowserSessionApi;
}): ApiBrowserSessionResolver {
  const { sessions, auth } = options;

  return async (request) => {
    const verified = await sessions.tryResolveVerifiedSession(request);
    if (!verified) return null;

    const session = await auth.tryResolveBrowserSession({ verified });
    if (!session) {
      // Better Auth verified the cookie and the Auth service still found no
      // live session: the row is gone, revoked, or was never this process's
      // to see. Distinct from an anonymous caller for the same reason the
      // transport's own refusal is, and silent for the same cost.
      logger.warn(
        { sessionId: verified.session.id, userId: verified.user.id },
        "Better Auth verified a browser session the Auth service could not resolve; the caller is treated as anonymous",
      );

      return { authSessionId: verified.session.id };
    }

    return {
      authSessionId: verified.session.id,
      userId: session.user.id,
      ...(session.user.email ? { email: session.user.email } : {}),
      ...(session.user.impersonator ? { impersonator: session.user.impersonator } : {}),
    };
  };
}

// tRPC door resolver. Returns full user, not just id-email caller.
export function composeApiTrpcSession(options: {
  auth: BrowserSessionApi;
}): ApiTrpcSessionResolver {
  const { auth } = options;
  const sessions = BetterAuthBrowserSessionTransportAdapter.create({
    api: { getSession: (input) => auth.tryVerifyBrowserSession(input) },
  });

  return async (request) => {
    const verified = await sessions.tryResolveVerifiedSession(request);
    if (!verified) return null;

    const session = await auth.tryResolveBrowserSession({ verified });
    if (!session) return null;

    const { impersonator } = session.user;

    return {
      user: {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        ...(impersonator
          ? {
              impersonator: {
                id: impersonator.id,
                name: impersonator.name ?? null,
                email: impersonator.email ?? null,
                image: impersonator.image ?? null,
              },
            }
          : {}),
      },
      sessionId: session.sessionId,
    };
  };
}
