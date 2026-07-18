import { createLogger } from "@langwatch/observability";
import type { WebhookMethod } from "~/shared/automations/providers/webhook";
import { isDispatchError } from "~/server/event-sourcing/queues/dispatchError";
import type {
  WebhookDeliveryInput,
  WebhookFailureKind,
} from "~/server/app-layer/automations/repositories/webhook-delivery.repository";
import {
  assertWebhookDelivered,
  sendWebhook,
  type WebhookSendResult,
} from "./sendWebhook";

const logger = createLogger("langwatch:webhook-delivery");

/** Records one attempt of the delivery log (ADR-040 §6). Optional — the
 *  test-fire path passes none, so nothing is logged for ephemeral tests. */
export type WebhookDeliveryRecorder = (
  input: WebhookDeliveryInput,
) => Promise<void>;

/** How much of the failure message the log row keeps. */
const LOG_ERROR_CHARS = 500;

/**
 * Classify a failed attempt for the drawer's operator guidance. Status codes
 * win when a response arrived; otherwise the transport error's message is
 * matched against the SSRF-gate / timeout shapes our own senders raise.
 */
export function classifyWebhookFailure({
  status,
  error,
}: {
  status: number | null;
  error: string | null;
}): WebhookFailureKind {
  if (status !== null) {
    if (status === 429) return "rate_limited";
    if (status === 408 || status >= 500) return "server_error";
    return "client_error";
  }
  const message = (error ?? "").toLowerCase();
  if (
    message.includes("ssrf") ||
    message.includes("blocked") ||
    message.includes("redirect") ||
    message.includes("private") ||
    message.includes("not allowed")
  ) {
    return "blocked_url";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "timeout";
  }
  return "network";
}

/**
 * Send one webhook dispatch AND record its outcome to the delivery log
 * (ADR-040 §5 + §6) as a single unit: on 2xx a `success` row, on a classified
 * non-2xx a `retryable`/`terminal` row, on a transport/SSRF throw a row with
 * the error and no status. The log stores outcome facts only — never the
 * request URL, headers, or response body. The classified DispatchError is
 * always re-thrown so the outbox retry contract is unchanged — logging is a
 * side effect that never swallows a dispatch failure, and a logging failure
 * never breaks dispatch.
 */
export async function deliverWebhook({
  send = sendWebhook,
  recorder,
  projectId,
  triggerId,
  eventId,
  url,
  method,
  headers,
  body,
  triggerName,
}: {
  /** The sender — defaults to the real one; the graph-alert path injects its
   *  own `deps.sendWebhook` so its unit tests keep the mock seam. */
  send?: typeof sendWebhook;
  recorder?: WebhookDeliveryRecorder;
  projectId: string;
  triggerId: string;
  /** Stable per-fire id — the delivery log's `dispatchId` and the sent
   *  `X-LangWatch-Event-Id`, so attempts of one fire group together. */
  eventId: string;
  url: string;
  method?: WebhookMethod;
  /** Decrypted headers; sent on the wire, never stored anywhere. */
  headers?: Record<string, string>;
  body: string;
  triggerName: string;
}): Promise<WebhookSendResult> {
  const startedAt = Date.now();
  const baseRow = { projectId, triggerId, dispatchId: eventId };
  const safeRecord = async (row: WebhookDeliveryInput) => {
    if (!recorder) return;
    try {
      await recorder(row);
    } catch (err) {
      logger.warn(
        { projectId, triggerId, error: err },
        "Failed to record webhook delivery attempt — dispatch unaffected",
      );
    }
  };

  let result: WebhookSendResult | undefined;
  try {
    result = await send({
      url,
      method,
      headers,
      body,
      triggerName,
      projectId,
      eventId,
    });
    // Throws a classified DispatchError on a non-2xx (ADR-040 §5).
    assertWebhookDelivered({ result, triggerName });
    await safeRecord({
      ...baseRow,
      responseStatus: result.status,
      latencyMs: Date.now() - startedAt,
      outcome: "success",
    });
    return result;
  } catch (err) {
    const retryable = isDispatchError(err) && err.retryable;
    const status = result?.status ?? null;
    // A response means the status IS the fact — the classified error message
    // embeds a response-body snippet, which must never persist. Only a
    // no-response failure stores its message (our own transport/SSRF text).
    const error = result
      ? null
      : (err instanceof Error ? err.message : String(err)).slice(
          0,
          LOG_ERROR_CHARS,
        );
    await safeRecord({
      ...baseRow,
      responseStatus: status,
      latencyMs: Date.now() - startedAt,
      error,
      failureKind: classifyWebhookFailure({ status, error }),
      outcome: retryable ? "retryable" : "terminal",
    });
    throw err;
  }
}
