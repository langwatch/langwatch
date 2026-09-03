import { DispatchError, parseRetryAfterMs } from "@langwatch/eventing";
import { fetchValidatedDestination, type EgressTlsPolicy } from "../ssrf/fenced-fetch";
import type { SsrfUrlValidator } from "../ssrf/url-validator";

/**
 * The one fenced outbound HTTP utility every customer-endpoint dispatch shares.
 *
 * THE implementation, since 2026-09-02: the platform copy it was frozen
 * against was deleted with the webhook lane. All
 * outbound goes through the audited fence — metadata denylist, private-address
 * blocking, DNS-rebinding defeat via IP pinning, redirect refusal — never a
 * hand-rolled `fetch`. A total-request timeout bounds slow receivers (enforced
 * both by an AbortSignal and, as a backstop, by socket-level bounds on the
 * dispatching agent) and the response is read with a size cap.
 *
 * Transport-level failure (DNS, connection reset, timeout) throws a RETRYABLE
 * DispatchError; a fence block throws a TERMINAL one, because a fenced URL never
 * becomes valid on retry. The HTTP status is RETURNED, not thrown — each caller
 * classifies 2xx/4xx/5xx per its own contract (a webhook and Slack disagree on
 * what a 4xx means), then rides the outbox retry machinery.
 *
 * WHAT DID NOT COME ACROSS: the application's `validateUrl` is optional, and an
 * omitted one falls back to a module-level validator built from the environment.
 * A package has no environment, so naming the address policy is mandatory here.
 * There is no default that could be quietly weaker than the caller believed.
 */

/** Total-request timeout — a slowloris receiver cannot pin a worker slot. */
const DEFAULT_TIMEOUT_MS = 10_000;
/**
 * Response bytes read for the caller to interpret or log. Stop here so a hostile
 * receiver cannot stream gigabytes into memory.
 */
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

/** Per-value and per-count caps on the response headers kept for debugging. */
const RESPONSE_HEADER_VALUE_CHARS = 200;
const RESPONSE_HEADER_MAX_COUNT = 32;

export interface HttpDestinationRequest {
  url: string;
  method?: "POST" | "PUT" | "PATCH";
  /** Static headers. Content-Type et al. are the caller's to set. */
  headers?: Record<string, string>;
  /** Serialised request body (JSON, form, …). */
  body?: string;
  timeoutMs?: number;
  /**
   * How many response bytes are read off the wire before the stream is
   * cancelled. Raise it only when the caller genuinely needs to PARSE the body
   * (a truncated body is not valid JSON), and only as far as that payload needs.
   */
  maxResponseBytes?: number;
  /** Short label woven into DispatchError messages (e.g. the automation name). */
  contextLabel: string;
  /**
   * Which addresses this send may reach. Redirects are NOT followed: a hop is an
   * address this policy never judged.
   */
  validateUrl: SsrfUrlValidator;
  /** Whether TLS certificates are verified — the deployment's answer, not this module's. */
  tls: EgressTlsPolicy;
}

export interface HttpDestinationResponse {
  status: number;
  /** Response body, truncated at {@link HttpDestinationRequest.maxResponseBytes}. */
  body: string;
  /** Response headers, truncated per value — debugging context for the delivery log. */
  responseHeaders: Record<string, string>;
  /**
   * Parsed `Retry-After` (ms) when the receiver sent one — a backpressure hint
   * the caller can fold into its retry backoff.
   */
  retryAfterMs?: number;
}

type FenceResponse = Awaited<ReturnType<typeof fetchValidatedDestination>>;

function captureResponseHeaders(
  headers: FenceResponse["headers"] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  let count = 0;
  for (const [name, value] of headers.entries()) {
    if (count >= RESPONSE_HEADER_MAX_COUNT) break;
    out[name] = value.slice(0, RESPONSE_HEADER_VALUE_CHARS);
    count++;
  }
  return out;
}

/**
 * Reads at most `maxBytes` off the response stream, then cancels it.
 *
 * The cap bounds ALLOCATION, not just retention: bytes past the cap are never
 * pulled, and the remainder of the transfer is torn down rather than drained.
 * Decoding is incremental, so a cap landing mid-codepoint yields a replacement
 * character rather than throwing.
 */
async function readCappedBody({
  body,
  maxBytes,
}: {
  body: FenceResponse["body"];
  maxBytes: number;
}): Promise<string> {
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let received = 0;

  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - received;
      const chunk = value.length > remaining ? value.subarray(0, remaining) : value;
      received += chunk.length;
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
  } finally {
    // Past the cap (or on a read error) we neither pull nor buffer another byte
    // — cancelling tears the transfer down instead of draining it.
    await reader.cancel().catch(() => undefined);
  }

  return text;
}

/**
 * A fence refusal is a permanent misconfiguration (as is a redirect on the
 * strict path — the endpoint's shape, not a blip); DNS, connection and timeout
 * failures are transient and worth a retry.
 */
const FENCE_REFUSAL =
  /ssrf|blocked|not allowed|private|loopback|metadata|link-local|disallowed|redirects are not followed|too many redirects/i;

export async function sendHttpDestination({
  url,
  method = "POST",
  headers,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  contextLabel,
  validateUrl,
  tls,
}: HttpDestinationRequest): Promise<HttpDestinationResponse> {
  let response: FenceResponse;
  try {
    const validated = await validateUrl(url);
    response = await fetchValidatedDestination(
      validated,
      {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        // Defence in depth: if the signal is ever dropped, undici still gives up
        // on a stalled receiver instead of waiting out its 300s default.
        headersTimeoutMs: timeoutMs,
        bodyTimeoutMs: timeoutMs,
        followRedirects: false,
      },
      tls,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DispatchError({
      message: `${contextLabel}: HTTP request failed — ${message}`,
      retryable: !FENCE_REFUSAL.test(message),
    });
  }

  let responseBody = "";
  try {
    responseBody = await readCappedBody({
      body: response.body,
      maxBytes: maxResponseBytes,
    });
  } catch {
    // Body unreadable (stream error, timeout mid-body) — the status still
    // carries the outcome; leave the snippet empty.
  }

  return {
    status: response.status,
    body: responseBody,
    responseHeaders: captureResponseHeaders(response.headers),
    retryAfterMs: parseRetryAfterMs(response.headers?.get("retry-after")),
  };
}
