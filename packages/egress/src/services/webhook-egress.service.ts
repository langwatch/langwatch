import { randomUUID } from "node:crypto";

import {
  sanitizeWebhookHeaders,
  WEBHOOK_HEADER_VALUE_KEPT,
  type WebhookMethod,
} from "@langwatch/automation-contract";
import { nowInstant } from "@langwatch/time";

import type { EgressTlsPolicy } from "../ssrf/fenced-fetch.ts";
import {
  WEBHOOK_DELIVERY_ATTEMPT_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_TEST_FIRE_HEADER,
  type WebhookSendResult,
} from "../webhook/delivery-classification.ts";
import { assertDispatchBudget } from "../webhook/dispatch-budget.ts";
import { sendHttpDestination } from "../webhook/http-destination.ts";
import { signWebhookPayload, WEBHOOK_SIGNATURE_HEADER } from "../webhook/signature.ts";
import { assertWebhookUrlAllowed, webhookUrlValidator } from "../webhook/url-policy.ts";
import type { WebhookDispatchRateLimiter } from "./webhook-dispatch-rate-limiter.service.ts";

/**
 * Redis and TLS policy are injected because this package runs in multiple
 * processes.
 */
export interface WebhookSendInput {
  url: string;
  method?: WebhookMethod;
  /**
   * Customer-configured static headers; reserved keys are stripped here again
   * (defence in depth over the save-time sanitize).
   */
  headers?: Record<string, string>;
  /** The rendered JSON body. */
  body: string;
  /** Woven into DispatchError messages and delivery logs. */
  triggerName: string;
  /**
   * Overrides the default `Webhook for trigger "<name>"` phrasing for callers
   * that are not automations (e.g. webhook-platform endpoints).
   */
  contextLabel?: string;
  /**
   * Marks the request as a drawer test fire via a non-suppressible
   * `X-LangWatch-Test-Fire` header. Test fires skip the per-scope dispatch cap;
   * they carry the drawer's per-user limit instead.
   */
  testFire?: boolean;
  /** The firing scope — enables the dispatch rate limit. Omitted for a test fire. */
  projectId?: string;
  /**
   * Stable per-dispatch identity: every retry of the same logical fire reuses
   * it. A fresh UUID is generated when absent (e.g. a test fire).
   */
  eventId?: string;
  /**
   * Header for eventId; webhook endpoints use delivery ID because one dispatch
   * may carry multiple envelopes.
   */
  dispatchIdHeader?: string;
  /**
   * Per-destination signing secrets, newest first. When present the request
   * carries `X-LangWatch-Signature: t=<unix>,v1=<hmac>` with one `v1` per
   * secret, so a rotation window verifies under either.
   */
  signingSecrets?: readonly string[];
  /** 1-based delivery attempt, sent as `X-LangWatch-Delivery-Attempt`. */
  attempt?: number;
  /**
   * Relax the private/loopback block for this send. Only the webhook endpoints
   * platform passes this, and only where the operator opted in.
   */
  allowInsecureLocal?: boolean;
}

/**
 * The outbound header set: the customer's static headers, sanitized again here
 * as defence in depth over the save-time sanitize, plus the LangWatch envelope
 * (event id, optional signature, delivery attempt, test-fire marker).
 */
function buildWebhookHeaders({
  headers,
  body,
  eventId,
  dispatchIdHeader,
  signingSecrets,
  attempt,
  testFire,
  timestampSeconds,
}: {
  headers: Record<string, string>;
  body: string;
  eventId: string;
  dispatchIdHeader: string;
  signingSecrets?: readonly string[];
  attempt?: number;
  testFire: boolean;
  timestampSeconds: number;
}): Record<string, string> {
  // An unresolved kept sentinel means "the saved value" and should have been
  // resolved by the caller (save / test-fire / decrypt-at-dispatch); never send
  // the literal marker to the customer's endpoint.
  const resolvedHeaders = Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== WEBHOOK_HEADER_VALUE_KEPT),
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
            timestampSeconds,
          }),
        }
      : {}),
    ...(attempt !== undefined ? { [WEBHOOK_DELIVERY_ATTEMPT_HEADER]: String(attempt) } : {}),
    ...(testFire ? { [WEBHOOK_TEST_FIRE_HEADER]: "true" } : {}),
  };
}

/**
 * The composed sender: an address fence, a dispatch counter and a TLS answer,
 * bound once per process.
 */
export class WebhookEgressService {
  private constructor(
    private readonly rateLimiter: WebhookDispatchRateLimiter,
    private readonly tls: EgressTlsPolicy,
    private readonly now: () => number,
  ) {}

  static create(options: {
    /** Where the hourly dispatch cap is counted. */
    rateLimiter: WebhookDispatchRateLimiter;
    /** Whether this deployment verifies TLS certificates. */
    tls: EgressTlsPolicy;
    /** Injected only so the signature timestamp is assertable; defaults to the wall clock. */
    now?: () => number;
  }): WebhookEgressService {
    return new WebhookEgressService(
      options.rateLimiter,
      options.tls,
      options.now ?? (() => nowInstant().epochMilliseconds),
    );
  }

  /**
   * Validates customer URLs before connection or rate-limit cost; HTTP status is
   * returned so callers can classify it.
   */
  async send({
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
    // A real fire only; a test fire is counted on its own door instead — the
    // automation drawer's per-user limit, or the tier-effective per-organization
    // `webhookTestPerMinute` window in the webhook app's testFire. The cap
    // lives outside this sender because a queue transport must answer to the
    // same cap without going through it.
    if (projectId && !testFire) {
      await assertDispatchBudget({ rateLimiter: this.rateLimiter, scopeId: projectId, label });
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
        timestampSeconds: Math.floor(this.now() / 1000),
      }),
      body,
      contextLabel: label,
      validateUrl: webhookUrlValidator(allowInsecureLocal),
      tls: this.tls,
    });
    return { ...response, eventId: resolvedEventId };
  }
}
