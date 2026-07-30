import { ClaimRequiresIdentityError } from "@langwatch/ai-onboarding";
import type { Context, MiddlewareHandler } from "hono";
import type { NextRequest } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { validateAccessToken } from "~/server/routes/auth-cli";

/**
 * Resolving *who* is claiming. Two credentials, because the two halves of the
 * claim flow are driven by different things: a browser carries a session
 * cookie, a logged-in terminal carries a CLI access token. Neither is
 * interchangeable with the other, so each endpoint declares the one it takes
 * rather than accepting both and hoping.
 *
 * Both middlewares store the resolved id under one key, so handlers read the
 * caller the same way regardless of how they were authenticated.
 */

const USER_ID = "agentOnboardingUserId";

export function userIdFrom(c: Context): string | null {
  return (c.get(USER_ID) as string | undefined) ?? null;
}

/** The human half of the handoff: a signed-in browser. */
export const browserSessionAuth: MiddlewareHandler = async (c, next) => {
  const session = await getServerAuthSession({
    req: c.req.raw as unknown as NextRequest,
  });
  if (!session?.user?.id) throw new ClaimRequiresIdentityError();

  c.set(USER_ID, session.user.id);
  await next();
};

/**
 * A terminal that already logged in via the device flow. Reuses
 * `validateAccessToken` from the device-flow route rather than re-deriving
 * the token format and its Redis layout — one definition of what a CLI
 * session is.
 */
export const deviceSessionAuth: MiddlewareHandler = async (c, next) => {
  const record = await validateAccessToken(c.req.header("authorization"));
  if (!record) throw new ClaimRequiresIdentityError();

  c.set(USER_ID, record.user_id);
  await next();
};
