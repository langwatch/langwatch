// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/billing.feature */
import { stripeDouble } from "@langwatch/test-harness/client-doubles/stripe";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { HttpStripeInvoicesChannel } from "../http/http.stripe-invoices.channel.ts";
import { MemoryStripeInvoicesChannel } from "../memory/memory.stripe-invoices.channel.ts";
import type { StripeInvoicesChannel } from "../stripe-invoices.channel.ts";

const invoice = ({ id, customer, created }: { id: string; customer: string; created: number }) =>
  ({ id, object: "invoice", customer, created, status: "paid" }) as Stripe.Invoice;

const HELD = [
  invoice({ id: "in_1", customer: "cus_1", created: 1_700_000_100 }),
  invoice({ id: "in_5", customer: "cus_1", created: 1_700_000_500 }),
  invoice({ id: "in_3", customer: "cus_1", created: 1_700_000_300 }),
  invoice({ id: "in_other", customer: "cus_2", created: 1_700_000_900 }),
  invoice({ id: "in_2", customer: "cus_1", created: 1_700_000_200 }),
  invoice({ id: "in_4", customer: "cus_1", created: 1_700_000_400 }),
];

const rateLimited = () =>
  new Stripe.errors.StripeRateLimitError({ type: "rate_limit_error", message: "slow down" });

/** The provider's list endpoint as the SDK answers it: one customer's, newest first. */
function overTheProvider({ refused }: { refused?: Error } = {}): StripeInvoicesChannel {
  const stripe = stripeDouble({
    invoices: {
      list: async (params?: Stripe.InvoiceListParams | Stripe.RequestOptions) => {
        if (refused) throw refused;
        const asked: Stripe.InvoiceListParams = params && "customer" in params ? params : {};
        const data = HELD.filter((held) => held.customer === asked.customer)
          .toSorted((a, b) => b.created - a.created)
          .slice(0, asked.limit);
        return { object: "list", data, has_more: false, url: "/v1/invoices" };
      },
    },
  });
  return HttpStripeInvoicesChannel.create({ stripe });
}

function overTheTwin({ refused }: { refused?: Error } = {}): StripeInvoicesChannel {
  const invoices = MemoryStripeInvoicesChannel.create();
  for (const held of HELD) invoices.seed({ invoice: held });
  if (refused) invoices.refuse({ operation: "listInvoices", error: refused });
  return invoices;
}

const tiers = [
  { tier: "the provider", compose: overTheProvider },
  { tier: "the memory twin", compose: overTheTwin },
];

describe.each(tiers)("Stripe invoices over $tier", ({ compose }) => {
  describe("given five invoices for one customer and one for another", () => {
    /** @scenario "A Stripe customer's invoices list alike over the provider and its memory twin" */
    it("answers that customer's four newest, newest first", async () => {
      const listed = await compose().listInvoices({ customerId: "cus_1", limit: 4 });

      expect(listed.map((held) => held.id)).toEqual(["in_5", "in_4", "in_3", "in_2"]);
    });

    it("answers an empty list for a customer with no invoices", async () => {
      await expect(compose().listInvoices({ customerId: "cus_none", limit: 4 })).resolves.toEqual(
        [],
      );
    });
  });

  describe("when the provider refuses the listing", () => {
    it("passes the provider's own error through", async () => {
      await expect(
        compose({ refused: rateLimited() }).listInvoices({ customerId: "cus_1", limit: 4 }),
      ).rejects.toMatchObject({ type: "StripeRateLimitError" });
    });
  });
});
