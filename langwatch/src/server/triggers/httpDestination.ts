import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import {
  fetchWithResolvedIp,
  ssrfSafeFetch,
  type SSRFValidationResult,
} from "~/utils/ssrfProtection";

/** Total-request timeout — a slowloris endpoint can't pin a worker slot. */
const DEFAULT_TIMEOUT_MS = 10_000;
/** Response body is read for the caller to interpret / log; stop reading here
 *  so a hostile endpoint can't stream gigabytes into memory. */
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

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
   * cancelled. Defaults to {@link DEFAULT_MAX_RESPONSE_BYTES} — enough for an
   * error snippet, not enough to hurt. Raise it only when the caller genuinely
   * needs to PARSE the body (a truncated body is not valid JSON), and only as
   * far as that payload actually needs.
   */
  maxResponseBytes?: number;
  /** Short label woven into DispatchError messages (e.g. the trigger name). */
  contextLabel: string;
  /**
   * Override the SSRF validator — e.g. a `createSSRFValidator({ blockLocal:
   * true, allowedHosts: [] })` instance that blocks private IPs regardless of
   * the global BLOCK_LOCAL_HTTP_CALLS toggle (ADR-040 §4). When set, redirects
   * are NOT followed: hop re-validation inside `fetchWithResolvedIp` uses the
   * default (env-gated) validator, so following a redirect would silently drop
   * back to the weaker policy. A 3xx is returned to the caller to classify.
   */
  validateUrl?: (url: string) => Promise<SSRFValidationResult>;
}

export interface HttpDestinationResponse {
  status: number;
  /** Response body, truncated at {@link HttpDestinationRequest.maxResponseBytes}. */
  body: string;
}

type ResponseBodyStream = Awaited<ReturnType<typeof ssrfSafeFetch>>["body"];

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
  body: ResponseBodyStream;
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
      const chunk =
        value.length > remaining ? value.subarray(0, remaining) : value;
      received += chunk.length;
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
  } finally {
    // Past the cap (or on a read error) we neither pull nor buffer another
    // byte — cancelling tears the transfer down instead of draining it.
    await reader.cancel().catch(() => undefined);
  }

  return text;
}

/**
 * The one SSRF-fenced outbound HTTP utility every customer-endpoint dispatch
 * shares (ADR-030 Consequences / ADR-040 §4). All outbound goes through the
 * audited {@link ssrfSafeFetch} — cloud-metadata denylist, private-IP blocking,
 * DNS-rebinding defeat via IP pinning, and redirect re-validation — never a
 * hand-rolled `fetch`. A total-request timeout bounds slow endpoints (enforced
 * both by an AbortSignal and, as a backstop, by socket-level bounds on the
 * dispatching agent) and the response is read with a size cap.
 *
 * Transport-level failure (DNS, connection reset, timeout) throws a **retryable**
 * DispatchError; an SSRF block throws a **terminal** one (a fenced URL never
 * becomes valid on retry). The HTTP status is RETURNED, not thrown — each caller
 * classifies 2xx/4xx/5xx per its own contract (a webhook and Slack disagree on
 * what a 4xx means), then rides the outbox retry machinery.
 */
export async function sendHttpDestination({
  url,
  method = "POST",
  headers,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  contextLabel,
  validateUrl,
}: HttpDestinationRequest): Promise<HttpDestinationResponse> {
  let response: Awaited<ReturnType<typeof ssrfSafeFetch>>;
  try {
    const init = {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
      // Defence in depth: if the signal is ever dropped again, undici still
      // gives up on a stalled endpoint instead of waiting out its 300s default
      // on every one of up to 10 redirect hops.
      headersTimeoutMs: timeoutMs,
      bodyTimeoutMs: timeoutMs,
    };
    if (validateUrl) {
      const validated = await validateUrl(url);
      // MAX_SAFE_INTEGER pre-exhausts the redirect budget: the first 3xx with
      // a Location throws instead of hopping through the weaker default
      // validator (see `validateUrl` on the request type).
      response = await fetchWithResolvedIp(validated, {
        ...init,
        _redirectCount: Number.MAX_SAFE_INTEGER,
      });
    } else {
      response = await ssrfSafeFetch(url, init);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // An SSRF rejection is a permanent misconfiguration (as is a redirect on
    // the strict-validator path — the endpoint's shape, not a blip); DNS /
    // connection / timeout failures are transient and worth a retry.
    const ssrfBlocked =
      /ssrf|blocked|not allowed|private|loopback|metadata|link-local|disallowed|too many redirects/i.test(
        message,
      );
    throw new DispatchError({
      message: `${contextLabel}: HTTP request failed — ${message}`,
      retryable: !ssrfBlocked,
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

  return { status: response.status, body: responseBody };
}
