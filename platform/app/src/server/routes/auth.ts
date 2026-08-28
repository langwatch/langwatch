/**
 * Hono routes for authentication.
 *
 * Replaces:
 * - src/pages/api/auth/[...all].ts  (BetterAuth catch-all)
 * - src/pages/api/auth/session.ts   (impersonation-aware session)
 * - src/pages/api/auth/logout.ts    (explicit cookie-clearing logout)
 * - src/pages/api/auth/validate.ts  (API-key validation)
 */

import { resolveAuthProvider } from "@ee/sso/sso-gate";
import { runWithIdentityBirth } from "@langwatch/identity-server/better-auth";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { env } from "~/env.mjs";
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import { tryGetApp } from "~/server/app-layer/app";
import { getServerAuthSession } from "~/server/auth";
import { auth } from "~/server/better-auth";
import { isBornFinalizedSignUp } from "~/server/better-auth/bornFinalizedOptIn";
import { translateBetterAuthError } from "~/server/better-auth/handled-errors";
import { isAllowedAuthOrigin } from "~/server/better-auth/originGate";
import { runWithPasswordResetScope } from "~/server/better-auth/password-reset-session";
import { prisma } from "~/server/db";

const secured = createServiceApp({ basePath: "/api" });

const logger = createLogger("langwatch:auth");

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

        const redisConnection = tryGetApp()?.redis ?? null;
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
    // Resolved provider, not raw env: on a denied (unlicensed) deployment
    // the platform gate coerces the deployment to email mode (ADR-027), so
    // logout must not bounce the user through the IdP.
    if (
      (await resolveAuthProvider()) === "auth0" &&
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
    // The 403 body carries no detail on purpose. Without this line the reason
    // is nowhere: the access log records the status and nothing else, so a
    // misconfigured NEXTAUTH_URL is indistinguishable from a real cross-site
    // POST, which is what makes it expensive to diagnose.
    logger.warn(
      {
        path: c.req.path,
        method: c.req.method,
        expectedOrigin: env.NEXTAUTH_URL,
        receivedOrigin: c.req.header("origin") ?? null,
        receivedReferer: c.req.header("referer") ?? null,
      },
      "rejected auth request: origin does not match NEXTAUTH_URL",
    );
    return c.json({ message: "Invalid origin", code: "INVALID_ORIGIN" }, 403);
  }

  // ADR-116 §3: the born-finalized entrance's request-scoped marker, decided
  // HERE and only here, and only once the backend allowlist check has
  // passed. Nothing below re-decides it, and outside a marked request the
  // entrance is never reached — which is what makes deploying it a no-op
  // until an operator targets an organization.
  const isBorn = await isBornFinalizedSignUp({ request: c.req.raw });
  // BetterAuth's auth.handler is fetch-compatible (Request => Response). The
  // marker only changes which BRANCH the writes inside it take; the answer
  // that comes back is the same shape either way, and is translated the same
  // way below. Handling the two through one `response` is what stops them
  // drifting: the entrance used to return straight out of here, so a sign-up
  // the allowlist had opted IN was the one sign-up whose refusals skipped the
  // handled-error contract and reached the browser in better-auth's own
  // vocabulary.
  const handle = () => auth.handler(c.req.raw);
  // The reset scope is opened around EVERY request rather than only the
  // reset path: it is a per-request slot that costs nothing empty, and the
  // path check belongs to the hook that reads it, not to the route.
  const response = await runWithPasswordResetScope(() =>
    isBorn ? runWithIdentityBirth(handle) : handle(),
  );
  // better-auth's refusals speak its own vocabulary, which is neither a
  // registered code nor copy anybody wrote for a customer. This is where the
  // families we have translated join the handled-error contract; everything
  // else passes through byte for byte. See `better-auth/handled-errors.ts`.
  return translateBetterAuthError({ response, path: c.req.path });
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
