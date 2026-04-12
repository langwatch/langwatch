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
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Read the session token from the cookie header. BetterAuth uses
  // `__Secure-` prefix on HTTPS, plain name on HTTP.
  const cookies = req.headers.cookie ?? "";
  const sessionToken =
    extractCookie(cookies, "__Secure-better-auth.session_token") ??
    extractCookie(cookies, "better-auth.session_token");

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
  //
  // BetterAuth uses `__Secure-` prefix on HTTPS (production) and no prefix
  // on HTTP (dev). We clear BOTH variants to handle all environments.
  const cookieNames = [
    "better-auth.session_token",
    "better-auth.session_data",
    "better-auth.dont_remember",
  ];

  const clearCookies: string[] = [];
  for (const name of cookieNames) {
    clearCookies.push(`${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    clearCookies.push(`__Secure-${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
  }

  res.setHeader("Set-Cookie", clearCookies);

  // If a callbackUrl is provided (GET from full-page navigation), redirect.
  // Otherwise return JSON (POST from fetch).
  const rawCallbackUrl =
    typeof req.query.callbackUrl === "string" ? req.query.callbackUrl : null;
  if (rawCallbackUrl) {
    // Prevent open redirect: only allow same-origin relative paths.
    const callbackUrl =
      rawCallbackUrl.startsWith("/") && !rawCallbackUrl.startsWith("//")
        ? rawCallbackUrl
        : "/";
    res.redirect(302, callbackUrl);
  } else {
    res.status(200).json({ success: true });
  }
}

function extractCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}
