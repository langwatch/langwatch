import { ClientAddress } from "@langwatch/api/policy";
import {
  type BrowserSessionResolution,
  type BrowserSessionVerification,
  InvalidAuthOriginError,
  type UnfinishedSignIn,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import type {
  RefusedSignInClassification,
  RefusedSignInInput,
  SignInIdpKind,
} from "@langwatch/identity-contract";
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
  extractRefusalPageConnection,
  isSignInCallbackPath,
  refusedSignInLocationOf,
  signInErrorRedirectOf,
  signInFailureLocation,
} from "../rules/sign-in-callback-failure.rules.ts";
import {
  buildClearedSignInHintCookie,
  buildSignInHintCookie,
  extractCallbackSource,
  extractEchoedRoundTrip,
  extractRoundTripValue,
  MAX_CALLBACK_FORM_BYTES,
  extractSignInHintCookie,
  extractSignInStartHint,
  extractHintedAddress,
  isSessionStarted,
  isUnfinishedSignInRead,
  type SignInStartHint,
  UNFINISHED_SIGN_IN_TTL_MS,
  roundTripBindingOf,
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

    if (
      isUnfinishedSignInRead({ pathname: new URL(request.url).pathname, method: request.method })
    ) {
      return this.readUnfinishedSignIn({ request });
    }
    const refusedConnectionId = extractRefusalPageConnection({
      pathname: new URL(request.url).pathname,
      method: request.method,
    });
    if (refusedConnectionId !== undefined) {
      return this.landOnRefusalCard({ connectionId: refusedConnectionId });
    }

    const betterAuth = await this.deps.betterAuth();
    // Better Auth counts the caller the platform resolved, never one a header claims.
    const stated = requestStatingCaller({
      request: withMicrosoftCallbackPath(request),
      caller: ClientAddress.resolvedFor(request),
    });

    const pathname = new URL(request.url).pathname;
    const startHint = await this.readSignInStartHint({ request: stated, pathname });
    const callbackForm = await this.readCallbackForm({ request: stated, pathname });
    const providerRefused =
      callbackForm !== undefined &&
      isSamlAssertionConsumerPost({ pathname, method: request.method }) &&
      samlResponseOutcomeOf({ formBody: callbackForm }) === "refused";
    const echoedRoundTrip = extractEchoedRoundTrip({ url: request.url, formBody: callbackForm });

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
        echoedRoundTrip,
      }),
      pathname,
      errorPageUrl,
      traceId,
    });
    return this.carrySignInHint({ request, response: landed, pathname, startHint });
  }

  /** The form a provider posted to a sign-in callback, read off a copy so Better Auth reads it. */
  private async readCallbackForm({
    request,
    pathname,
  }: {
    request: Request;
    pathname: string;
  }): Promise<string | undefined> {
    if (request.method !== "POST" || !isSignInCallbackPath({ pathname })) return undefined;
    try {
      const read = await readBoundedText({
        request: request.clone(),
        maxBytes: MAX_CALLBACK_FORM_BYTES,
      });
      return read.kind === "read" ? read.text : undefined;
    } catch {
      return undefined;
    }
  }

  /** The provider a sign-in start names, read off a copy so Better Auth reads the body. */
  private async readSignInStartHint({
    request,
    pathname,
  }: {
    request: Request;
    pathname: string;
  }): Promise<SignInStartHint | undefined> {
    if (!isSignInStartPath({ pathname, method: request.method })) return undefined;
    try {
      const body: unknown = JSON.parse(await request.clone().text());
      return extractSignInStartHint({ pathname, body });
    } catch {
      return undefined;
    }
  }

  /**
   * Sets the hint on an accepted sign-in start, bound to the round-trip value its answer sends the
   * person to the provider with, and drops it once a callback has answered or a session started.
   */
  private async carrySignInHint({
    request,
    response,
    pathname,
    startHint,
  }: {
    request: Request;
    response: Response;
    pathname: string;
    startHint: SignInStartHint | undefined;
  }): Promise<Response> {
    const secure = this.deps.baseUrl().startsWith("https:");
    const isCallback = isSignInCallbackPath({ pathname });
    const carriesHint = extractSignInHintCookie(request.headers.get("cookie")) !== undefined;
    let cookie: string | undefined;
    const roundTrip =
      startHint && response.status < 400 ? await extractProviderRoundTrip({ response }) : undefined;
    if (startHint && roundTrip) {
      const value = this.deps.signInHints().seal({
        ...startHint,
        issuedAt: this.deps.now().epochMilliseconds,
        binding: roundTripBindingOf({ value: roundTrip }),
      });
      if (value) cookie = buildSignInHintCookie({ value, secure });
    } else if (carriesHint && (isCallback || isSessionStarted({ response }))) {
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
    echoedRoundTrip,
  }: {
    request: Request;
    response: Response;
    errorPageUrl: string;
    traceId: string | undefined;
    providerRefused: boolean;
    echoedRoundTrip: string | undefined;
  }): Promise<Response> {
    const redirect = signInErrorRedirectOf({
      status: response.status,
      location: response.headers.get("location"),
      errorPageUrl,
      traceId,
      providerRefused,
      isCallback: isSignInCallbackPath({ pathname: new URL(request.url).pathname }),
    });
    if (redirect.kind === "pass") return response;
    let location = redirect.location;
    if (redirect.kind === "provider_refused") {
      location = await this.classifyRefusal({
        request,
        location,
        traceId,
        echoedRoundTrip,
        answeredCode: redirect.answeredCode,
      });
    } else if (redirect.kind === "withhold") {
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
   * A sign-in this browser started whose provider never answered back, read from the unspent hint:
   * the provider kind and the id to dial again, never the address. Nobody is told, nothing mailed.
   */
  private async readUnfinishedSignIn({ request }: { request: Request }): Promise<Response> {
    const sealed = extractSignInHintCookie(request.headers.get("cookie"));
    const hint = sealed
      ? this.deps.signInHints().decode({
          value: sealed,
          nowMs: this.deps.now().epochMilliseconds,
          maxAgeMs: UNFINISHED_SIGN_IN_TTL_MS,
        })
      : undefined;
    const headers = { "cache-control": "no-store" };
    if (!hint) return Response.json({ unfinished: null } satisfies UnfinishedSignIn, { headers });
    let idp: SignInIdpKind | null = null;
    try {
      const answer = await withinClassificationTime(
        this.deps.refusedSignIns.classifyRefusedSignIn({
          refusedBy:
            hint.source === "provider"
              ? { kind: "provider", providerId: hint.providerId }
              : { kind: "connection", connectionId: hint.providerId },
          email: null,
        }),
      );
      if (answer !== "timed_out") idp = answer.idp;
    } catch (error) {
      logger.warn({ error }, "an unfinished sign-in's provider kind could not be read");
    }
    return Response.json(
      { unfinished: { providerId: hint.providerId, idp } } satisfies UnfinishedSignIn,
      { headers },
    );
  }

  /**
   * The refusal page an admin set on their identity provider: the same card as a refused
   * callback, naming the provider kind only. No mail, since no round trip names the person.
   */
  private async landOnRefusalCard({ connectionId }: { connectionId: string }): Promise<Response> {
    const reference = getActiveTraceId() ?? this.deps.newReferenceId();
    let verdict: RefusedSignInClassification | undefined;
    try {
      const answer = await withinClassificationTime(
        this.deps.refusedSignIns.classifyRefusedSignIn({
          refusedBy: { kind: "connection", connectionId },
          email: null,
        }),
      );
      if (answer !== "timed_out") verdict = answer;
    } catch (error) {
      logger.error(
        { error, reference, connectionId },
        "a refusal page visit could not be classified; the person was sent the plain refusal",
      );
    }
    logger.warn(
      {
        reference,
        connectionId,
        organizationId: verdict?.organizationId ?? null,
        idp: verdict?.idp ?? null,
      },
      "an identity provider sent a refused person to its refusal page; the person was told why",
    );
    const location = refusedSignInLocationOf({
      location: `${this.deps.baseUrl()}/auth/error`,
      verdict: verdict && { idp: verdict.idp, outcome: "refused" },
      reference,
    });
    return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
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
    echoedRoundTrip,
    answeredCode,
  }: {
    request: Request;
    location: string;
    traceId: string | undefined;
    echoedRoundTrip: string | undefined;
    /** What Better Auth answered, e.g. `saml_no_assertion` for a posted SAML refusal. */
    answeredCode: string;
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
      const email = extractHintedAddress({ hint, providerId: hintProviderId, echoedRoundTrip });
      try {
        const answer = await withinClassificationTime(
          this.deps.refusedSignIns.classifyRefusedSignIn({ refusedBy, email }),
        );
        if (answer === "timed_out") {
          logger.warn(
            { reference, providerId: hintProviderId },
            "classifying a refused sign-in took too long; the person was sent the plain refusal",
          );
        } else {
          verdict = answer;
        }
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
        answeredCode,
        organizationId: verdict?.organizationId ?? null,
        idp: verdict?.idp ?? null,
        outcome: verdict?.outcome ?? "refused",
      },
      "an identity provider refused a sign-in; the person was told why",
    );
    return refusedSignInLocationOf({ location, verdict, reference });
  }
}

