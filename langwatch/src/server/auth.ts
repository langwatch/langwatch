import type { IncomingHttpHeaders } from "http";
import type { GetServerSidePropsContext, NextApiRequest } from "next";
import type { NextRequest } from "next/server";

import { auth } from "~/server/better-auth";
import { prisma } from "~/server/db";
import { createLogger } from "../utils/logger/server";

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
 * impersonation by inspecting the `Session.impersonating` JSON column and
 * rewriting `session.user` to the impersonated identity.
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

    const baseSession: Session = {
      user: {
        id: result.user.id,
        name: result.user.name ?? null,
        email: result.user.email ?? null,
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
    };

    // Admin impersonation compat: read Session.impersonating JSON directly.
    // We keep this legacy column (added in migration 20260406120000) so the
    // existing impersonate endpoint + UI banner keep working unchanged.
    const dbSession = await prisma.session.findUnique({
      where: { id: result.session.id },
      select: { impersonating: true },
    });

    const impersonating = dbSession?.impersonating as
      | {
          id?: string;
          name?: string | null;
          email?: string | null;
          image?: string | null;
          expires?: string | Date;
        }
      | null
      | undefined;

    if (
      impersonating &&
      typeof impersonating === "object" &&
      impersonating.id &&
      impersonating.expires &&
      new Date(impersonating.expires) > new Date()
    ) {
      // Verify the impersonation target still exists and isn't deactivated.
      // If the target was deleted or deactivated AFTER impersonation started,
      // fall through to the real admin session rather than acting on behalf
      // of a stale / banned user. The cost is a single findUnique per
      // impersonated request — acceptable for a flow used only by admins.
      const targetStillValid = await prisma.user.findUnique({
        where: { id: impersonating.id },
        select: { id: true, deactivatedAt: true },
      });
      const isTargetActive =
        targetStillValid && !targetStillValid.deactivatedAt;

      if (isTargetActive) {
        return {
          ...baseSession,
          user: {
            id: impersonating.id,
            name: impersonating.name ?? null,
            email: impersonating.email ?? null,
            image: impersonating.image ?? null,
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
          adminId: baseSession.user.id,
          impersonatedUserId: impersonating.id,
        },
        "Impersonation target is deleted or deactivated — falling back to admin session",
      );
    }

    return baseSession;
  } catch (error) {
    logger.error({ error }, "getServerAuthSession failed");
    return null;
  }
};
