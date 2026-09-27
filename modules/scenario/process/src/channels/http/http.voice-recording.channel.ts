import { VOICE_HTTP_TIMEOUT_MS } from "@langwatch/scenario-contract";
import { VoiceRecordingUnavailableError } from "@langwatch/scenario-contract/voice-runtime";

import { twilioBasicAuthHeader } from "../../rules/twilio-auth.rules.ts";
import type { VoiceRecordingChannel } from "../voice-recording.channel.ts";

/** The Twilio REST API host. Recording `uri`s come back relative to it. */
const TWILIO_API_BASE = "https://api.twilio.com";

export class HttpVoiceRecordingChannel implements VoiceRecordingChannel {
  static create(): HttpVoiceRecordingChannel {
    return new HttpVoiceRecordingChannel();
  }

  private constructor() {}

  /** Streams upstream audio through the app so the provider credential stays server-side. */
  async open(input: {
    url: string;
    headers: Record<string, string>;
    mediaType: string;
    signal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>> {
    const upstream = await fetchWithConnectTimeout({
      url: input.url,
      headers: input.headers,
      signal: input.signal,
    }).catch(() => {
      throw new VoiceRecordingUnavailableError();
    });
    if (!upstream.ok || !upstream.body) throw new VoiceRecordingUnavailableError();

    return upstream.body;
  }

  /**
   * The `.wav` media URL of the call's first recording. Throws
   * `VoiceRecordingUnavailableError` while Twilio has none; a network failure,
   * a refused redirect or a non-404 refusal propagates as the failure it is.
   */
  async getTwilioRecordingWavUrl(input: {
    credential: { accountSid: string; authToken: string };
    callSid: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const listUrl = `${TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(
      input.credential.accountSid,
    )}/Recordings.json?CallSid=${encodeURIComponent(input.callSid)}`;
    const response = await fetchWithConnectTimeout({
      url: listUrl,
      headers: { authorization: twilioBasicAuthHeader(input.credential) },
      signal: input.signal,
    });
    if (response.status === 404) throw new VoiceRecordingUnavailableError();
    if (!response.ok) throw new Error(`Twilio recordings listing answered ${response.status}`);

    const body: unknown = await response.json();
    const uri = extractRecordingUri(body);
    if (!uri) throw new VoiceRecordingUnavailableError();

    // The listing `uri` is the resource JSON path; the media is the same path with `.wav`.
    return `${TWILIO_API_BASE}${uri.replace(/\.json$/, "")}.wav`;
  }
}

/**
 * Races the connect/headers phase against a timeout, so an edge that withholds response
 * headers cannot hang the request; the caller's abort still propagates. A followed
 * redirect would forward the credentialed header to whatever host answered it.
 */
async function fetchWithConnectTimeout(input: {
  url: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<Response> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), VOICE_HTTP_TIMEOUT_MS);
  // An already-aborted signal never reaches a fresh listener, so check it first.
  if (input.signal?.aborted) timeoutController.abort();
  const onCallerAbort = () => timeoutController.abort();
  input.signal?.addEventListener("abort", onCallerAbort);
  try {
    return await fetch(input.url, {
      headers: input.headers,
      signal: timeoutController.signal,
      redirect: "error",
    });
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function extractRecordingUri(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("recordings" in body)) return undefined;
  const { recordings } = body;
  if (!Array.isArray(recordings)) return undefined;
  const first: unknown = recordings[0];
  if (typeof first !== "object" || first === null || !("uri" in first)) return undefined;
  const { uri } = first;
  return typeof uri === "string" && uri.length > 0 ? uri : undefined;
}
