import type { Instant } from "@langwatch/time";

import { isSignInCallbackPath } from "../rules/sign-in-callback-failure.rules.ts";
import {
  buildClearedSignInHintCookie,
  buildSignInHintCookie,
  extractRoundTripValue,
  extractSignInHintCookie,
  extractSignInStartHint,
  isSessionStarted,
  isSignInStartPath,
  MAX_CALLBACK_FORM_BYTES,
  MAX_SIGN_IN_START_BYTES,
  roundTripBindingOf,
  type SignInHintSealer,
  type SignInStartHint,
} from "../rules/sign-in-hint.rules.ts";

type SignInHintDeps = Readonly<{
  baseUrl(): string;
  now(): Instant;
  signInHints(): SignInHintSealer;
}>;

type SignInBodies = Readonly<{
  startHint: SignInStartHint | undefined;
  callbackForm: string | undefined;
}>;

/** The sealed hint a sign-in start leaves for its callback, and the bodies it is read from. */
export class SignInHintService {
  static create(deps: SignInHintDeps): SignInHintService {
    return new SignInHintService(deps);
  }

  private constructor(private readonly deps: SignInHintDeps) {}

  /** What a sign-in start or callback body says, each read off its own copy of the request. */
  async readSignInBodies({
    request,
    pathname,
  }: {
    request: Request;
    pathname: string;
  }): Promise<SignInBodies> {
    return {
      startHint: await this.readSignInStartHint({ request, pathname }),
      callbackForm: await this.readCallbackForm({ request, pathname }),
    };
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
      const read = await readBoundedText({
        request: request.clone(),
        maxBytes: MAX_SIGN_IN_START_BYTES,
      });
      if (read.kind !== "read") return undefined;
      const body: unknown = JSON.parse(read.text);
      return extractSignInStartHint({ pathname, body });
    } catch {
      return undefined;
    }
  }

  /**
   * Sets the hint on an accepted sign-in start, bound to the round-trip value its answer sends the
   * person to the provider with, and drops it once a callback has answered or a session started.
   */
  async carrySignInHint({
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
