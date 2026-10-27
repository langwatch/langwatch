/**
 * What a receiver's answer means, and the headers a delivery is identified
 * by. FROZEN TWIN of `platform/app/src/server/webhooks/sendWebhook.ts`'s
 * classification half — a header rename is invisible until retries double.
 */

/**
 * The automations channel's published dispatch-identity header. One dispatch
 * there IS one event (an automation fired), so the name is accurate and its
 * consumers key idempotency off it.
 */
export const WEBHOOK_EVENT_ID_HEADER = "X-LangWatch-Event-Id";

/**
 * The webhook platform's dispatch-identity header. A delivery carries a
 * BATCH of envelopes, each with its own `id` — dedup on that envelope id,
 * never this header, which only groups retries of one POST.
 */
export const WEBHOOK_DELIVERY_ID_HEADER = "X-LangWatch-Delivery-Id";

/** 1-based delivery attempt, so a receiver can tell a first delivery from a retry. */
export const WEBHOOK_DELIVERY_ATTEMPT_HEADER = "X-LangWatch-Delivery-Attempt";

/** Marks a drawer test fire non-suppressibly. */
export const WEBHOOK_TEST_FIRE_HEADER = "X-LangWatch-Test-Fire";

export interface WebhookSendResult {
  status: number;
  /** Response snippet, already size-capped by the HTTP utility. */
  body: string;
  /** Truncated response headers — debugging context for the delivery log. */
  responseHeaders?: Record<string, string>;
  /** Parsed `Retry-After` (ms) the receiver asked us to back off by. */
  retryAfterMs?: number;
  /** The dispatch id actually sent — surfaced for the delivery log. */
  eventId: string;
}

/** How much of the receiver's response rides in an error message. */
const ERROR_SNIPPET_CHARS = 300;

/**
 * The retry-vs-terminal classification, as a value, not a throw: 2xx is
 * success; 5xx/429/408 retry; everything else (including 3xx, which the
 * strict sender refuses) is terminal — lives here once so no transport drifts.
 */
export function classifyWebhookStatus(status: number): "success" | "retryable" | "terminal" {
  if (status >= 200 && status < 300) return "success";
  if (status >= 500 || status === 429 || status === 408) return "retryable";
  return "terminal";
}

/** Whether a receiver's answer is a delivery, or why it is not and whether to try again. */
type WebhookDeliveryVerdict =
  | { delivered: true }
  | {
      delivered: false;
      message: string;
      /** Fixed copy naming the status, safe to show the author. */
      customerMessage: string;
      retryable: boolean;
      /** The receiver's back-off on a retryable answer; the queue folds it in as a floor. */
      retryAfterMs: number | undefined;
    };

/** {@link classifyWebhookStatus} with the failure's message and back-off attached. */
export function judgeWebhookDelivery({
  result,
  label,
}: {
  result: Pick<WebhookSendResult, "status" | "body" | "retryAfterMs">;
  /** Who is speaking, e.g. `Webhook for trigger "Name"`. */
  label: string;
}): WebhookDeliveryVerdict {
  const { status } = result;
  const verdict = classifyWebhookStatus(status);
  if (verdict === "success") return { delivered: true };
  const snippet = result.body.slice(0, ERROR_SNIPPET_CHARS).trim();
  const retryable = verdict === "retryable";
  return {
    delivered: false,
    message: `${label} received HTTP ${status}` + (snippet ? `: ${snippet}` : ""),
    customerMessage: `The endpoint answered HTTP ${status}.`,
    retryable,
    retryAfterMs: retryable ? result.retryAfterMs : undefined,
  };
}
