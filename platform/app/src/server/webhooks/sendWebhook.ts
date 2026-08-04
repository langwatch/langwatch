import { randomUUID } from "node:crypto";
import {
  sanitizeWebhookHeaders,
  WEBHOOK_HEADER_VALUE_KEPT,
  type WebhookMethod,
} from "@langwatch/automations/providers/webhook";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { rateLimit } from "~/server/rateLimit";
import { sendHttpDestination } from "./httpDestination";
import { signWebhookPayload, WEBHOOK_SIGNATURE_HEADER } from "./signature";
import { assertWebhookUrlAllowed, webhookUrlValidator } from "./urlPolicy";

/**
 * The outbound webhook sender both webhook channels run on: the automations
 * channel (one trigger fire, Liquid-rendered body) and the webhook endpoints
 * platform (a batch envelope, org-scoped). Everything about the wire is
 * decided here for both — the SSRF fence, the timeout, redirect refusal,
 * Retry-After parsing, the signature, and the dispatch-identity header, whose
 * NAME is the single parameter the two channels differ on.
 */

/**
 * The outbound header set: the customer's static headers, sanitized again here
 * as defense in depth over the save-time sanitize, plus the LangWatch envelope
 * (event id, optional signature, delivery attempt, test-fire marker).
 */
/**
 * The automations channel's published dispatch-identity header. One dispatch
 * there IS one event (a trigger fired), so the name is accurate and its
 * consumers key idempotency off it (ADR-040 §5).
 */
export const WEBHOOK_EVENT_ID_HEADER = "X-LangWatch-Event-Id";

/**
 * The webhook platform's dispatch-identity header.
 *
 * A platform delivery carries a BATCH of envelopes, each with its own `id`,
 * so calling the batch identity an event id is a lie a consumer can act on:
 * it reads like the thing to dedup by, and deduping by it drops every
 * envelope in the batch but one. Dedup belongs on the envelope `id` inside
 * the body; this header only groups the retries of one POST.
 */
export const WEBHOOK_DELIVERY_ID_HEADER = "X-LangWatch-Delivery-Id";

function buildWebhookHeaders({
  headers,
  body,
  eventId,
  dispatchIdHeader,
  signingSecrets,
  attempt,
  testFire,
}: {
  headers: Record<string, string>;
  body: string;
  eventId: string;
  dispatchIdHeader: string;
  signingSecrets?: readonly string[];
  attempt?: number;
  testFire: boolean;
}): Record<string, string> {
  // An unresolved kept sentinel means "the saved value" and should have been
  // resolved by the caller (save / test-fire / decrypt-at-dispatch); never
  // send the literal marker to the customer's endpoint.
  const resolvedHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      ([, value]) => value !== WEBHOOK_HEADER_VALUE_KEPT,
    ),
  );
  return {
    ...sanitizeWebhookHeaders(resolvedHeaders),
    "Content-Type": "application/json",
    [dispatchIdHeader]: eventId,
    ...(signingSecrets && signingSecrets.length > 0
      ? {
          [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload({
            secrets: signingSecrets,
            body,
            timestampSeconds: Math.floor(Date.now() / 1000),
          }),
        }
      : {}),
    ...(attempt !== undefined
      ? { "X-LangWatch-Delivery-Attempt": String(attempt) }
      : {}),
    ...(testFire ? { "X-LangWatch-Test-Fire": "true" } : {}),
  };
}

/**
 * Per-project hourly cap on real webhook dispatches (ADR-040 §4) — a backstop
 * against an immediate-cadence trigger firing per-match turning our worker
 * fleet into an outbound flood. A safety limit, not a billing knob; promote to
 * an env var if a customer legitimately needs a higher ceiling.
 */
export const WEBHOOK_DISPATCH_HOURLY_CAP = 1000;

