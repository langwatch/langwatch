import type { NextApiRequest, GetServerSidePropsContext } from "next";
import type { NextRequest } from "next/server";
import type { DefaultSession, Session } from "next-auth";
import { prisma } from "~/server/db";
import { isAdmin } from "./isAdmin";
import { getNextAuthSessionToken } from "~/utils/auth";

/**
 * Handles admin impersonation sessions.
 * If the current user is an admin with an active impersonation session,
 * returns a modified session with the impersonated user's data.
 */
export async function handleAdminImpersonationSession({
  req,
  session,
  user,
}: {
  req: NextApiRequest | GetServerSidePropsContext["req"] | NextRequest;
  session: any;
  user: any;
}): Promise<DefaultSession | Session | null> {
  const sessionToken = getNextAuthSessionToken(req as any);
  if (!isAdmin(user) || !sessionToken) return null;

  const dbSession = await prisma.session.findUnique({
    where: { sessionToken },
  });

  if (
    dbSession?.impersonating &&
    typeof dbSession?.impersonating === "object" &&
    (dbSession.impersonating as any).expires &&
    new Date((dbSession.impersonating as any).expires) > new Date()
  ) {
    return {
      ...session,
      user: {
        ...(dbSession.impersonating as any),
        impersonator: {
          ...session.user,
          ...user,
        },
      },
    };
  }

  return null;
}
