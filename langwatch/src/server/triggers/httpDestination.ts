import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

/** Total-request timeout — a slowloris endpoint can't pin a worker slot. */
const DEFAULT_TIMEOUT_MS = 10_000;
/** Response body is read for the caller to interpret / log; cap what we keep so
 *  a hostile endpoint can't return gigabytes into memory. */
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface HttpDestinationRequest {
  url: string;
  method?: "POST" | "PUT" | "PATCH";
  /** Static headers. Content-Type et al. are the caller's to set. */
  headers?: Record<string, string>;
  /** Serialised request body (JSON, form, …). */
  body?: string;
  timeoutMs?: number;
  /** Short label woven into DispatchError messages (e.g. the trigger name). */
  contextLabel: string;
}

export interface HttpDestinationResponse {
  status: number;
  /** Response body, truncated to {@link MAX_RESPONSE_BYTES}. */
  body: string;
}

/**
 * The one SSRF-fenced outbound HTTP utility every customer-endpoint dispatch
 * shares (ADR-030 Consequences / ADR-040 §4). All outbound goes through the
 * audited {@link ssrfSafeFetch} — cloud-metadata denylist, private-IP blocking,
 * DNS-rebinding defeat via IP pinning, and redirect re-validation — never a
 * hand-rolled `fetch`. A total-request timeout bounds slow endpoints and the
 * response is read with a size cap.
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
  contextLabel,
}: HttpDestinationRequest): Promise<HttpDestinationResponse> {
  let response: Awaited<ReturnType<typeof ssrfSafeFetch>>;
  try {
    response = await ssrfSafeFetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // An SSRF rejection is a permanent misconfiguration; DNS / connection /
    // timeout failures are transient and worth a retry.
    const ssrfBlocked =
      /ssrf|blocked|not allowed|private|loopback|metadata|link-local|disallowed/i.test(
        message,
      );
    throw new DispatchError({
      message: `${contextLabel}: HTTP request failed — ${message}`,
      retryable: !ssrfBlocked,
    });
  }

  let responseBody = "";
  try {
    const text = await response.text();
    responseBody =
      text.length > MAX_RESPONSE_BYTES ? text.slice(0, MAX_RESPONSE_BYTES) : text;
  } catch {
    // Body unreadable (already-consumed / stream error) — the status still
    // carries the outcome; leave the snippet empty.
  }

  return { status: response.status, body: responseBody };
}
