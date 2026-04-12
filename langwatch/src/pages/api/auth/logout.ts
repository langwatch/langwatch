import type { NextApiRequest, NextApiResponse } from "next";
import { auth } from "~/server/better-auth";
import { prisma } from "~/server/db";
import { connection as redisConnection } from "~/server/redis";

/**
 * Dedicated logout endpoint that explicitly clears BetterAuth session cookies
 * using Next.js's response API. This is a belt-and-suspenders approach:
 *
 * BetterAuth's built-in `/sign-out` endpoint calls `deleteSessionCookie(ctx)`
 * which sets `Set-Cookie` headers via its internal Hono-like context. These
 * headers are then translated to Node.js `res.setHeader` by `toNodeHandler`.
 * However, the `fetch()` call in BetterAuth's client wrapper may not always
 * propagate the `Set-Cookie` header reliably depending on the browser and
 * redirect timing.
 *
 * This endpoint guarantees cookie clearing by using `res.setHeader` directly
 * on the Next.js API response, which is the same mechanism NextAuth used.
 */
export default async function logoutHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Read the session token from the cookie header (same name BetterAuth uses)
  const cookies = req.headers.cookie ?? "";
  const sessionToken = extractCookie(cookies, "better-auth.session_token");

  if (sessionToken) {
    // Decode the signed cookie to get the raw token
    // BetterAuth signs cookies with HMAC — the format is `value.signature`
    try {
      const headers = new Headers();
      headers.set("cookie", cookies);
      const session = await auth.api.getSession({ headers });

      if (session) {
        const token = session.session.token;

        // Delete from database
        try {
          await prisma.session.delete({
            where: { sessionToken: token },
          });
        } catch {
          // Session may already be deleted
        }

        // Delete from Redis secondary storage
        if (redisConnection) {
          try {
            await redisConnection.del(`better-auth:${token}`);
            // Also clean up active-sessions list
            const listKey = `better-auth:active-sessions-${session.user.id}`;
            await redisConnection.del(listKey);
          } catch {
            // Redis cleanup is best-effort
          }
        }
      }
    } catch {
      // Session lookup failed — still clear cookies below
    }
  }

  // Explicitly clear ALL BetterAuth cookies with matching attributes.
  // This is the critical part — we set Set-Cookie headers directly on the
  // Next.js response, bypassing BetterAuth's internal cookie handling.
  const clearCookies = [
    "better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    "better-auth.session_data=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    "better-auth.dont_remember=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
  ];

  res.setHeader("Set-Cookie", clearCookies);
  res.status(200).json({ success: true });
}

function extractCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}
