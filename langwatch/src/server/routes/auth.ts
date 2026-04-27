/**
 * Hono routes for authentication.
 *
 * Replaces:
 * - src/pages/api/auth/[...all].ts  (BetterAuth catch-all)
 * - src/pages/api/auth/session.ts   (impersonation-aware session)
 * - src/pages/api/auth/logout.ts    (explicit cookie-clearing logout)
 * - src/pages/api/auth/validate.ts  (API-key validation)
 */
import type { Context } from "hono";
import { Hono } from "hono";
import { auth } from "~/server/better-auth";
import { isAllowedAuthOrigin } from "~/server/better-auth/originGate";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { connection as redisConnection } from "~/server/redis";
import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:auth");

export const app = new Hono().basePath("/api");

// ---------- POST /api/auth/validate ----------
app.post("/auth/validate", async (c) => {
  const authToken = c.req.header("x-auth-token");

  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });

  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  return c.json({ projectSlug: project.slug });
});

// ---------- GET /api/auth/session ----------
app.get("/auth/session", async (c) => {
  c.header("Cache-Control", "no-store, must-revalidate");

  const session = await getServerAuthSession({ req: c.req.raw as any });

  if (!session) {
    return c.json(null);
  }

  return c.json({
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
});

// ---------- GET|POST /api/auth/logout ----------
const logoutHandler = async (c: Context) => {
  const method = c.req.method;

  if (method !== "POST" && method !== "GET") {
    return c.json({ error: "Method not allowed" }, 405);
  }

  const cookies = c.req.header("cookie") ?? "";
  const sessionToken =
    extractCookie(cookies, "__Secure-better-auth.session_token") ??
    extractCookie(cookies, "better-auth.session_token");

  if (sessionToken) {
    try {
      const headers = new Headers();
      headers.set("cookie", cookies);
      const session = await auth.api.getSession({ headers });

      if (session) {
        const token = session.session.token;

        try {
          await prisma.session.delete({
            where: { sessionToken: token },
          });
        } catch {
          // Session may already be deleted
        }

        if (redisConnection) {
          try {
            await redisConnection.del(`better-auth:${token}`);
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

  const cookieNames = [
    "better-auth.session_token",
    "better-auth.session_data",
    "better-auth.dont_remember",
  ];

  const clearCookies: string[] = [];
  for (const name of cookieNames) {
    clearCookies.push(`${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    clearCookies.push(
      `__Secure-${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    );
  }

  // Hono supports multiple Set-Cookie headers via append
  for (const cookie of clearCookies) {
    c.header("Set-Cookie", cookie, { append: true });
  }

  if (method === "GET") {
    if (
      env.NEXTAUTH_PROVIDER === "auth0" &&
      env.AUTH0_ISSUER &&
      env.AUTH0_CLIENT_ID
    ) {
      const returnTo = encodeURIComponent(
        `${env.NEXTAUTH_URL}/auth/signin`,
      );
      const federatedLogoutUrl = `${env.AUTH0_ISSUER}/v2/logout?client_id=${env.AUTH0_CLIENT_ID}&returnTo=${returnTo}`;
      return c.redirect(federatedLogoutUrl, 302);
    } else {
      return c.redirect("/auth/signin", 302);
    }
  } else {
    return c.json({ success: true });
  }
};

app.get("/auth/logout", logoutHandler);
app.post("/auth/logout", logoutHandler);

// ---------- /api/auth/* catch-all (BetterAuth) ----------
app.all("/auth/*", async (c) => {
  // Origin gate for state-changing requests
  if (
    !isAllowedAuthOrigin({
      method: c.req.method,
      origin: c.req.header("origin"),
      referer: c.req.header("referer"),
      baseUrl: env.NEXTAUTH_URL,
    })
  ) {
    return c.json(
      { message: "Invalid origin", code: "INVALID_ORIGIN" },
      403,
    );
  }

  // BetterAuth's auth.handler is fetch-compatible (Request => Response)
  return auth.handler(c.req.raw);
});

function extractCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}
