/**
 * The `/api/auth` REST family: the Better Auth catch-all, the session read the browser
 * polls, the explicit logout and the legacy API-key validation.
 */

import { publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";

import { isBornFinalizedSignUp } from "../better-auth/born-finalized-opt-in";
import { isAllowedAuthOrigin } from "../better-auth/origin-gate";

const logger = createLogger("langwatch:auth");

/** The session `GET /api/auth/session` publishes, field for field. */
export type AuthRestSession = Readonly<{
  expires: string;
  user: Readonly<{
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    /** Whether this person still owes the SSO setup ceremony. */
    pendingSsoSetup?: boolean | undefined;
    /** The admin acting AS this person, where one is. */
    impersonator?: unknown;
  }>;
}>;

/**
 * Where a `GET /api/auth/logout` sends the browser next. `null` keeps the
 * local redirect; a federated target also ends the IdP's session, and is
 * resolved rather than read from environment (ADR-027).
 */
export type AuthRestFederatedLogout = (input: { returnTo: string }) => Promise<string | null>;

/** Everything the auth door reaches that this feature does not own. */
export type AuthRestPorts = Readonly<{
  /**
   * The deployment's ONE Better Auth instance.
   */
  betterAuth: () => Readonly<{
    handler(request: Request): Promise<Response>;
    api: Readonly<{
      getSession(input: { headers: Headers }): Promise<{ session: { id: string } } | null>;
    }>;
  }>;
  /** Ends one browser session. */
  revokeBrowserSession: (input: { sessionId: string }) => Promise<void>;
  /** The session as this process resolves it, for the browser's own poll. */
  resolveSession: (request: Request) => Promise<AuthRestSession | null>;
  /**
   * The project a legacy `X-Auth-Token` names, by slug.
   */
  tryFindProjectSlugByToken: (input: { token: string }) => Promise<string | null>;
  /** This deployment's flag store, for the born-finalized entrance. */
  featureFlags: () => FeatureFlagService;
  /**
   * The typed client the born-finalized entrance reads its allowlist through.
   */
  database: () => PrismaClient;
  /** The origin every state-changing auth request is checked against. */
  baseUrl: string;
  /** Where a GET logout lands, once the local cookies are cleared. */
  federatedLogout: AuthRestFederatedLogout;
  /**
   * Runs the born-finalized handler inside Identity's birth context.
   */
  runWithIdentityBirth: <T>(run: () => Promise<T>) => Promise<T>;
}>;

/** Builds the `/api/auth` family over one process's ports. */
export function createAuthRestApp(options: {
  security: AppRestSecurity;
  ports: AuthRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  // No `/api/v1` twin: Better Auth builds its own callback, cookie and
  // redirect URLs from one configured base, so a second address for the
  // sign-in door would be half-wired rather than equivalent.
  const secured = security.createServiceApp({ basePath: "/api", v1Alias: false });

  const authPolicy = () =>
    publicEndpoint("BetterAuth session/OAuth handshake; framework manages its own session");

  // ---------- POST /api/auth/validate ----------
  secured.access(authPolicy()).post("/auth/validate", async (c) => {
    const authToken = c.req.header("x-auth-token");

    if (!authToken) {
      return c.json({ message: "X-Auth-Token header is required." }, 401);
    }

    const projectSlug = await ports.tryFindProjectSlugByToken({ token: authToken });

    if (!projectSlug) {
      return c.json({ message: "Invalid auth token." }, 401);
    }

    return c.json({ projectSlug });
  });

  // ---------- GET /api/auth/session ----------
  secured.access(authPolicy()).get("/auth/session", async (c) => {
    c.header("Cache-Control", "no-store, must-revalidate");

    const session = await ports.resolveSession(c.req.raw);

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
        const session = await ports.betterAuth().api.getSession({ headers });

        if (session) {
          await ports.revokeBrowserSession({ sessionId: session.session.id });
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
      clearCookies.push(`__Secure-${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
    }

    // Hono supports multiple Set-Cookie headers via append
    for (const cookie of clearCookies) {
      c.header("Set-Cookie", cookie, { append: true });
    }

    if (method === "GET") {
      const federated = await ports.federatedLogout({
        returnTo: `${ports.baseUrl}/auth/signin`,
      });
      return c.redirect(federated ?? "/auth/signin", 302);
    }
    return c.json({ success: true });
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
        baseUrl: ports.baseUrl,
      })
    ) {
      // The 403 body carries no detail on purpose. Without this line the reason
      // is nowhere: the access log records the status and nothing else, so a
      // misconfigured base URL is indistinguishable from a real cross-site
      // POST, which is what makes it expensive to diagnose.
      logger.warn(
        {
          path: c.req.path,
          method: c.req.method,
          expectedOrigin: ports.baseUrl,
          receivedOrigin: c.req.header("origin") ?? null,
          receivedReferer: c.req.header("referer") ?? null,
        },
        "rejected auth request: origin does not match the deployment's base URL",
      );
      return c.json({ message: "Invalid origin", code: "INVALID_ORIGIN" }, 403);
    }

    // ADR-116 §3: the born-finalized entrance's request-scoped marker, set
    // HERE and only here, and only once the backend allowlist check has
    // passed. Nothing below re-decides it, and outside a marked request the
    // entrance is never reached — which is what makes deploying it a no-op
    // until an operator targets an organization.
    if (
      await isBornFinalizedSignUp({
        featureFlags: ports.featureFlags(),
        prisma: ports.database(),
        request: c.req.raw,
      })
    ) {
      return ports.runWithIdentityBirth(() => ports.betterAuth().handler(c.req.raw));
    }

    // BetterAuth's auth.handler is fetch-compatible (Request => Response)
    return ports.betterAuth().handler(c.req.raw);
  };

  // `.all` (not a 5-verb loop) so OPTIONS/HEAD and CORS preflight reach
  // BetterAuth — it terminates the request itself. Registered with method
  // "ALL" + a wildcard path, this is intentionally outside the router
  // introspection cross-check (a wildcard mount can't be enumerated), but it
  // still carries a declared policy because it goes through `.access(...)`.
  secured.access(authPolicy()).all("/auth/*", betterAuthCatchAll);

  return secured.hono;
}

function extractCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}
