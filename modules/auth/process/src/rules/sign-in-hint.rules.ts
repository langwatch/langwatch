import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { RefusedSignInSource } from "@langwatch/identity-contract";
import { z } from "zod";

/**
 * The sign-in hint: the address a person typed and the provider they were sent to, carried from
 * the sign-in start to the provider's callback in a signed, short-lived, httpOnly cookie. The
 * callback's query string is the provider's (and anybody's) to write, so it is never the source.
 * @see specs/identity/idp-refused-sign-in.feature
 */

export const SIGN_IN_HINT_COOKIE = "langwatch.sign_in_hint";
/** Only the auth door reads it. */
const SIGN_IN_HINT_PATH = "/api/auth";
/** How long a refused callback trusts a hint to name the person. */
export const SIGN_IN_HINT_TTL_MS = 15 * 60 * 1000;
/** How long the sign-in page may say an unanswered sign-in did not finish; the cookie's life. */
export const UNFINISHED_SIGN_IN_TTL_MS = 60 * 60 * 1000;
/** A hint stamped this far ahead of the server's clock is refused, not trusted. */
const CLOCK_SKEW_MS = 60 * 1000;
const MAX_EMAIL_LENGTH = 320;

const signInHintSchema = z.object({
  /** The address typed before leaving; absent when the sign-in started without one. */
  email: z.string().min(3).max(MAX_EMAIL_LENGTH).optional(),
  providerId: z.string().min(1).max(200),
  /** Whether `providerId` names an organization's connection or an installation provider. */
  source: z.enum(["connection", "provider"]).optional(),
  issuedAt: z.number().int(),
  /** The hash of the round-trip value (`state` or `RelayState`) this sign-in's provider echoes. */
  binding: z.string().min(1).max(100).optional(),
});
export type SignInHint = z.infer<typeof signInHintSchema>;

/** Seals and decodes hints under one deployment secret. */
export interface SignInHintSealer {
  seal(hint: SignInHint): string;
  /** The hint a cookie value carries, when its signature holds and it is under `maxAgeMs` old. */
  decode(args: { value: string; nowMs: number; maxAgeMs?: number }): SignInHint | undefined;
}

/** Without a secret nothing is sealed and nothing decodes: the hint is never required. */
export function signInHintSealer({ secret }: { secret: string | undefined }): SignInHintSealer {
  return {
    seal: (hint) => {
      const payload = Buffer.from(JSON.stringify(hint)).toString("base64url");
      const signature = computeHintSignature({ secret, payload });
      return signature ? `${payload}.${signature.toString("base64url")}` : "";
    },
    decode: ({ value, nowMs, maxAgeMs = SIGN_IN_HINT_TTL_MS }) => {
      const payload = extractSignedPayload({ secret, value });
      const hint = payload === undefined ? undefined : parseHintPayload(payload);
      return hint && isHintFresh({ hint, nowMs, maxAgeMs }) ? hint : undefined;
    },
  };
}

function computeHintSignature({
  secret,
  payload,
}: {
  secret: string | undefined;
  payload: string;
}): Buffer | undefined {
  if (!secret) return undefined;
  return createHmac("sha256", secret).update(`langwatch:sign-in-hint\0${payload}`).digest();
}

/** The payload of a value whose signature is this deployment's, compared in constant time. */
function extractSignedPayload({
  secret,
  value,
}: {
  secret: string | undefined;
  value: string;
}): string | undefined {
  const [payload, signature, ...rest] = value.split(".");
  if (!payload || !signature || rest.length > 0) return undefined;
  const expected = computeHintSignature({ secret, payload });
  const presented = Buffer.from(signature, "base64url");
  if (!expected || presented.length !== expected.length) return undefined;
  return timingSafeEqual(presented, expected) ? payload : undefined;
}

