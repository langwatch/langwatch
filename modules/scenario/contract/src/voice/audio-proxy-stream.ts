/** Stream upstream audio through app to hide provider credential; timeout on
 * connect only, body streams uncut, caller abort propagates, failures = 404.
 */

import { VOICE_HTTP_TIMEOUT_MS } from "./voice-limits.ts";
import { VoiceRecordingUnavailableError } from "./voice-session.service.ts";

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
  const timeout = setTimeout(() => timeoutController.abort(), VOICE_HTTP_TIMEOUT_MS);
  // The abort event fires at most once. A signal already aborted before we
  // got here would never reach a freshly-added listener, so the fetch would
  // start anyway and could wait the full timeout.
  if (signal.aborted) timeoutController.abort();
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
        forceContentType ?? upstream.headers.get("content-type") ?? fallbackContentType,
      "cache-control": "no-store",
    },
  });
}
