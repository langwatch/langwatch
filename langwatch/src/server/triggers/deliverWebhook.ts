import { createLogger } from "@langwatch/observability";
import {
  redactHeadersForLog,
  redactWebhookUrlForLog,
  type WebhookMethod,
} from "~/automations/providers/definitions/webhook/shared";
import { isDispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import type { WebhookDeliveryInput } from "~/server/app-layer/triggers/repositories/webhook-delivery.repository";
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

/** The request half of a delivery row — the same across every attempt of one
 *  fire. URL and header values are redacted before they reach the log. */
type WebhookDeliveryBaseRow = Pick<
  WebhookDeliveryInput,
  | "projectId"
  | "triggerId"
  | "dispatchId"
  | "requestMethod"
  | "requestUrl"
  | "requestHeaders"
>;

function buildBaseRow({
  projectId,
  triggerId,
  eventId,
  method,
  url,
  headers,
}: {
  projectId: string;
  triggerId: string;
  eventId: string;
  method?: WebhookMethod;
  url: string;
  headers?: Record<string, string>;
}): WebhookDeliveryBaseRow {
  return {
    projectId,
    triggerId,
    dispatchId: eventId,
    requestMethod: method ?? "POST",
    requestUrl: redactWebhookUrlForLog(url),
    requestHeaders: redactHeadersForLog(headers ?? {}),
  };
}

/** Best-effort recorder wrapper: a logging failure never breaks dispatch. */
async function recordDelivery(
  recorder: WebhookDeliveryRecorder | undefined,
  row: WebhookDeliveryInput,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder(row);
  } catch (err) {
    logger.warn(
      { projectId: row.projectId, triggerId: row.triggerId, error: err },
      "Failed to record webhook delivery attempt — dispatch unaffected",
    );
  }
}

function successRow(
  base: WebhookDeliveryBaseRow,
  result: WebhookSendResult,
  startedAt: number,
): WebhookDeliveryInput {
  return {
    ...base,
    responseStatus: result.status,
    responseBody: result.body.slice(0, LOG_BODY_SNIPPET_CHARS),
    latencyMs: Date.now() - startedAt,
    outcome: "success",
  };
}

function failureRow(
  base: WebhookDeliveryBaseRow,
  result: WebhookSendResult | undefined,
  err: unknown,
  startedAt: number,
): WebhookDeliveryInput {
  const retryable = isDispatchError(err) && err.retryable;
  return {
    ...base,
    // A result means a non-2xx classified by assert (status carries the
    // failure); no result means sendWebhook threw before responding
    // (transport / SSRF / rate-limit), so the message is the detail.
    responseStatus: result?.status ?? null,
    responseBody: result ? result.body.slice(0, LOG_BODY_SNIPPET_CHARS) : null,
    latencyMs: Date.now() - startedAt,
    error: result ? null : err instanceof Error ? err.message : String(err),
    outcome: retryable ? "retryable" : "terminal",
  };
}

interface DeliverWebhookArgs {
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
}

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
}: DeliverWebhookArgs): Promise<WebhookSendResult> {
  const startedAt = Date.now();
  const baseRow = buildBaseRow({
    projectId,
    triggerId,
    eventId,
    method,
    url,
    headers,
  });

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
    await recordDelivery(recorder, successRow(baseRow, result, startedAt));
    return result;
  } catch (err) {
    await recordDelivery(recorder, failureRow(baseRow, result, err, startedAt));
    throw err;
  }
}
