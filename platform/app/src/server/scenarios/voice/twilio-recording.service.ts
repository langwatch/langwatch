/**
 * Resolve a phone call's whole-call recording from the Twilio REST API.
 *
 * Twilio publishes a call's recording shortly after the call ends, under
 * `GET /2010-04-01/Accounts/{sid}/Recordings.json?CallSid={callSid}`. This
 * lists them, takes the first, and returns the `.wav` media URL the route
 * streams through {@link proxyAudioStream}. Null when Twilio has none yet, so
 * the caller answers 404 and the player can retry.
 *
 * The auth token is basic-auth material only: it is never logged, and the
 * header it builds never leaves the request to Twilio.
 *
 * @see specs/features/agents/voice-phone.feature
 */

import type { TwilioCredential } from "~/server/gateway/twilioCredential.service";
import { VOICE_HTTP_TIMEOUT_MS } from "./voice-limits";

/** The Twilio REST API host. Recording `uri`s come back relative to it. */
const TWILIO_API_BASE = "https://api.twilio.com";

/** The basic-auth header for the Twilio REST API. Kept in one place so the
 *  token is base64-encoded and never string-interpolated into a log line. */
export function twilioBasicAuthHeader({
  accountSid,
  authToken,
}: Pick<TwilioCredential, "accountSid" | "authToken">): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

/**
 * The `.wav` media URL of the call's first recording, or null when Twilio has
 * none yet (or the listing could not be read). A refused redirect, a non-ok
 * response and a network failure all read the same way: nothing to play yet.
 */
export async function resolveTwilioRecordingWavUrl({
  credential,
  callSid,
  signal,
}: {
  credential: TwilioCredential;
  callSid: string;
  signal: AbortSignal;
}): Promise<string | null> {
  const listUrl = `${TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(
    credential.accountSid,
  )}/Recordings.json?CallSid=${encodeURIComponent(callSid)}`;

  // Race the connect/headers phase with a timeout the same way
  // {@link proxyAudioStream} does, since this fetch runs before the proxy
  // applies its own: a Twilio edge that withholds response headers must not
  // hang this request indefinitely. The caller's abort still propagates.
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    VOICE_HTTP_TIMEOUT_MS,
  );
  const onCallerAbort = () => timeoutController.abort();
  signal.addEventListener("abort", onCallerAbort);

  let response: Response;
  try {
    response = await fetch(listUrl, {
      headers: { authorization: twilioBasicAuthHeader(credential) },
      signal: timeoutController.signal,
      redirect: "error",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onCallerAbort);
  }
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as {
    recordings?: Array<{ uri?: unknown }>;
  } | null;
  const uri = body?.recordings?.[0]?.uri;
  if (typeof uri !== "string" || uri.length === 0) return null;

  // The listing `uri` is the resource JSON path
  // (`/2010-04-01/.../Recordings/RE....json`); the media is the same path with
  // a `.wav` extension.
  const withoutJson = uri.replace(/\.json$/, "");
  return `${TWILIO_API_BASE}${withoutJson}.wav`;
}
