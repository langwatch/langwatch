import { randomUUID } from "node:crypto";
import {
  sanitizeWebhookHeaders,
  WEBHOOK_HEADER_VALUE_KEPT,
  type WebhookMethod,
} from "@langwatch/automation-contract";
import type { EgressTlsPolicy } from "../ssrf/fenced-fetch";
import type { WebhookDispatchRateLimiterPort } from "../ports/webhook-dispatch-rate-limiter.port";
import {
  WEBHOOK_DELIVERY_ATTEMPT_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_TEST_FIRE_HEADER,
  type WebhookSendResult,
} from "../webhook/delivery-classification";
import { assertDispatchBudget } from "../webhook/dispatch-budget";
import { sendHttpDestination } from "../webhook/http-destination";
import { signWebhookPayload, WEBHOOK_SIGNATURE_HEADER } from "../webhook/signature";
import { assertWebhookUrlAllowed, webhookUrlValidator } from "../webhook/url-policy";

/**
 * The outbound webhook sender both webhook channels run on: the automations
 * channel (one automation fire, Liquid-rendered body) and the webhook endpoints
 * platform (a batch envelope, org-scoped). Everything about the wire is decided
 * here for both — the address fence, the timeout, redirect refusal, Retry-After
 * parsing, the signature, and the dispatch-identity header, whose NAME is the
 * single parameter the two channels differ on.
 *
 * FROZEN TWIN of `platform/app/src/server/webhooks/sendWebhook.ts`. The
 * application keeps its copy while both graphs send; a difference between them
 * is a customer whose endpoint receives two different envelopes depending on
 * which process fired.
 *
 * WHAT DID NOT COME ACROSS AS A MODULE-LEVEL READ: the application's sender
 * reaches for its app's Redis (the dispatch cap) and its environment (the TLS
 * policy) from module scope. Here both are composed in once, because a package
 * that reached for either would only work inside the one process that had them.
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
   * Which header carries {@link eventId}. Defaults to the automations channel's
   * published `X-LangWatch-Event-Id`; the webhook platform passes
   * `X-LangWatch-Delivery-Id` because one of its dispatches carries many
   * envelopes.
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
    private readonly rateLimiter: WebhookDispatchRateLimiterPort,
    private readonly tls: EgressTlsPolicy,
    private readonly now: () => number,
  ) {}

  static create(options: {
    /** Where the hourly dispatch cap is counted. */
    rateLimiter: WebhookDispatchRateLimiterPort;
    /** Whether this deployment verifies TLS certificates. */
    tls: EgressTlsPolicy;
    /** Injected only so the signature timestamp is assertable; defaults to the wall clock. */
    now?: () => number;
  }): WebhookEgressService {
    return new WebhookEgressService(
      options.rateLimiter,
      options.tls,
      options.now ?? (() => Date.now()),
    );
  }

  /**
   * Sends one webhook request — the channel where the CUSTOMER supplies the
   * endpoint.
   *
   * The URL is admitted before anything else happens, so a fenced destination
   * costs no connection and no cap. The status is RETURNED for the caller to
   * classify: the drawer's test fire wants the raw status to show the author,
   * dispatch wants the DispatchError.
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
    // A real fire only; test fires ride the drawer's per-user limit. The cap
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
