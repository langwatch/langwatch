import type { WebhookDestinationKind } from "~/utils/webhookDestinations";

/**
 * A webhook endpoint's last hop.
 *
 * Everything above this line is one machinery no matter where an endpoint
 * delivers: the same coalescing buffer, the same Stripe retry ladder, the
 * same delivery log, the same signature over the same bytes. Only the hop
 * differs, and it differs behind this interface.
 *
 * The interface exists because the recorder used to re-derive the
 * retry-vs-terminal verdict from an HTTP status code, and a queue has no
 * status code. So a transport answers with the verdict ALREADY CLASSIFIED and
 * the recorder trusts it. Each transport owns the rules for its own failures,
 * which is the only place that knowledge exists.
 */

/**
 * What one delivery attempt amounted to.
 *
 * - `success`: the receiver has it. Clears the endpoint's failure streak.
 * - `retryable`: try again along the ladder.
 * - `terminal`: this batch will never be accepted as it stands; retrying
 *   only spams the receiver, so it dead-letters immediately.
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

export interface WebhookDestination {
  readonly kind: WebhookDestinationKind;
  /**
   * Deliver one batch and say what happened.
   *
   * Returns a classified verdict for anything the receiving side answered.
   * Throws `DispatchError` for a transport-level failure with no answer at
   * all (DNS, a blocked address, a timeout), which is what the caller's
   * existing catch records and re-raises.
   */
  send(request: WebhookDispatchRequest): Promise<WebhookDispatchResult>;
}
