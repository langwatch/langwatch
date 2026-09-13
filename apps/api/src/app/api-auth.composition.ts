/**
 * How this process turns a request's session cookie into a VERIFIED browser
 * session, and how that verification is joined to the auth module's own live
 * session lookup.
 *
 * Two questions, kept apart, because they fail differently and the difference
 * is load-bearing:
 *
 *   1. Did Better Auth accept the cookie this request presented? That is the
 *      deployment's own request boundary — {@link ApiBrowserSessionTransport} —
 *      and its answer carries the RAW auth-session id an impersonation is
 *      started and stopped against.
 *   2. Is there still a live session behind it? That is `AuthApi`'s, a module
 *      peer, and it can answer no for a cookie Better Auth just accepted: the
 *      row is gone, revoked, or was never this process's to see.
 *
 * A process that conflated the two would start an impersonation against a
 * session that had expired, so the resolved caller reports both.
 */
import type { BrowserSessionApi, VerifiedBrowserSession } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import type { ApiRestBrowserCaller } from "../app-rest/api-rest.host.ts";

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

/**
 * Joins the two halves into the ONE resolver every session-reading door and
 * fact on this process reads. Composed once, so two doors can never decide
 * differently about who somebody is.
 *
 * A cookie Better Auth accepted whose session the auth module cannot resolve
 * still answers a caller — carrying the verified auth-session id and NO user.
 * The back office's `adminAuthSession` fact asks exactly that question, and
 * every other reader gates on `userId`, so such a caller reaches no handler.
 */
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
