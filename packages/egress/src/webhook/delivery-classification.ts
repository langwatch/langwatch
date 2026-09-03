import { DispatchError } from "@langwatch/eventing";

/**
 * What a receiver's answer means, and the headers a delivery is identified by.
 *
 * FROZEN TWIN of the classification half of
 * `platform/app/src/server/webhooks/sendWebhook.ts`. Both header names are wire
 * format: a receiver keys idempotency off one of them, and a rename is invisible
 * until every consumer starts processing retries twice.
 */

/**
 * The automations channel's published dispatch-identity header. One dispatch
 * there IS one event (an automation fired), so the name is accurate and its
 * consumers key idempotency off it.
 */
export const WEBHOOK_EVENT_ID_HEADER = "X-LangWatch-Event-Id";

/**
 * The webhook platform's dispatch-identity header.
 *
 * A platform delivery carries a BATCH of envelopes, each with its own `id`, so
 * calling the batch identity an event id is a lie a consumer can act on: it
 * reads like the thing to dedup by, and deduping by it drops every envelope in
 * the batch but one. Dedup belongs on the envelope `id` inside the body; this
 * header only groups the retries of one POST.
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
 * The retry-vs-terminal classification, as a value rather than a throw.
 *
 * 2xx is success; 5xx / 429 / 408 are retryable (the outbox backs off and
 * re-attempts); any other status — including 3xx, which the strict sender
 * refuses to follow — is terminal, because retrying a misconfigured endpoint
 * just spams it.
 *
 * The rule lives here once, and both the throwing assertion below and every
 * transport read it, so a transport can never drift from the classification by
 * restating it.
 */
export function classifyWebhookStatus(status: number): "success" | "retryable" | "terminal" {
  if (status >= 200 && status < 300) return "success";
  if (status >= 500 || status === 429 || status === 408) return "retryable";
  return "terminal";
}

/**
 * The throwing form of {@link classifyWebhookStatus}, for callers that want a
 * classified DispatchError rather than a verdict.
 */
export function assertWebhookDelivered({
  result,
  triggerName,
}: {
  result: Pick<WebhookSendResult, "status" | "body" | "retryAfterMs">;
  triggerName: string;
}): void {
  const { status } = result;
  const verdict = classifyWebhookStatus(status);
  if (verdict === "success") return;
  const snippet = result.body.slice(0, ERROR_SNIPPET_CHARS).trim();
  const retryable = verdict === "retryable";
  throw new DispatchError({
    message:
      `Webhook for trigger "${triggerName}" received HTTP ${status}` +
      (snippet ? `: ${snippet}` : ""),
    retryable,
    // Honour the receiver's backpressure on a retryable status; the queue folds
    // it into its backoff as a floor.
    retryAfterMs: retryable ? result.retryAfterMs : undefined,
  });
}
