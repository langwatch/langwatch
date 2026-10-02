import { ClientAddress } from "@langwatch/api/policy";
import {
  type BrowserSessionResolution,
  type BrowserSessionVerification,
  InvalidAuthOriginError,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import { getActiveTraceId } from "@langwatch/observability/tracing";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

import { isAllowedAuthOrigin, parseOrigin } from "../rules/auth-origin.rules.ts";
import { sessionPollOf, type AuthSessionPoll } from "../rules/auth-session-poll.rules.ts";
import { queryCacheEpochOf, type QueryCacheKeyOwner } from "../rules/query-cache-key.rules.ts";
import { presentedSessionCookie } from "../rules/session-cookie.rules.ts";
import {
  isSignInCallbackPath,
  signInErrorRedirectOf,
  signInFailureLocation,
} from "../rules/sign-in-callback-failure.rules.ts";

const logger = createLogger("langwatch:auth");

/** What the sign-in door reads through: the one Better Auth instance and the session reads. */
export interface AuthDoorDeps {
  betterAuth(): Promise<Readonly<{ handler(request: Request): Promise<Response> }>>;
  baseUrl(): string;
  verifyBrowserSession(input: { headers: Headers }): Promise<BrowserSessionVerification>;
  resolveBrowserSession(input: {
    verified: VerifiedBrowserSession;
  }): Promise<BrowserSessionResolution>;
  revokeBrowserSession(input: { sessionId: string }): Promise<void>;
  /** The key a signed-in browser seals its mirrored reads under in one epoch. */
  deriveQueryCacheKey(input: QueryCacheKeyOwner & { epoch: number }): string;
  /** The server's clock, which alone decides the cache-key epoch. */
  now(): Instant;
}

/** The `/api/auth` door: Better Auth's handshake, the browser's session poll and its sign-out. */
export class AuthDoorService {
  static create(deps: AuthDoorDeps): AuthDoorService {
    return new AuthDoorService(deps);
  }

  private constructor(private readonly deps: AuthDoorDeps) {}

  async getSessionByCookie(input: { cookie: string | undefined }): Promise<AuthSessionPoll> {
    const verification = await this.deps.verifyBrowserSession({ headers: cookieHeaders(input) });
    if (verification.kind === "anonymous") return { document: null };

    return sessionPollOf({
      resolution: await this.deps.resolveBrowserSession({ verified: verification.verified }),
      epoch: queryCacheEpochOf({ at: this.deps.now() }),
      deriveCacheKey: (input) => this.deps.deriveQueryCacheKey(input),
    });
  }

  /** Ends the session the cookies name; a failed lookup still leaves the cookies to clear. */
  async revokeSessionFromCookies(input: { cookie: string | undefined }): Promise<void> {
    const headers = cookieHeaders(input);
    if (presentedSessionCookie(headers).kind === "absent") return;

    try {
      const verification = await this.deps.verifyBrowserSession({ headers });
      if (verification.kind === "verified") {
        await this.deps.revokeBrowserSession({ sessionId: verification.verified.session.id });
      }
    } catch (error) {
      logger.warn(
        { error },
        "sign-out could not revoke the session; its cookies are still cleared",
      );
    }
  }

  /**
   * The door's origin rule for a sign-up that writes before any `/api/auth/*` call does:
   * refused here, its account is never half-made. Logs origins only, never a full URL.
   */
  assertSignUpOrigin(input: { origin: string | null; referer: string | null }): void {
    const origin = input.origin ?? undefined;
    const referer = input.referer ?? undefined;
    const baseUrl = this.deps.baseUrl();
    if (isAllowedAuthOrigin({ method: "POST", origin, referer, baseUrl })) return;

    logger.warn(
      {
        expectedOrigin: parseOrigin(baseUrl),
        receivedOrigin: parseOrigin(origin),
        receivedReferer: parseOrigin(referer),
      },
      "rejected sign-up request: origin does not match the deployment's base URL",
    );
    throw new InvalidAuthOriginError();
  }

  /** Better Auth's own fetch handler, behind the origin gate. */
  async betterAuthHandshake(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    const baseUrl = this.deps.baseUrl();

    if (
      !isAllowedAuthOrigin({
        method: request.method,
        pathname: new URL(request.url).pathname,
        origin: origin ?? undefined,
        referer: referer ?? undefined,
        baseUrl,
      })
    ) {
      // The 403 body carries no detail on purpose, so this line is the only record of why.
      logger.warn(
        {
          path: new URL(request.url).pathname,
          method: request.method,
          expectedOrigin: baseUrl,
          receivedOrigin: origin,
          receivedReferer: referer,
        },
        "rejected auth request: origin does not match the deployment's base URL",
      );

      return Response.json({ message: "Invalid origin", code: "INVALID_ORIGIN" }, { status: 403 });
    }

    const betterAuth = await this.deps.betterAuth();
    // Better Auth counts the caller the platform resolved, never one a header claims.
    const stated = requestStatingCaller({ request, caller: ClientAddress.resolvedFor(request) });

    const answered = await betterAuth.handler(stated);
    // Each acts on a different status (a 3xx to the error page, a 5xx on a callback).
    const errorPageUrl = `${baseUrl}/auth/error`;
    const traceId = getActiveTraceId();
    return landFailedSignInCallback({
      response: withholdInternalSignInError({ response: answered, errorPageUrl, traceId }),
      pathname: new URL(request.url).pathname,
      errorPageUrl,
      traceId,
    });
  }
}

/**
 * A redirect to the sign-in error screen keeps its code only when a screen has words for it;
 * anything else is sent the generic code, and its real cause is logged here with the trace id
 * (specs/identity/sso-signin-error-boundary.feature).
 */
function withholdInternalSignInError({
  response,
  errorPageUrl,
  traceId,
}: {
  response: Response;
  errorPageUrl: string;
  traceId: string | undefined;
}): Response {
  const redirect = signInErrorRedirectOf({
    status: response.status,
    location: response.headers.get("location"),
    errorPageUrl,
    traceId,
  });
  if (redirect.kind === "pass") return response;

  logger.error(
    { code: redirect.code, description: redirect.description, traceId: traceId ?? null },
    "a sign-in failed for a reason we have not written down; the person was sent a generic refusal",
  );
  const headers = new Headers(response.headers);
  headers.set("location", redirect.location);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * A server error on a sign-in callback, sent to the sign-in error screen rather than a blank
 * page: the callback is a browser navigation. Every other auth route keeps its status, because
 * its callers read it (specs/identity/sso-signin-error-boundary.feature).
 */
async function landFailedSignInCallback({
  response,
  pathname,
  errorPageUrl,
  traceId,
}: {
  response: Response;
  pathname: string;
  errorPageUrl: string;
  traceId: string | undefined;
}): Promise<Response> {
  if (response.status < 500 || !isSignInCallbackPath({ pathname })) return response;

  logger.error(
    {
      status: response.status,
      path: pathname,
      traceId: traceId ?? null,
      cause: await readCauseCode(response),
    },
    "a sign-in callback failed on the server; the person was sent a generic refusal",
  );
  return new Response(null, {
    status: 302,
    headers: { location: signInFailureLocation({ errorPageUrl, traceId }) },
  });
}

const errorBodySchema = z.object({ code: z.string() });

/** Better Auth's error `code`, for the log only: its message can hold an address. */
async function readCauseCode(response: Response): Promise<string> {
  const unreadable = "unreadable";
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(await response.text()));
    return parsed.success ? parsed.data.code.slice(0, 100) : unreadable;
  } catch {
    return unreadable;
  }
}

function cookieHeaders(input: { cookie: string | undefined }): Headers {
  return new Headers(input.cookie ? { cookie: input.cookie } : {});
}

/**
 * The same request, stating the caller the platform resolved on the one header Better Auth
 * reads, or none when unresolved: a shared bucket is coarse, a caller-chosen one is none.
 * Rebuilt from parts because the Node adapter's lazy request refuses to be copied.
 */
function requestStatingCaller({
  request,
  caller,
}: {
  request: Request;
  caller: string | undefined;
}): Request {
  const headers = new Headers(request.headers);
  if (caller) headers.set("x-forwarded-for", caller);
  else headers.delete("x-forwarded-for");
  const body = request.method === "GET" || request.method === "HEAD" ? null : request.body;

  return new Request(request.url, {
    method: request.method,
    headers,
    body,
    ...(body ? { duplex: "half" as const } : {}),
    signal: request.signal,
  });
}
