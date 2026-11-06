import { ClientAddress } from "@langwatch/api/policy";
import {
  type BrowserSessionResolution,
  type BrowserSessionVerification,
  InvalidAuthOriginError,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import type { RefusedSignInClassification, RefusedSignInInput } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { getActiveTraceId } from "@langwatch/observability/tracing";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

import {
  accountNotLinkedRedirectOf,
  isAccountNotLinkedRedirect,
} from "../rules/account-not-linked.rules.ts";
import { isAllowedAuthOrigin, parseOrigin } from "../rules/auth-origin.rules.ts";
import { sessionPollOf, type AuthSessionPoll } from "../rules/auth-session-poll.rules.ts";
import { issuerMismatchRedirectOf } from "../rules/id-token-issuer-mismatch.rules.ts";
import { microsoftCallbackRouteOf } from "../rules/legacy-microsoft-callback.rules.ts";
import { queryCacheEpochOf, type QueryCacheKeyOwner } from "../rules/query-cache-key.rules.ts";
import {
  isSamlAssertionConsumerPost,
  samlResponseOutcomeOf,
} from "../rules/saml-response-status.rules.ts";
import { presentedSessionCookie } from "../rules/session-cookie.rules.ts";
import {
  isSignInCallbackPath,
  refusedSignInLocationOf,
  signInErrorRedirectOf,
  signInFailureLocation,
} from "../rules/sign-in-callback-failure.rules.ts";
import {
  buildClearedSignInHintCookie,
  buildSignInHintCookie,
  extractCallbackSource,
  extractSignInHintCookie,
  extractSignInStartHint,
  isSignInStartPath,
  type SignInHintSealer,
} from "../rules/sign-in-hint.rules.ts";
import { findConnectionIdsInPath } from "../rules/sso-request-target.rules.ts";

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
  /** What the Better Auth logger saw of an ID token refused for its issuer, per request. */
  idTokenIssuerRefusals: Readonly<{
    runWithScope<T>(run: () => Promise<T>): Promise<T>;
    findRefusedIssuers(): string[];
  }>;
  /** The issuer the connection a callback names holds, for the mismatch redirect. */
  connectionIssuers: Readonly<{
    findIssuersForConnection(args: { connectionId: string }): Promise<string[]>;
  }>;
  /** The address the OAuth provider's profile carried on this request, if one was mapped. */
  oauthProfileEmails: Readonly<{
    runWithScope<T>(run: () => Promise<T>): Promise<T>;
    findEmail(): string | undefined;
  }>;
  /** The organization connections that govern an address, for a refused link's redirect. */
  governingConnections: Readonly<{
    findGoverningConnections(args: { email: string }): Promise<readonly string[]>;
  }>;
  /** The key a signed-in browser seals its mirrored reads under in one epoch. */
  deriveQueryCacheKey(input: QueryCacheKeyOwner & { epoch: number }): string;
  /** The server's clock, which alone decides the cache-key epoch and a sign-in hint's age. */
  now(): Instant;
  /** Seals the address typed at a sign-in start for its callback. */
  signInHints(): SignInHintSealer;
  /** Who refused a sign-in, and of what kind; recorded when the address is known. */
  refusedSignIns: Readonly<{
    classifyRefusedSignIn(input: RefusedSignInInput): Promise<RefusedSignInClassification>;
  }>;
  /** A reference for a refusal no trace was active for. */
  newReferenceId(): string;
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

  /**
   * Ends the session the cookies name. A failed lookup or revocation is thrown, never
   * swallowed: the sign-out must not confirm a session that still answers.
   */
  async revokeSessionFromCookies(input: { cookie: string | undefined }): Promise<void> {
    const headers = cookieHeaders(input);
    if (presentedSessionCookie(headers).kind === "absent") return;

    const verification = await this.deps.verifyBrowserSession({ headers });
    if (verification.kind === "verified") {
      await this.deps.revokeBrowserSession({ sessionId: verification.verified.session.id });
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

  /** The engine's generic refusal of an ID token for its `iss`, answered as
   *  `sso_issuer_mismatch` with both issuers (specs/identity/sso-issuer-mismatch.feature). */
  private async nameIssuerMismatch({
    request,
    response,
  }: {
    request: Request;
    response: Response;
  }): Promise<Response> {
    const [received] = this.deps.idTokenIssuerRefusals.findRefusedIssuers();
    if (received === undefined) return response;
    const [connectionId] = findConnectionIdsInPath(request.url);
    const [expected] = connectionId
      ? await this.deps.connectionIssuers.findIssuersForConnection({ connectionId })
      : [];
    const redirect = issuerMismatchRedirectOf({
      location: response.headers.get("location"),
      received,
      expected,
    });
    if (redirect.kind === "pass") return response;
    const headers = new Headers(response.headers);
    headers.set("location", redirect.location);
    return new Response(response.body, { status: response.status, headers });
  }

  /** A refused link, answered with the connection that governs the provider's address
   *  (specs/auth/sso-wrong-provider-recovery.feature). */
  private async nameGoverningConnection(response: Response): Promise<Response> {
    const location = response.headers.get("location");
    if (!isAccountNotLinkedRedirect({ location })) return response;
    const email = this.deps.oauthProfileEmails.findEmail();
    if (email === undefined) return response;
    const [connectionId] = await this.deps.governingConnections.findGoverningConnections({
      email,
    });
    const redirect = accountNotLinkedRedirectOf({ location, connectionId });
    if (redirect.kind === "pass") return response;
    const headers = new Headers(response.headers);
    headers.set("location", redirect.location);
    return new Response(response.body, { status: response.status, headers });
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
    const stated = requestStatingCaller({
      request: withMicrosoftCallbackPath(request),
      caller: ClientAddress.resolvedFor(request),
    });

    const pathname = new URL(request.url).pathname;
    const startHint = await this.readSignInStartHint({ request: stated, pathname });
    const providerRefused = await this.readSamlRefusal({ request: stated, pathname });

    const answered = await this.deps.oauthProfileEmails.runWithScope(async () =>
      this.deps.idTokenIssuerRefusals.runWithScope(async () =>
        this.nameGoverningConnection(
          await this.nameIssuerMismatch({ request, response: await betterAuth.handler(stated) }),
        ),
      ),
    );
    // Each acts on a different status (a 3xx to the error page, a 5xx on a callback).
    const errorPageUrl = `${baseUrl}/auth/error`;
    const traceId = getActiveTraceId();
    const landed = await landFailedSignInCallback({
      response: await this.withholdInternalSignInError({
        request,
        response: answered,
        errorPageUrl,
        traceId,
        providerRefused,
      }),
      pathname,
      errorPageUrl,
      traceId,
    });
    return this.carrySignInHint({ request, response: landed, pathname, startHint });
  }

  /** Whether a SAML Response posted back says the provider refused, read off a copy. */
  private async readSamlRefusal({
    request,
    pathname,
  }: {
    request: Request;
    pathname: string;
  }): Promise<boolean> {
    if (!isSamlAssertionConsumerPost({ pathname, method: request.method })) return false;
    try {
      return samlResponseOutcomeOf({ formBody: await request.clone().text() }) === "refused";
    } catch {
      return false;
    }
  }

  /** The address a provider sign-in start typed, read off a copy so Better Auth reads the body. */
  private async readSignInStartHint({
    request,
    pathname,
  }: {
    request: Request;
    pathname: string;
  }): Promise<{ providerId: string; email: string } | undefined> {
    if (!isSignInStartPath({ pathname, method: request.method })) return undefined;
    try {
      const body: unknown = JSON.parse(await request.clone().text());
      return extractSignInStartHint({ pathname, body });
    } catch {
      return undefined;
    }
  }

  /** Sets the hint on an accepted sign-in start, and drops it once a callback has answered. */
  private carrySignInHint({
    request,
    response,
    pathname,
    startHint,
  }: {
    request: Request;
    response: Response;
    pathname: string;
    startHint: { providerId: string; email: string } | undefined;
  }): Response {
    const secure = this.deps.baseUrl().startsWith("https:");
    const isCallback = isSignInCallbackPath({ pathname });
    const carriesHint = extractSignInHintCookie(request.headers.get("cookie")) !== undefined;
    let cookie: string | undefined;
    if (startHint && response.status < 400) {
      const value = this.deps.signInHints().seal({
        ...startHint,
        issuedAt: this.deps.now().epochMilliseconds,
      });
      if (value) cookie = buildSignInHintCookie({ value, secure });
    } else if (isCallback && carriesHint) {
      cookie = buildClearedSignInHintCookie({ secure });
    }
    if (!cookie) return response;
    const headers = new Headers(response.headers);
    headers.append("set-cookie", cookie);
    return new Response(response.body, { status: response.status, headers });
  }

  /**
   * A redirect to the sign-in error screen keeps its code only when a screen has words for it;
   * anything else is sent the generic code, and its real cause is logged here with the trace id
   * (specs/identity/sso-signin-error-boundary.feature).
   */
  private async withholdInternalSignInError({
    request,
    response,
    errorPageUrl,
    traceId,
    providerRefused,
  }: {
    request: Request;
    response: Response;
    errorPageUrl: string;
    traceId: string | undefined;
    providerRefused: boolean;
  }): Promise<Response> {
    const redirect = signInErrorRedirectOf({
      status: response.status,
      location: response.headers.get("location"),
      errorPageUrl,
      traceId,
      providerRefused,
    });
    if (redirect.kind === "pass") return response;
    let location = redirect.location;
    if (redirect.kind === "provider_refused") {
      location = await this.classifyRefusal({ request, location, traceId });
    } else {
      logger.error(
        { code: redirect.code, description: redirect.description, traceId: traceId ?? null },
        "a sign-in failed for a reason we have not written down; the person was sent a generic refusal",
      );
    }
    const headers = new Headers(response.headers);
    headers.set("location", location);
    return new Response(response.body, { status: response.status, headers });
  }

  /**
   * An identity provider's refusal: told apart as a seat limit or a refusal naming the provider
   * kind, from the callback path and the signed hint only. Any failure here keeps the plain
   * refusal: classifying it never blocks the redirect (specs/identity/idp-refused-sign-in.feature).
   */
  private async classifyRefusal({
    request,
    location,
    traceId,
  }: {
    request: Request;
    location: string;
    traceId: string | undefined;
  }): Promise<string> {
    const reference = traceId ?? this.deps.newReferenceId();
    const source = extractCallbackSource({ pathname: new URL(request.url).pathname });
    let verdict: RefusedSignInClassification | undefined;
    if (source) {
      const { hintProviderId, ...refusedBy } = source;
      const sealed = extractSignInHintCookie(request.headers.get("cookie"));
      const hint = sealed
        ? this.deps
            .signInHints()
            .decode({ value: sealed, nowMs: this.deps.now().epochMilliseconds })
        : undefined;
      const email = hint?.providerId === hintProviderId ? hint.email : null;
      try {
        verdict = await this.deps.refusedSignIns.classifyRefusedSignIn({ refusedBy, email });
      } catch (error) {
        logger.error(
          { error, reference, providerId: hintProviderId },
          "a refused sign-in could not be classified; the person was sent the plain refusal",
        );
      }
    }
    // An expected refusal (a cancelled consent, or e.g. Entra "Assignment required"): nothing
    // for on-call. Never the address: the reference ties this line to the card.
    logger.warn(
      {
        reference,
        providerId: source?.hintProviderId ?? null,
        organizationId: verdict?.organizationId ?? null,
        idp: verdict?.idp ?? null,
        outcome: verdict?.outcome ?? "refused",
      },
      "an identity provider refused a sign-in; the person was told why",
    );
    return refusedSignInLocationOf({ location, verdict, reference });
  }
}

/** The request Better Auth answers: the Microsoft callback at its legacy path is handed on. */
function withMicrosoftCallbackPath(request: Request): Request {
  const route = microsoftCallbackRouteOf({ url: request.url });
  if (route.kind === "pass") return request;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
    ...(hasBody ? { body: request.body, duplex: "half" } : {}),
  };
  return new Request(route.url, init);
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
