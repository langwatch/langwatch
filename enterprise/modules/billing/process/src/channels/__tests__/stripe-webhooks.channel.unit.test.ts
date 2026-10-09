// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/stripe-webhook.feature */
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { HttpStripeWebhooksChannel } from "../http/http.stripe-webhooks.channel.ts";
import { MemoryStripeWebhooksChannel } from "../memory/memory.stripe-webhooks.channel.ts";
import type { StripeWebhooksChannel } from "../stripe-webhooks.channel.ts";

const SECRET = "whsec_fixture";
const payload = JSON.stringify({
  id: "evt_1",
  object: "event",
  type: "account.application.deauthorized",
  data: { object: { id: "ca_1", object: "application" } },
});
const rawBody = new TextEncoder().encode(payload);

const MISMATCH = /No signatures found matching the expected signature/;

const tiers: readonly {
  tier: string;
  channel: (signingSecret: string | undefined) => StripeWebhooksChannel;
  sign: (secret: string) => string;
}[] = [
  {
    tier: "the provider",
    channel: (signingSecret) => HttpStripeWebhooksChannel.create({ signingSecret }),
    sign: (secret) => Stripe.webhooks.generateTestHeaderString({ payload, secret }),
  },
  {
    tier: "the memory twin",
    channel: (signingSecret) => MemoryStripeWebhooksChannel.create({ signingSecret }),
    sign: (secret) => MemoryStripeWebhooksChannel.sign({ payload, secret }),
  },
];

describe.each(tiers)("Stripe deliveries over $tier", ({ channel, sign }) => {
  describe("given the channel holds the signing secret", () => {
    /** @scenario "A Stripe delivery verifies alike over the provider and its memory twin" */
    it("answers a delivery signed with that secret with its event", () => {
      const webhooks = channel(SECRET);

      expect(webhooks.isConfigured()).toBe(true);
      expect(webhooks.constructEvent({ rawBody, signature: sign(SECRET) })).toMatchObject({
        id: "evt_1",
        type: "account.application.deauthorized",
      });
    });

    it("refuses a delivery signed with another secret", () => {
      expect(() =>
        channel(SECRET).constructEvent({ rawBody, signature: sign("whsec_other") }),
      ).toThrow(MISMATCH);
    });

    it("refuses a delivery whose bytes changed after signing", () => {
      const tampered = new TextEncoder().encode(payload.replace("evt_1", "evt_2"));

      expect(() =>
        channel(SECRET).constructEvent({ rawBody: tampered, signature: sign(SECRET) }),
      ).toThrow(MISMATCH);
    });
  });

  describe("given no signing secret is held", () => {
    it("reports itself unconfigured and refuses every delivery", () => {
      const webhooks = channel("  ");

      expect(webhooks.isConfigured()).toBe(false);
      expect(() => webhooks.constructEvent({ rawBody, signature: sign(SECRET) })).toThrow(
        "No Stripe webhook signing secret is configured",
      );
    });
  });
});