export interface WebhookSendInput {
  url: string;
  method?: WebhookMethod;
  /** Customer-configured static headers; reserved keys are stripped here
   *  again (defense in depth over the save-time sanitize). */
  headers?: Record<string, string>;
  /** The rendered JSON body. */
  body: string;
  /** Woven into DispatchError messages and delivery logs. */
  triggerName: string;
  /** Overrides the default `Webhook for trigger "<name>"` phrasing for
   *  callers that are not triggers (e.g. webhook-platform endpoints). */
  contextLabel?: string;
  /** Marks the request as a drawer test fire via a non-suppressible
   *  X-LangWatch-Test-Fire header (ADR-040 §1). Test fires skip the
   *  per-project dispatch cap (they carry the drawer's per-user limit). */
  testFire?: boolean;
  /** The firing project — enables the per-project dispatch rate limit
   *  (ADR-040 §4). Omitted for a test fire. */
  projectId?: string;
  /** Stable per-dispatch identity (ADR-040 §5): every retry of the same
   *  logical fire reuses it. A fresh UUID is generated when absent (e.g. a
   *  test fire). */
  eventId?: string;
  /** Which header carries {@link eventId}. Defaults to the automations
   *  channel's published {@link WEBHOOK_EVENT_ID_HEADER}; the webhook
   *  platform passes {@link WEBHOOK_DELIVERY_ID_HEADER} because one of its
   *  dispatches carries many envelopes. */
  dispatchIdHeader?: string;
  /** Per-destination signing secrets, newest first. When present the request
   *  carries `X-LangWatch-Signature: t=<unix>,v1=<hmac>` with one `v1` per
   *  secret, so a rotation window verifies under either. This is the signing
   *  ADR-040 specified; any channel that stores a secret inherits it. */
  signingSecrets?: readonly string[];
  /** 1-based delivery attempt, sent as `X-LangWatch-Delivery-Attempt` so
   *  receivers can distinguish first delivery from ladder retries. */
  attempt?: number;
  /** Relax the private/loopback block for this send. Only the webhook
   *  endpoints platform passes this, and only when the operator set
   *  WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS=1 (local dev / internal receivers). */
  allowInsecureLocal?: boolean;
}

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

/**
 * Sends one webhook automation request (ADR-040) — the notify channel where
 * the CUSTOMER supplies the endpoint. Delivery goes through the shared
 * SSRF-fenced HTTP utility with the strict webhook validator; redirects are
 * not followed (see `HttpDestinationRequest.validateUrl`). The status is
 * returned for the caller to classify via {@link assertWebhookDelivered} —
 * the drawer's test fire wants the raw status to show the author, dispatch
 * wants the DispatchError.
 */
export async function sendWebhook({
  url,
  method = "POST",
  headers = {},
  body,
  triggerName,
  testFire = false,
  projectId,
  eventId,
  dispatchIdHeader = WEBHOOK_EVENT_ID_HEADER,
  signingSecrets,
  attempt,
  contextLabel,
  allowInsecureLocal = false,
}: WebhookSendInput): Promise<WebhookSendResult> {
  const label = contextLabel ?? `Webhook for trigger "${triggerName}"`;
  assertWebhookUrlAllowed({ url, label, allowInsecureLocal });
  // Per-project dispatch cap (ADR-040 §4) — a real fire only; test fires ride
  // the drawer's per-user limit. Over the cap throws RETRYABLE with a
  // Retry-After to the window reset: a legitimate burst backs off and drains,
  // a sustained flood dead-letters after the outbox's max attempts.
  if (projectId && !testFire) {
    const limit = await rateLimit({
      key: `webhook-dispatch:${projectId}`,
      windowSeconds: 3600,
      max: WEBHOOK_DISPATCH_HOURLY_CAP,
    });
    if (!limit.allowed) {
      throw new DispatchError({
        message: `${label}: project webhook dispatch cap (${WEBHOOK_DISPATCH_HOURLY_CAP}/hour) reached — backing off.`,
        retryable: true,
        retryAfterMs: Math.max(0, limit.resetAt - Date.now()),
      });
    }
  }
  // Stable across retries when the caller supplies it (dispatch); a fresh id
  // for a test fire, which has no retries to dedupe.
  const resolvedEventId = eventId ?? randomUUID();
  const response = await sendHttpDestination({
    url,
    method,
    headers: buildWebhookHeaders({
      headers,
      body,
      eventId: resolvedEventId,
      dispatchIdHeader,
      signingSecrets,
      attempt,
      testFire,
    }),
    body,
    contextLabel: label,
    validateUrl: webhookUrlValidator(allowInsecureLocal),
  });
  return { ...response, eventId: resolvedEventId };
}

/** How much of the receiver's response rides in an error message. */
const ERROR_SNIPPET_CHARS = 300;

/**
 * ADR-040 §5 retry-vs-terminal classification. 2xx returns; 5xx / 429 / 408
 * throw retryable (the outbox backs off and re-attempts); any other status —
 * including 3xx, which the strict sender refuses to follow — throws terminal,
 * because retrying a misconfigured endpoint just spams it.
 */
export function assertWebhookDelivered({
  result,
  triggerName,
}: {
  result: Pick<WebhookSendResult, "status" | "body" | "retryAfterMs">;
  triggerName: string;
}): void {
  const { status } = result;
  if (status >= 200 && status < 300) return;
  const snippet = result.body.slice(0, ERROR_SNIPPET_CHARS).trim();
  const retryable = status >= 500 || status === 429 || status === 408;
  throw new DispatchError({
    message:
      `Webhook for trigger "${triggerName}" received HTTP ${status}` +
      (snippet ? `: ${snippet}` : ""),
    retryable,
    // Honor the receiver's backpressure on a retryable status (ADR-040 §5);
    // the queue folds it into its backoff as a floor.
    retryAfterMs: retryable ? result.retryAfterMs : undefined,
  });
}