function isHintFresh({
  hint,
  nowMs,
  maxAgeMs,
}: {
  hint: SignInHint;
  nowMs: number;
  maxAgeMs: number;
}): boolean {
  const age = nowMs - hint.issuedAt;
  return age <= maxAgeMs && age >= -CLOCK_SKEW_MS;
}

function parseHintPayload(payload: string): SignInHint | undefined {
  try {
    const parsed = signInHintSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The hash a hint keeps of a round-trip value, so a callback can show it holds the same one. */
export function roundTripBindingOf({ value }: { value: string }): string {
  return createHash("sha256").update(`langwatch:sign-in-round-trip\0${value}`).digest("base64url");
}

/** The `state` or `RelayState` a sign-in start sends the person to the provider with. */
export function extractRoundTripValue({
  url,
}: {
  url: string | null | undefined;
}): string | undefined {
  if (!url) return undefined;
  try {
    const params = new URL(url).searchParams;
    return params.get("RelayState") ?? params.get("state") ?? undefined;
  } catch {
    return undefined;
  }
}

/** A posted callback form past this size is not read. */
export const MAX_CALLBACK_FORM_BYTES = 512 * 1024;

/** A sign-in start body past this size is not read for its hint. */
export const MAX_SIGN_IN_START_BYTES = 16 * 1024;

/** The round-trip value a callback echoes: `state` on its query, or `RelayState`/`state` posted. */
export function extractEchoedRoundTrip({
  url,
  formBody,
}: {
  url: string;
  formBody: string | undefined;
}): string | undefined {
  const fromQuery = new URL(url).searchParams.get("state");
  if (fromQuery) return fromQuery;
  if (!formBody || formBody.length > MAX_CALLBACK_FORM_BYTES) return undefined;
  const form = new URLSearchParams(formBody);
  return form.get("RelayState") ?? form.get("state") ?? undefined;
}

/**
 * The address a hint names, only when it was set for this callback's provider and the callback
 * echoes the round-trip value the hint was bound to. A page that forges a refusal does not know
 * that value, so it can never make a refusal speak for somebody's typed address.
 */
export function extractHintedAddress({
  hint,
  providerId,
  echoedRoundTrip,
}: {
  hint: SignInHint | undefined;
  providerId: string;
  echoedRoundTrip: string | undefined;
}): string | null {
  if (!hint?.email || hint.providerId !== providerId || !hint.binding || !echoedRoundTrip) {
    return null;
  }
  const echoed = Buffer.from(roundTripBindingOf({ value: echoedRoundTrip }));
  const bound = Buffer.from(hint.binding);
  return echoed.length === bound.length && timingSafeEqual(echoed, bound) ? hint.email : null;
}

/** The `Set-Cookie` that carries a sealed hint to the callback. */
export function buildSignInHintCookie({
  value,
  secure,
}: {
  value: string;
  secure: boolean;
}): string {
  const maxAge = Math.floor(UNFINISHED_SIGN_IN_TTL_MS / 1000);
  return `${SIGN_IN_HINT_COOKIE}=${value}; Path=${SIGN_IN_HINT_PATH}; Max-Age=${maxAge}; ${hintCookieAttributes({ secure })}`;
}

/**
 * A SAML provider posts back cross-site, which a Lax cookie does not ride, so over https the hint
 * is SameSite=None: still HttpOnly, sealed and short-lived, and it only names a typed address.
 */
function hintCookieAttributes({ secure }: { secure: boolean }): string {
  return secure ? "HttpOnly; SameSite=None; Secure" : "HttpOnly; SameSite=Lax";
}

/** The `Set-Cookie` that drops a hint once its callback has read it. */
export function buildClearedSignInHintCookie({ secure }: { secure: boolean }): string {
  return `${SIGN_IN_HINT_COOKIE}=; Path=${SIGN_IN_HINT_PATH}; Max-Age=0; ${hintCookieAttributes({ secure })}`;
}

/** The hint cookie's raw value off a `Cookie` header. */
export function extractSignInHintCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === SIGN_IN_HINT_COOKIE) {
      return pair.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

const SIGN_IN_START_PATH = /^\/api\/auth\/sign-in\/(sso|social|oauth2)$/;

const signInStartBodySchema = z.object({
  providerId: z.string().optional(),
  provider: z.string().optional(),
  loginHint: z.string().optional(),
  email: z.string().optional(),
});

/** Whether this request starts a sign-in with a provider, so its body may carry a hint. */
export function isSignInStartPath({
  pathname,
  method,
}: {
  pathname: string;
  method: string;
}): boolean {
  return method === "POST" && SIGN_IN_START_PATH.test(pathname);
}

/** What a sign-in start hints at; the address only when one was typed. */
export interface SignInStartHint {
  providerId: string;
  source: "connection" | "provider";
  email?: string;
}

/** The provider and any typed address a sign-in start names, or undefined when it names none. */
export function extractSignInStartHint({
  pathname,
  body,
}: {
  pathname: string;
  body: unknown;
}): SignInStartHint | undefined {
  const route = SIGN_IN_START_PATH.exec(pathname)?.[1];
  const parsed = signInStartBodySchema.safeParse(body);
  if (!route || !parsed.success) return undefined;
  const { providerId, provider, loginHint, email } = parsed.data;
  const named = route === "social" ? provider : providerId;
  if (!named) return undefined;
  const address = normaliseAddress(loginHint ?? (route === "sso" ? email : undefined));
  return {
    providerId: route === "social" ? socialCallbackId(named) : named,
    source: route === "sso" ? "connection" : "provider",
    ...(address ? { email: address } : {}),
  };
}

/** The sign-in page's read of an unfinished sign-in. */
export const UNFINISHED_SIGN_IN_PATH = "/api/auth/sign-in/unfinished";

export function isUnfinishedSignInRead({
  pathname,
  method,
}: {
  pathname: string;
  method: string;
}): boolean {
  return method === "GET" && pathname === UNFINISHED_SIGN_IN_PATH;
}

/** Whether an answer starts a session, after which no earlier sign-in is unfinished. */
export function isSessionStarted({ response }: { response: Response }): boolean {
  return response.headers
    .getSetCookie()
    .some((cookie) => /^(?:__Secure-)?better-auth\.session_token=[^;]/.test(cookie));
}

function normaliseAddress(value: string | undefined): string | undefined {
  const address = value?.trim().toLowerCase();
  if (!address || address.length > MAX_EMAIL_LENGTH) return undefined;
  const at = address.lastIndexOf("@");
  return at > 0 && at < address.length - 1 ? address : undefined;
}

/** Microsoft's legacy callback is handed on as `microsoft`: both spellings are one provider. */
function socialCallbackId(provider: string): string {
  return provider === "azure-ad" ? "microsoft" : provider;
}

const CALLBACK_PATHS: readonly (readonly [RegExp, "connection" | "provider"])[] = [
  [/^\/api\/auth\/sso\/callback\/([^/]+)$/, "connection"],
  [/^\/api\/auth\/sso\/saml2\/sp\/acs\/([^/]+)$/, "connection"],
  [/^\/api\/auth\/oauth2\/callback\/([^/]+)$/, "provider"],
  [/^\/api\/auth\/callback\/([^/]+)$/, "provider"],
];

/** Who a sign-in callback came back from, read off its path alone. */
export function extractCallbackSource({
  pathname,
}: {
  pathname: string;
}): (RefusedSignInSource & { hintProviderId: string }) | undefined {
  for (const [pattern, kind] of CALLBACK_PATHS) {
    const segment = pattern.exec(pathname)?.[1];
    if (!segment) continue;
    const id = decodePathSegment(segment);
    if (!id) return undefined;
    if (kind === "connection") return { kind, connectionId: id, hintProviderId: id };
    const providerId = socialCallbackId(id);
    return { kind, providerId, hintProviderId: providerId };
  }
  return undefined;
}

function decodePathSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}
