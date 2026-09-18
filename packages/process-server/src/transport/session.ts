import type { SessionCaller, SessionVerification } from "@langwatch/api/rest";
// Verify session cookies through Better Auth and AuthApi module.
import type { BrowserSessionApi, VerifiedBrowserSession } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:api:auth");

export type BetterAuthSessionLookup = Readonly<{
  api: Readonly<{
    getSession(input: { headers: Headers }): Promise<VerifiedBrowserSession | null>;
  }>;
}>;

export abstract class ApiBrowserSessionTransport {
  abstract tryResolveVerifiedSession(request: Request): Promise<VerifiedBrowserSession | null>;
}

const SESSION_TOKEN_COOKIE = /(?:^|;\s*)([^=;\s]*session_token)=/g;

function presentedSessionCookies(request: Request): string[] {
  const cookie = request.headers.get("cookie");
  if (!cookie) return [];
  return [...cookie.matchAll(SESSION_TOKEN_COOKIE)].flatMap(([, name]) => (name ? [name] : []));
}

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

export function composeSessionVerification(options: {
  sessions: ApiBrowserSessionTransport;
  auth: BrowserSessionApi;
}): SessionVerification {
  const { sessions, auth } = options;

  return async (request): Promise<SessionCaller | null> => {
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
      sessionId: session.sessionId,
      userId: session.user.id,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
      ...(session.user.email ? { email: session.user.email } : {}),
      ...(session.user.impersonator ? { impersonator: session.user.impersonator } : {}),
    };
  };
}
