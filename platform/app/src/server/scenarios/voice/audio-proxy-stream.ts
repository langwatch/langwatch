/**
 * Stream an upstream audio response through the app, so a provider credential
 * never reaches the browser (AC13/AC15).
 *
 * The shared body of every voice audio proxy route: the per-turn ElevenLabs
 * recording, and the whole-call recording for both transports. A timeout races
 * the connect/headers phase only — once the response arrives the body streams
 * uncut, so a long recording is never truncated — while the caller's own abort
 * (tab closed) still propagates the whole way through. Any connect failure,
 * refused redirect or non-ok upstream reads to the player the same way: no
 * recording to play, answered as {@link VoiceRecordingUnavailableError} (404)
 * rather than a 500.
 */

import { VOICE_HTTP_TIMEOUT_MS } from "./voice-limits";
import { VoiceRecordingUnavailableError } from "./voice-session.service";

export async function proxyAudioStream({
  signal,
  url,
  headers,
  fallbackContentType,
  forceContentType,
}: {
  /** The caller's request signal, so a cancelled request aborts the fetch. */
  signal: AbortSignal;
  url: string;
  headers: Record<string, string>;
  /** Content type used when the upstream names none. */
  fallbackContentType: string;
  /** Content type to send regardless of what the upstream names (Twilio serves
   *  a `.wav` we always label `audio/wav`). */
  forceContentType?: string;
}): Promise<Response> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    VOICE_HTTP_TIMEOUT_MS,
  );
  const onCallerAbort = () => timeoutController.abort();
  signal.addEventListener("abort", onCallerAbort);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers,
      signal: timeoutController.signal,
      // A followed redirect would forward the credentialed header to whatever
      // host answered it.
      redirect: "error",
    });
  } catch {
    throw new VoiceRecordingUnavailableError();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onCallerAbort);
  }

  if (!upstream.ok || !upstream.body) {
    throw new VoiceRecordingUnavailableError();
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        forceContentType ??
        upstream.headers.get("content-type") ??
        fallbackContentType,
      "cache-control": "no-store",
    },
  });
}
