// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Stripe's deliveries to the callback, the webhooks subject of billing's Stripe
 * channels (Q69). The signing secret stays behind the channel; only an event
 * whose signature verified over the raw bytes leaves it.
 */

import type Stripe from "stripe";

export abstract class StripeWebhooksChannel {
  /** Whether this deployment holds the secret a delivery's signature is checked against. */
  abstract isConfigured(): boolean;

  /** Throws when the payload or the signature is wrong, or no secret is held. */
  abstract constructEvent(input: { rawBody: Uint8Array; signature: string }): Stripe.Event;
}
