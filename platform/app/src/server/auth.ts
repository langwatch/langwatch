import { createLogger } from "@langwatch/observability";
import type { AuthService, BrowserSession, VerifiedBrowserSession } from "@langwatch/auth-contract";
import type { IncomingHttpHeaders } from "http";

const logger = createLogger("langwatch:auth");

type BrowserSessionLookup = {
  api: {
    getSession(input: { headers: Headers }): Promise<VerifiedBrowserSession | null>;
  };
};

export type BrowserSessionApplication = {
  auth: AuthService;
  betterAuth: BrowserSessionLookup;
};

/**
 * The session shape consumers across the codebase rely on.
 *
 * This is intentionally backwards-compatible with the NextAuth `Session` type
 * so that the ~40 consumer files that read `session.user.id`, `.email`,
 * `.impersonator`, and `.pendingSsoSetup` continue to work without change.
 *
 * The underlying session store is BetterAuth; this file adapts the shape.
 */
export interface Session {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    pendingSsoSetup?: boolean;
    /**
     * Set when an admin is impersonating another user. The outer
     * `session.user` fields reflect the impersonated user; `impersonator`
     * reflects the real admin for audit logging and UI banners.
     */
    impersonator?: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  };
  /** ISO-8601 expiration timestamp. */
  expires: string;
  /**
   * The BetterAuth session row id (Session.id in Postgres). Exposed so
   * server-side mutations like `changePassword` can call
   * `revokeOtherBrowserSessions({keepSessionId})` without re-fetching the
   * BetterAuth session via headers. This is the impersonation-aware
   * session id — i.e. the OUTER admin's session id, NOT the impersonated
   * user's id, since impersonation reuses the admin's session row.
   *
   * Optional because many test fixtures construct fake Session objects
   * without one, and the legacy NextAuth Session type didn't have it.
   * Production runtime always populates it via `getServerAuthSession`.
   */
  sessionId?: string;
}

const toHeaders = (input: IncomingHttpHeaders | Headers | undefined): Headers => {
  if (!input) return new Headers();
  if (input instanceof Headers) return input;
  const h = new Headers();
  for (const [k, v] of Object.entries(input)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const x of v) h.append(k, x);
    } else {
      h.set(k, String(v));
    }
  }
  return h;
};

/**
 * Server-side session fetch. Wraps BetterAuth's `auth.api.getSession`.
 *
 * Preserves the old NextAuth-shaped Session so consumer code does not
 * need to know the underlying auth provider changed. Also handles admin
 * impersonation by inspecting the `Session.impersonating` JSON column and
 * rewriting `session.user` to the impersonated identity.
 *
 * Accepts either `{ req, res }` (Pages Router / getServerSideProps) or
 * `{ req }` (App Router — pass a NextRequest).
 */
export const getServerAuthSession = async (ctx: {
  app: BrowserSessionApplication;
  req: { headers?: IncomingHttpHeaders | Headers };
  res?: unknown;
}): Promise<Session | null> => {
  try {
    const headers = toHeaders(ctx.req.headers);
    const result = await ctx.app.betterAuth.api.getSession({ headers });
    if (!result) return null;
    return await ctx.app.auth.tryResolveBrowserSession({
      verified: {
        session: {
          id: result.session.id,
          expiresAt: result.session.expiresAt,
        },
        user: {
          id: result.user.id,
          name: result.user.name ?? null,
          email: result.user.email ?? null,
          image: result.user.image ?? null,
          pendingSsoSetup: result.user.pendingSsoSetup ?? false,
        },
      },
    });
  } catch (error) {
    // Most common cause: Redis (better-auth secondary store) is down and the
    // session lookup times out. Symptom for the user is an endless
    // "Redirecting to Sign in..." loop. Log with a clear hint so the first
    // server-log line the developer reads points at the real root cause.
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { error },
      `getServerAuthSession failed: ${message}\n` +
        `  If the session store (Redis) is down, the app will silently ` +
        `redirect-loop on every protected page. Check 'docker compose ps redis' ` +
        `(or your REDIS_URL target).`,
    );
    return null;
  }
};