/** How long a refused sign-in's redirect waits on classifying it; the recording carries on. */
const CLASSIFICATION_WAIT_MS = 3_000;

async function withinClassificationTime<Value>(
  pending: Promise<Value>,
): Promise<Value | "timed_out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => resolve("timed_out"), CLASSIFICATION_WAIT_MS);
  });
  pending.catch(() => void 0);
  try {
    return await Promise.race([pending, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

type BoundedRead = { kind: "read"; text: string } | { kind: "too_large" };

/** A request body's text, unless it passes `maxBytes`: the rest is then never buffered. */
async function readBoundedText({
  request,
  maxBytes,
}: {
  request: Request;
  maxBytes: number;
}): Promise<BoundedRead> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return { kind: "too_large" };
  if (!request.body) return { kind: "read", text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      // A cloned body's cancel settles only once the other branch ends, so it is not awaited.
      void reader.cancel().catch(() => void 0);
      return { kind: "too_large" };
    }
    chunks.push(value);
  }
  return { kind: "read", text: Buffer.concat(chunks).toString("utf8") };
}

/** The round-trip value a sign-in start's answer carries in its provider URL, body or redirect. */
async function extractProviderRoundTrip({
  response,
}: {
  response: Response;
}): Promise<string | undefined> {
  const fromRedirect = extractRoundTripValue({ url: response.headers.get("location") });
  if (fromRedirect) return fromRedirect;
  try {
    const body: unknown = await response.clone().json();
    const url = typeof body === "object" && body !== null && "url" in body ? body.url : undefined;
    return typeof url === "string" ? extractRoundTripValue({ url }) : undefined;
  } catch {
    return undefined;
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
