/**
 * The `/api/auth` family: the Better Auth catch-all, the session the browser
 * polls, the logout and the legacy API-key check. Every answer is the sign-in
 * door's own. @see specs/auth/auth-rest-family-mounted.feature
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestAnswer,
  type RestProtocolProducer,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import { z } from "zod";

import type { AuthSessionPoll } from "../rules/auth-session-poll.rules.ts";
import { isBetterAuthPath } from "../rules/better-auth-path.rules.ts";

/**
 * Where a `GET /api/auth/logout` sends the browser next. `null` keeps the
 * local redirect; a federated target also ends the IdP's session, and is
 * resolved rather than read from environment (ADR-027).
 */
export type AuthRestFederatedLogout = (input: { returnTo: string }) => Promise<string | null>;

/** What the sign-in door calls, one operation per route; the process's own app answers it. */
export interface AuthDoorApi {
  /** The project a legacy `X-Auth-Token` names, counted against the caller's nearest hop. */
  validateProjectAuthToken(input: {
    token: string | undefined;
    forwardedFor: string | undefined;
  }): Promise<{ projectSlug: string }>;
  /** The browser's own session poll, read off its cookies. */
  getSessionByCookie(input: { cookie: string | undefined }): Promise<AuthSessionPoll>;
  /** Ends the browser session its cookies name. */
  revokeSessionFromCookies(input: { cookie: string | undefined }): Promise<void>;
  /** Better Auth's own fetch handler, behind the origin gate and the resolved caller. */
  betterAuthHandshake(request: Request): Promise<Response>;
  /** The origin a GET logout returns to; an operation, as the API proxy serves no properties. */
  baseUrl: () => string;
  /** Where a GET logout lands, once the local cookies are cleared. */
  federatedLogout: AuthRestFederatedLogout;
}

export const AuthDoorApi = moduleApi<AuthDoorApi>()("auth");

const JSON_MEDIA_TYPE = "application/json";

/**
 * The sign-in door answers Better Auth's own responses, which are passed
 * through untouched, and its own refusals in the shape they have always had.
 */
const AUTH_ANSWER = [JSON_MEDIA_TYPE, "text/html", "*/*"];

/** Better Auth's cookie and redirect protocol, answered as its own response. */
const BETTER_AUTH_FORWARDS =
  "Better Auth writes the session cookies, redirects and handshake bodies itself; this door passes them on untouched";

/** The browser's session poll keeps its own document and its no-store header. */
const SESSION_POLL_WIRE =
  "the browser's session poll answers the document it has always published, never cached, with null for an anonymous caller";

const VALIDATE_HEADERS = z.object({
  "x-auth-token": z.string().optional(),
  "x-forwarded-for": z.string().optional(),
});

const COOKIE_HEADERS = z.object({ cookie: z.string().optional() });

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };

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
  .withHeaders(VALIDATE_HEADERS)
  .withOutput(z.object({ projectSlug: z.string() }))
  .handle(({ app }, headers) =>
    app.validateProjectAuthToken({
      token: headers["x-auth-token"],
      forwardedFor: headers["x-forwarded-for"],
    }),
  )

  .get("/api/auth/session", "readBrowserAuthSession")
  .withAccess(AUTH_DOOR)
  .withHeaders(COOKIE_HEADERS)
  .withResponse("protocol", { produces: JSON_MEDIA_TYPE, because: SESSION_POLL_WIRE })
  .handle(async ({ app, response }, headers) =>
    sessionPollAnswer(response, await app.getSessionByCookie({ cookie: headers.cookie })),
  )

  .get("/api/auth/logout", "endBrowserSessionAndRedirect")
  .withAccess(AUTH_DOOR)
  .withResponse("forwarded", { produces: AUTH_ANSWER, because: BETTER_AUTH_FORWARDS })
  .handle(async ({ app, request, response }) => response.pass(await endSession({ app, request })))

  .post("/api/auth/logout", "endBrowserSession")
  .withAccess(AUTH_DOOR)
  .withResponse("forwarded", { produces: JSON_MEDIA_TYPE, because: BETTER_AUTH_FORWARDS })
  .handle(async ({ app, request, response }) => response.pass(await endSession({ app, request })))

  /**
   * An any-method route so OPTIONS, HEAD and CORS preflight reach Better Auth,
   * which terminates the request itself. Declared last, so the four named
   * routes above resolve first; it declines the CLI plane, whose families mount later.
   */
  .get("/api/auth/*", "betterAuthHandshake")
  .withAccess(AUTH_DOOR)
  .withResponse("forwarded", { produces: AUTH_ANSWER, because: BETTER_AUTH_FORWARDS })
  .anyMethod()
  .handle(async ({ app, request, response }) =>
    isBetterAuthPath({ pathname: new URL(request.url).pathname })
      ? response.pass(await app.betterAuthHandshake(request))
      : response.decline(),
  )
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
  await app.revokeSessionFromCookies({ cookie: request.headers.get("cookie") ?? undefined });
  const headers = clearedCookies();

  if (request.method === "GET") {
    const federated = await app.federatedLogout({ returnTo: `${app.baseUrl()}/auth/signin` });

    headers.set("Location", federated ?? "/auth/signin");

    return new Response(null, { status: 302, headers });
  }

  headers.set("Content-Type", JSON_MEDIA_TYPE);

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

/** The session poll's document, never cached. */
function sessionPollAnswer(
  response: RestProtocolProducer<typeof JSON_MEDIA_TYPE>,
  poll: AuthSessionPoll,
): RestAnswer<"protocol"> {
  return response.write({
    status: 200,
    mediaType: JSON_MEDIA_TYPE,
    body: JSON.stringify(poll.document),
    headers: NO_STORE,
  });
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
