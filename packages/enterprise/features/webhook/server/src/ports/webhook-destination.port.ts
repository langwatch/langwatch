import type { WebhookDestinationKind } from "@langwatch/enterprise-webhook-contract";

/**
 * A webhook endpoint's last hop. Everything above this line is one machinery no matter where an
 * endpoint delivers: the same coalescing buffer, the same Stripe retry ladder, the same
 * delivery log, the same signature over the same bytes.
 */

/**
 * What one delivery attempt amounted to. - `success`: the receiver has it. Clears the
 * endpoint's failure streak. - `retryable`: try again along the ladder.
 */
export type WebhookDispatchVerdict = "success" | "retryable" | "terminal";

export interface WebhookDispatchResult {
  verdict: WebhookDispatchVerdict;
  /** The receiver's HTTP status, or null for a transport that has none. A
   *  queue answers null, which is what the delivery log stores. */
  status: number | null;
  /** What the transport got back, already size-capped: a response snippet
   *  for HTTP, the queue's message id for a queue. */
  body: string;
  /** Response headers worth keeping for debugging. HTTP only. */
  responseHeaders?: Record<string, string>;
  /** How long the receiver asked us to wait, when it asked. Folded into the
   *  ladder's backoff as a floor. */
  retryAfterMs?: number;
  /** The dispatch identity actually sent, for the delivery log. */
  dispatchId: string;
  /** The failure, in the words the delivery log will show. Absent on
   *  success. */
  error?: string;
}

/** One batch, frozen, ready for whichever transport the endpoint named. */
export interface WebhookDispatchRequest {
  /** The endpoint's owner, and the scope its dispatch cap buckets by. */
  organizationId: string;
  endpointId: string;
  /** The EXACT bytes to deliver. Both transports send these unchanged, which
   *  is what makes one signature verifier work for both. */
  body: string;
  /** Stable across every retry of this batch: the delivery id. */
  batchId: string;
  /** 1-based attempt number. */
  attempt: number;
  /** Signing secrets, newest first. */
  signingSecrets: readonly string[];
  /** A drawer or CLI test rather than a real delivery. Marked
   *  non-suppressibly on the wire (ADR-040 §1) and exempt from the hourly
   *  dispatch cap, which it rides the caller's own per-user limit instead
   *  of. */
  isTestFire?: boolean;
}

export abstract class WebhookDestinationPort {
  abstract readonly kind: WebhookDestinationKind;
  /**
   * Deliver one batch and say what happened. Returns a classified verdict for anything the
   * receiving side answered.
   */
  abstract send(request: WebhookDispatchRequest): Promise<WebhookDispatchResult>;
}
