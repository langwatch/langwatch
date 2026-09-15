// Resolve phone call's recording from Twilio REST API. Returns .wav media URL or null if not ready.
// Auth token basic-auth only; never logged, never leaves request to Twilio.

import { VOICE_HTTP_TIMEOUT_MS } from "./voice-limits.ts";

/**
 * The subset of the stored Twilio account credential this file reads to
 * authenticate a REST call. The full shape (also carrying the origination
 * number) lives server-side in `modules/gateway/server`, which has no
 * contract-legal home to publish it from yet — see the handoff's Risks.
 */
export interface TwilioCredential {
  accountSid: string;
  authToken: string;
}

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
  // The abort event fires at most once. A signal already aborted before we
  // got here would never reach a freshly-added listener, so the fetch would
  // start anyway and could wait the full timeout.
  if (signal.aborted) timeoutController.abort();
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
    recordings?: { uri?: unknown }[];
  } | null;
  const uri = body?.recordings?.[0]?.uri;
  if (typeof uri !== "string" || uri.length === 0) return null;

  // The listing `uri` is the resource JSON path
  // (`/2010-04-01/.../Recordings/RE....json`); the media is the same path with
  // a `.wav` extension.
  const withoutJson = uri.replace(/\.json$/, "");
  return `${TWILIO_API_BASE}${withoutJson}.wav`;
}
