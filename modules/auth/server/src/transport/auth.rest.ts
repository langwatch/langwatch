/**
 * The `/api/auth` family: the Better Auth catch-all, the session the browser
 * polls, the logout and the legacy API-key check. Every answer is the sign-in
 * door's own. @see specs/auth/auth-rest-family-mounted.feature
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestRawResult } from "@langwatch/api/rest";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import { moduleApi } from "@langwatch/runtime-composition";

import type { AuthDirectoryPort } from "./auth-directory.ts";
import { isBornFinalizedSignUp } from "./better-auth/born-finalized-opt-in.api.ts";
import { isAllowedAuthOrigin } from "./better-auth/origin-gate.api.ts";

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

/**
 * What the sign-in door calls. Declared here because `auth` has no installer
 * and no feature app yet: the process composes an object satisfying this and
 * provides it for this token.
 */
export interface AuthDoorApi {
  /** The deployment's ONE Better Auth instance. */
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
  /** The project a legacy `X-Auth-Token` names, by slug. */
  findProjectSlugByToken: (input: { token: string }) => Promise<string | null>;
  /** This deployment's flag store, for the born-finalized entrance. */
  featureFlags: () => FeatureFlagApi;
  /** The typed client the born-finalized entrance reads its allowlist through. */
  directory: () => AuthDirectoryPort;
  /** The origin every state-changing auth request is checked against. */
  baseUrl: string;
  /** Where a GET logout lands, once the local cookies are cleared. */
  federatedLogout: AuthRestFederatedLogout;
  /** Runs the born-finalized handler inside Identity's birth context. */
  runWithIdentityBirth: <T>(run: () => Promise<T>) => Promise<T>;
}

export const AuthDoorApi = moduleApi<AuthDoorApi>("auth");

const JSON_MEDIA_TYPE = "application/json";

/**
 * The sign-in door answers Better Auth's own responses, which are passed
 * through untouched, and its own refusals in the shape they have always had.
 */
const AUTH_ANSWER = [JSON_MEDIA_TYPE, "text/html", "*/*"];

const AUTH_DOOR = publicRoute({
  reason:
    "the Better Auth session and OAuth handshake; the framework manages its own session, and the session poll, the logout and the legacy token check each answer their own refusal",
});

/** The cookies a logout clears, in both their plain and `__Secure-` spellings. */
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "better-auth.session_data",
  "better-auth.dont_remember",
];

/**
 * `/api/auth`, at exactly the addresses the browser holds. Twinless because
 * Better Auth builds its callback, cookie and redirect URLs from one
 * configured base: a second address would be half-wired, not equivalent.
 */
export const authRest = defineRestRouter(AuthDoorApi)
  .withNamespace("auth")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/auth/validate", "validateProjectAuthToken")
  .withAccess(AUTH_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }) => {
    const authToken = request.headers.get("x-auth-token");

    if (!authToken) return answer({ message: "X-Auth-Token header is required." }, 401);

    const projectSlug = await app.findProjectSlugByToken({ token: authToken });

    if (!projectSlug) return answer({ message: "Invalid auth token." }, 401);

    return answer({ projectSlug });
  })

  .get("/api/auth/session", "readBrowserAuthSession")
  .withAccess(AUTH_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }) => {
    const session = await app.resolveSession(request);
    const headers = { "Cache-Control": "no-store, must-revalidate" };

    if (!session) return answer(null, 200, headers);

    return answer(
      {
        session: { expiresAt: session.expires },
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
          pendingSsoSetup: session.user.pendingSsoSetup,
          impersonator: session.user.impersonator,
        },
      },
      200,
      headers,
    );
  })

  .get("/api/auth/logout", "endBrowserSessionAndRedirect")
  .withAccess(AUTH_DOOR)
  .withRawResponse({ produces: AUTH_ANSWER })
  .handle(async ({ app, request }) => endSession({ app, request }))

  .post("/api/auth/logout", "endBrowserSession")
  .withAccess(AUTH_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }) => endSession({ app, request }))

  /**
   * An any-method route so OPTIONS, HEAD and CORS preflight reach Better Auth,
   * which terminates the request itself. Declared last, so the four named
   * routes above resolve first.
   */
  .get("/api/auth/*", "betterAuthHandshake")
  .withAccess(AUTH_DOOR)
  .withRawResponse({ produces: AUTH_ANSWER })
  .anyMethod()
  .handle(async ({ app, request }) => betterAuthHandshake({ app, request }))
  .build();

/**
 * Ends the browser's session and clears its cookies. A GET lands wherever the
 * deployment's federated logout says; a POST answers the browser directly.
 */
async function endSession({
  app,
  request,
}: {
  app: AuthDoorApi;
  request: Request;
}): Promise<Response> {
  const cookies = request.headers.get("cookie") ?? "";
  const sessionToken =
    extractCookie(cookies, "__Secure-better-auth.session_token") ??
    extractCookie(cookies, "better-auth.session_token");

  if (sessionToken) {
    try {
      const headers = new Headers();

      headers.set("cookie", cookies);

      const session = await app.betterAuth().api.getSession({ headers });

      if (session) await app.revokeBrowserSession({ sessionId: session.session.id });
    } catch {
      // Session lookup failed — the cookies below are still cleared.
    }
  }

  const headers = clearedCookies();

  if (request.method === "GET") {
    const federated = await app.federatedLogout({ returnTo: `${app.baseUrl}/auth/signin` });

    headers.set("Location", federated ?? "/auth/signin");

    return new Response(null, { status: 302, headers });
  }

  headers.set("Content-Type", JSON_MEDIA_TYPE);

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

/**
 * Better Auth's own fetch handler, behind the deployment's origin gate and the
 * born-finalized entrance.
 */
async function betterAuthHandshake({
  app,
  request,
}: {
  app: AuthDoorApi;
  request: Request;
}): Promise<RestRawResult> {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (
    !isAllowedAuthOrigin({
      method: request.method,
      origin: origin ?? undefined,
      referer: referer ?? undefined,
      baseUrl: app.baseUrl,
    })
  ) {
    // The 403 body carries no detail on purpose. Without this line the reason
    // is nowhere: the access log records the status and nothing else, so a
    // misconfigured base URL is indistinguishable from a real cross-site POST.
    logger.warn(
      {
        path: new URL(request.url).pathname,
        method: request.method,
        expectedOrigin: app.baseUrl,
        receivedOrigin: origin,
        receivedReferer: referer,
      },
      "rejected auth request: origin does not match the deployment's base URL",
    );

    return answer({ message: "Invalid origin", code: "INVALID_ORIGIN" }, 403);
  }

  // ADR-116 §3: the born-finalized marker is set HERE and only here, once the
  // backend allowlist check has passed. Nothing below re-decides it.
  const bornFinalized = await isBornFinalizedSignUp({
    featureFlags: app.featureFlags(),
    directory: app.directory(),
    request,
  });

  if (bornFinalized) {
    return app.runWithIdentityBirth(() => app.betterAuth().handler(request));
  }

  return app.betterAuth().handler(request);
}

/** One `Set-Cookie` per session cookie, in both spellings, all expired. */
function clearedCookies(): Headers {
  const headers = new Headers();

  for (const name of SESSION_COOKIE_NAMES) {
    headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    headers.append(
      "Set-Cookie",
      `__Secure-${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    );
  }

  return headers;
}

/** A JSON body this door writes itself, in the shape its callers already parse. */
function answer(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": JSON_MEDIA_TYPE, ...headers },
  });
}

function extractCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));

  return match ? match.slice(name.length + 1) : null;
}
