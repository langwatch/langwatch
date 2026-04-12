import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "~/server/auth";

/**
 * Custom session endpoint that returns the impersonation-aware session.
 *
 * BetterAuth's built-in `/api/auth/get-session` returns the raw session
 * (always the admin's identity). Our `getServerAuthSession` reads the
 * `Session.impersonating` JSON column and rewrites `session.user` to
 * the impersonated user when active.
 *
 * The client-side `useSession()` hook fetches from this endpoint instead
 * of BetterAuth's built-in one so the avatar, org bouncer, and all
 * client-side UI reflects the impersonated identity.
 */
export default async function sessionHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerAuthSession({ req });

  if (!session) {
    res.status(200).json(null);
    return;
  }

  // Return in BetterAuth's { session, user } shape so adaptSession works.
  res.status(200).json({
    session: {
      expiresAt: session.expires,
    },
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      pendingSsoSetup: session.user.pendingSsoSetup,
      impersonator: session.user.impersonator,
    },
  });
}
