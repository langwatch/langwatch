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
import { env } from "~/env.mjs";
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import { getServerAuthSession } from "~/server/auth";
import { auth } from "~/server/better-auth";
import { isAllowedAuthOrigin } from "~/server/better-auth/originGate";
import { prisma } from "~/server/db";
import { connection as redisConnection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";
import {
  buildAuthorizationUrl,
  buildStateCookie,
  clearStateCookie,
  exchangeCodeForUser,
  generateState,
  parseStateCookie,
} from "~/server/sso/ssoOAuth";
import { SsoConnectionService } from "~/server/sso/ssoConnection.service";
import { SsoAuthService } from "~/server/sso/ssoAuth.service";

const secured = createServiceApp({ basePath: "/api" });

const authPolicy = () =>
  publicEndpoint(
    "BetterAuth session/OAuth handshake; framework manages its own session",
  );

// ---------- POST /api/auth/validate ----------
secured.access(authPolicy()).post("/auth/validate", async (c) => {
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
secured.access(authPolicy()).get("/auth/session", async (c) => {
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
      const returnTo = encodeURIComponent(`${env.NEXTAUTH_URL}/auth/signin`);
      const federatedLogoutUrl = `${env.AUTH0_ISSUER}/v2/logout?client_id=${env.AUTH0_CLIENT_ID}&returnTo=${returnTo}`;
      return c.redirect(federatedLogoutUrl, 302);
    } else {
      return c.redirect("/auth/signin", 302);
    }
  } else {
    return c.json({ success: true });
  }
};

secured.access(authPolicy()).get("/auth/logout", logoutHandler);
secured.access(authPolicy()).post("/auth/logout", logoutHandler);

// ---------- GET /api/auth/sso/:domain ----------
secured.access(authPolicy()).get("/auth/sso/:domain", async (c) => {
  const domain = c.req.param("domain");
  if (!domain) {
    return c.json({ error: "Domain is required" }, 400);
  }

  const callbackUrl = `${env.NEXTAUTH_URL}/api/auth/sso/${domain}/callback`;
  const state = generateState();
  const isSecure = env.NEXTAUTH_URL.startsWith("https");

  try {
    const connectionService = SsoConnectionService.create(prisma);
    const connection = await connectionService.getVerifiedConnectionByDomain({ domain });

    if (!connection) {
      throw new Error(`No verified SSO connection for domain ${domain}`);
    }

    const { url } = await buildAuthorizationUrl({
      connection,
      callbackUrl,
      state,
    });

    c.header(
      "Set-Cookie",
      buildStateCookie({ state, domain, secure: isSecure }),
    );

    return c.redirect(url, 302);
  } catch (err) {
    logger.error({ err, domain }, "Failed to initiate SSO login");
    return c.redirect(
      `/auth/signin?error=${encodeURIComponent("SSO configuration error. Contact your administrator.")}`,
      302,
    );
  }
});

// ---------- GET /api/auth/sso/:domain/callback ----------
secured.access(authPolicy()).get("/auth/sso/:domain/callback", async (c) => {
  const domain = c.req.param("domain");
  const code = c.req.query("code");
  const returnedState = c.req.query("state");
  const error = c.req.query("error");
  const isSecure = env.NEXTAUTH_URL.startsWith("https");

  c.header("Set-Cookie", clearStateCookie({ secure: isSecure }));

  if (error) {
    logger.warn({ domain, error }, "IdP returned error");
    return c.redirect(
      `/auth/signin?error=${encodeURIComponent("Identity provider denied the request.")}`,
      302,
    );
  }

  if (!code || !returnedState || !domain) {
    return c.redirect(
      `/auth/signin?error=${encodeURIComponent("Invalid SSO callback.")}`,
      302,
    );
  }

  const storedState = parseStateCookie(c.req.header("cookie"));
  if (
    !storedState ||
    storedState.state !== returnedState ||
    storedState.domain !== domain
  ) {
    return c.redirect(
      `/auth/signin?error=${encodeURIComponent("Invalid SSO state — please try again.")}`,
      302,
    );
  }

  const callbackUrl = `${env.NEXTAUTH_URL}/api/auth/sso/${domain}/callback`;

  try {
    const connectionService = SsoConnectionService.create(prisma);
    const connection = await connectionService.getVerifiedConnectionByDomain({ domain });

    if (!connection) {
      throw new Error(`No verified SSO connection for domain ${domain}`);
    }

    const { userInfo, provider } = await exchangeCodeForUser({
      connection,
      code,
      callbackUrl,
    });

    const ssoAuthService = SsoAuthService.create(prisma);
    const result = await ssoAuthService.handleSsoCallback({
      userInfo,
      provider,
      organizationId: connection.organizationId,
      roleMappingConfig: {
        defaultOrgRole: connection.defaultOrgRole,
        roleMapping: connection.roleMapping as Record<string, unknown> | null,
      },
      ipAddress:
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });

    if (result.redirectTo) {
      return c.redirect(result.redirectTo, 302);
    }

    const cookieName = isSecure
      ? "__Secure-better-auth.session_token"
      : "better-auth.session_token";
    const cookieParts = [
      `${cookieName}=${result.sessionToken}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${30 * 24 * 60 * 60}`,
    ];
    if (isSecure) cookieParts.push("Secure");
    c.header("Set-Cookie", cookieParts.join("; "), { append: true });

    return c.redirect("/", 302);
  } catch (err) {
    logger.error({ err, domain }, "SSO callback failed");
    return c.redirect(
      `/auth/signin?error=${encodeURIComponent("SSO login failed. Please try again or contact your administrator.")}`,
      302,
    );
  }
});

// ---------- /api/auth/* catch-all (BetterAuth) ----------
const betterAuthCatchAll = async (c: Context) => {
  // Origin gate for state-changing requests
  if (
    !isAllowedAuthOrigin({
      method: c.req.method,
      origin: c.req.header("origin"),
      referer: c.req.header("referer"),
      baseUrl: env.NEXTAUTH_URL,
    })
  ) {
    return c.json({ message: "Invalid origin", code: "INVALID_ORIGIN" }, 403);
  }

  // BetterAuth's auth.handler is fetch-compatible (Request => Response)
  return auth.handler(c.req.raw);
};

// `.all` (not a 5-verb loop) so OPTIONS/HEAD and CORS preflight reach
// BetterAuth — it terminates the request itself. Registered with method
// "ALL" + a wildcard path, this is intentionally outside the router
// introspection cross-check (a wildcard mount can't be enumerated), but it
// still carries a declared policy because it goes through `.access(...)`.
secured.access(authPolicy()).all("/auth/*", betterAuthCatchAll);

function extractCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

export const app = secured.hono;
