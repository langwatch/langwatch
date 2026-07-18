import { createLogger } from "@langwatch/observability";
import type { WebhookMethod } from "~/shared/automations/providers/webhook";
import { isDispatchError } from "~/server/event-sourcing/queues/dispatchError";
import type { WebhookDeliveryInput } from "~/server/app-layer/automations/repositories/webhook-delivery.repository";
import { encrypt } from "~/utils/encryption";
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
/** How much of the receiver's failure response body the log row keeps
 *  (encrypted at rest). */
const LOG_RESPONSE_CHARS = 4000;

/** Mask every configured header VALUE out of stored text. The receiver may
 *  echo the request's Authorization header back in its error output — our
 *  customer's secret must not persist even via their response. */
export function scrubHeaderValues({
  text,
  headers,
}: {
  text: string;
  headers: Record<string, string>;
}): string {
  let out = text;
  for (const value of Object.values(headers)) {
    if (!value) continue;
    out = out.split(value).join("***");
  }
  return out;
}

/** The debugging context a failed attempt keeps, AES-encrypted at rest and
 *  deleted with the row by the 30-day prune. */
export interface WebhookFailureResponse {
  body?: string;
  headers?: Record<string, string>;
  retryAfterMs?: number;
}

function encryptFailureResponse({
  result,
  sentHeaders,
}: {
  result: WebhookSendResult | undefined;
  sentHeaders: Record<string, string>;
}): string | null {
  if (!result) return null;
  const scrub = (text: string) =>
    scrubHeaderValues({ text, headers: sentHeaders });
  const payload: WebhookFailureResponse = {
    body: scrub(result.body).slice(0, LOG_RESPONSE_CHARS),
    ...(result.responseHeaders
      ? {
          headers: Object.fromEntries(
            Object.entries(result.responseHeaders).map(([name, value]) => [
              name,
              scrub(value),
            ]),
          ),
        }
      : {}),
    ...(result.retryAfterMs !== undefined
      ? { retryAfterMs: result.retryAfterMs }
      : {}),
  };
  return encrypt(JSON.stringify(payload));
}

/**
 * Send one webhook dispatch AND record its outcome to the delivery log
 * (ADR-040 §5 + §6) as a single unit: on 2xx a `success` row, on a classified
 * non-2xx a `retryable`/`terminal` row, on a transport/SSRF throw a row with
 * the error and no status. A failed attempt keeps the receiver's truncated
 * response (body + headers) encrypted at rest for debugging — scrubbed of our
 * configured header values — and it is deleted with the row by the prune. The
 * classified DispatchError is always re-thrown so the outbox retry contract
 * is unchanged — logging is a side effect that never swallows a dispatch
 * failure, and a logging failure never breaks dispatch.
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
    // The classified message may quote the receiver's error response; our
    // configured header values are scrubbed even if the receiver echoes
    // them back. Request content never appears here.
    const error = scrubHeaderValues({
      text: err instanceof Error ? err.message : String(err),
      headers: headers ?? {},
    }).slice(0, LOG_ERROR_CHARS);
    await safeRecord({
      ...baseRow,
      responseStatus: result?.status ?? null,
      latencyMs: Date.now() - startedAt,
      error,
      responseEncrypted: encryptFailureResponse({
        result,
        sentHeaders: headers ?? {},
      }),
      outcome: retryable ? "retryable" : "terminal",
    });
    throw err;
  }
}
