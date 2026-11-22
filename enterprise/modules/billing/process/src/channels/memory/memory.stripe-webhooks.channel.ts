// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHmac } from "node:crypto";

import type Stripe from "stripe";

import { StripeWebhooksChannel } from "../stripe-webhooks.channel.ts";

/**
 * Stripe's deliveries where no provider is composed. A delivery verifies only
 * when signed over its exact bytes with the secret this twin holds, as Stripe's
 * does; `sign` is how a test signs one.
 */
export class MemoryStripeWebhooksChannel extends StripeWebhooksChannel {
  private constructor(private readonly secret: string | undefined) {
    super();
  }

  static create(input: { signingSecret: string | undefined }): MemoryStripeWebhooksChannel {
    return new MemoryStripeWebhooksChannel(input.signingSecret?.trim() || void 0);
  }

  /** The signature header this twin accepts for `payload` under `secret`. */
  static sign({ payload, secret }: { payload: string | Uint8Array; secret: string }): string {
    return `memory,v1=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  }

  isConfigured(): boolean {
    return this.secret !== void 0;
  }

  constructEvent({ rawBody, signature }: { rawBody: Uint8Array; signature: string }): Stripe.Event {
    if (!this.secret) throw new Error("No Stripe webhook signing secret is configured");
    if (signature !== MemoryStripeWebhooksChannel.sign({ payload: rawBody, secret: this.secret })) {
      throw new Error("No signatures found matching the expected signature for payload");
    }
    return JSON.parse(new TextDecoder().decode(rawBody)) as Stripe.Event;
  }
}
