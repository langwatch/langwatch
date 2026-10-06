// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import Stripe from "stripe";

import { StripeWebhooksChannel } from "../stripe-webhooks.channel.ts";

/** Verifies a delivery as Stripe signs it; needs no API client, only the signing secret. */
export class HttpStripeWebhooksChannel extends StripeWebhooksChannel {
  private constructor(private readonly secret: string | undefined) {
    super();
  }

  static create(input: { signingSecret: string | undefined }): HttpStripeWebhooksChannel {
    return new HttpStripeWebhooksChannel(input.signingSecret?.trim() || void 0);
  }

  isConfigured(): boolean {
    return this.secret !== void 0;
  }

  constructEvent({ rawBody, signature }: { rawBody: Uint8Array; signature: string }): Stripe.Event {
    if (!this.secret) throw new Error("No Stripe webhook signing secret is configured");
    return Stripe.webhooks.constructEvent(Buffer.from(rawBody), signature, this.secret);
  }
}
