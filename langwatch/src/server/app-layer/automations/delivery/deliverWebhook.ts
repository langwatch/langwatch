import { createLogger } from "@langwatch/observability";
import {
  redactHeadersForLog,
  type WebhookMethod,
} from "~/automations/providers/definitions/webhook/shared";
import { isDispatchError } from "~/server/event-sourcing/queues/dispatchError";
import type { WebhookDeliveryInput } from "~/server/app-layer/automations/repositories/webhook-delivery.repository";
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

/** How much of the receiver's response the log row keeps (schema caps aside). */
const LOG_BODY_SNIPPET_CHARS = 4000;

/**
 * Send one webhook dispatch AND record its outcome to the delivery log
 * (ADR-040 §5 + §6) as a single unit: on 2xx a `success` row, on a classified
 * non-2xx a `retryable`/`terminal` row, on a transport/SSRF throw a row with
 * the error and no status. The classified DispatchError is always re-thrown so
 * the outbox retry contract is unchanged — logging is a side effect that never
 * swallows a dispatch failure, and a logging failure never breaks dispatch.
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
  /** Decrypted headers; redacted before they reach the log row. */
  headers?: Record<string, string>;
  body: string;
  triggerName: string;
}): Promise<WebhookSendResult> {
  const startedAt = Date.now();
  const baseRow = {
    projectId,
    triggerId,
    dispatchId: eventId,
    requestMethod: method ?? "POST",
    requestUrl: url,
    requestHeaders: redactHeadersForLog(headers ?? {}),
  };
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
      responseBody: result.body.slice(0, LOG_BODY_SNIPPET_CHARS),
      latencyMs: Date.now() - startedAt,
      outcome: "success",
    });
    return result;
  } catch (err) {
    const retryable = isDispatchError(err) && err.retryable;
    await safeRecord({
      ...baseRow,
      // A result means a non-2xx classified by assert (status carries the
      // failure); no result means sendWebhook threw before responding
      // (transport / SSRF / rate-limit), so the message is the detail.
      responseStatus: result?.status ?? null,
      responseBody: result
        ? result.body.slice(0, LOG_BODY_SNIPPET_CHARS)
        : null,
      latencyMs: Date.now() - startedAt,
      error: result ? null : err instanceof Error ? err.message : String(err),
      outcome: retryable ? "retryable" : "terminal",
    });
    throw err;
  }
}
