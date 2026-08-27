import { createLogger } from "@langwatch/observability";
import type { IncomingHttpHeaders } from "http";
import {
  ownPrincipal,
  type SessionPrincipal,
} from "~/server/app-layer/authz/principal";
import { resolveSessionPrincipal } from "~/server/app-layer/identity/impersonation-claims";
import { identityEmail } from "~/server/app-layer/identity/runtime";
import { auth } from "~/server/better-auth";
import { prisma } from "~/server/db";
import type {
  GetServerSidePropsContext,
  NextApiRequest,
  NextRequest,
} from "~/types/next-stubs";

const logger = createLogger("langwatch:auth");

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
   * Who really made the request and whose access it exercises (D06). Equal
   * halves on every ordinary session; they come apart under impersonation,
   * and every authorization decision records both.
   *
   * Optional for the same reason `sessionId` is: many test fixtures build a
   * Session by hand. Production always populates it via `getServerAuthSession`,
   * and a caller without one falls back to the session user acting as
   * themselves — never to an impersonation.
   */
  principal?: SessionPrincipal;
  /**
   * Why the operator started the impersonation, when one is running. Recorded
   * beside both people; absent on every ordinary session.
   */
  impersonationReason?: string;
  /**
   * The BetterAuth session row id (Session.id in Postgres). Exposed so
   * server-side mutations like `changePassword` can call
   * `revokeOtherSessionsForUser({keepSessionId})` without re-fetching the
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

const toHeaders = (
  input: IncomingHttpHeaders | Headers | undefined,
): Headers => {
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
 * impersonation by reading the session's `{actor, subject}` claims and
 * rewriting `session.user` to the subject's identity, while `principal`
 * keeps naming both people for every authorization decision that follows.
 *
 * Accepts either `{ req, res }` (Pages Router / getServerSideProps) or
 * `{ req }` (App Router — pass a NextRequest).
 */
export const getServerAuthSession = async (ctx: {
  req: NextApiRequest | GetServerSidePropsContext["req"] | NextRequest;
  res?: unknown;
}): Promise<Session | null> => {
  try {
    const headers = toHeaders(
      (ctx.req as { headers?: IncomingHttpHeaders | Headers }).headers,
    );
    const result = await auth.api.getSession({ headers });
    if (!result) return null;

    // ADR-101 §5, the read fork: for a user whose backfill is finalized the
    // identifiers own their email and `User.email` is a stale copy, so the
    // session carries the identifier's answer. null keeps the column's.
    const identityResolvedEmail = await identityEmail().resolveEmail({
      userId: result.user.id,
    });

    const baseSession: Session = {
      user: {
        id: result.user.id,
        name: result.user.name ?? null,
        email: identityResolvedEmail ?? result.user.email ?? null,
        image: result.user.image ?? null,
        pendingSsoSetup:
          ((result.user as Record<string, unknown>).pendingSsoSetup as
            | boolean
            | undefined) ?? false,
      },
      expires:
        result.session.expiresAt instanceof Date
          ? result.session.expiresAt.toISOString()
          : new Date(result.session.expiresAt).toISOString(),
      sessionId: result.session.id,
      principal: ownPrincipal({ userId: result.user.id }),
    };

    // The session's own impersonation claims (D06). `{actor, subject}` on the
    // row, which is the shape the authz principal speaks — it replaced a JSON
    // payload that carried a stale copy of the impersonated user's name and
    // e-mail and named the operator nowhere at all.
    const dbSession = await prisma.session.findUnique({
      where: { id: result.session.id },
      select: {
        userId: true,
        actorUserId: true,
        subjectUserId: true,
        impersonationReason: true,
        impersonationExpiresAt: true,
      },
    });

    // Fail closed when BetterAuth returns a cached session but the DB row
    // is gone. This happens when a session was revoked (either via the
    // tRPC `user.deactivate`/`changePassword` flow or the admin panel)
    // and the Redis cache deletion failed or the cache entry outlived the
    // DB row for any other reason. Without this guard, a revoked session
    // would keep authenticating server-side callers until the cache TTL
    // expired (up to 30 days). Caught by CodeRabbit in PR review (bug 38).
    if (!dbSession) {
      logger.warn(
        { sessionId: result.session.id, userId: result.user.id },
        "BetterAuth returned a cached session that no longer exists in the DB; treating it as revoked",
      );
      return null;
    }

    const principal = resolveSessionPrincipal({
      claims: {
        sessionUserId: dbSession.userId,
        actorUserId: dbSession.actorUserId,
        subjectUserId: dbSession.subjectUserId,
        impersonationExpiresAt: dbSession.impersonationExpiresAt,
      },
    });

    if (principal.subject.userId !== principal.actor.userId) {
      // The subject is read fresh on every request rather than copied onto
      // the session at start: a person deleted or deactivated AFTER the
      // impersonation began must not still be acted for, and their name and
      // e-mail must not be a stale snapshot from an hour ago.
      const subject = await prisma.user.findUnique({
        where: { id: principal.subject.userId },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          deactivatedAt: true,
        },
      });

      if (subject && !subject.deactivatedAt) {
        // The impersonated user takes the same fork as anyone else; the
        // impersonator's own email rides in already resolved.
        const subjectEmail = await identityEmail().resolveEmail({
          userId: subject.id,
        });
        return {
          ...baseSession,
          principal,
          impersonationReason: dbSession.impersonationReason ?? undefined,
          user: {
            id: subject.id,
            name: subject.name ?? null,
            email: subjectEmail ?? subject.email ?? null,
            image: subject.image ?? null,
            impersonator: {
              id: baseSession.user.id,
              name: baseSession.user.name ?? null,
              email: baseSession.user.email ?? null,
              image: baseSession.user.image ?? null,
            },
          },
        };
      }
      logger.warn(
        {
          actorUserId: principal.actor.userId,
          subjectUserId: principal.subject.userId,
        },
        "Impersonation subject is deleted or deactivated — falling back to the operator's own session",
      );
    }

    return baseSession;
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
