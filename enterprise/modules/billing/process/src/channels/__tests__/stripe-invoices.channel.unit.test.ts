// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/billing.feature */
import { stripeDouble } from "@langwatch/test-harness/client-doubles/stripe";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import type { BillingInvoice } from "../../rules/billing-stripe-shapes.rules.ts";
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

/** An invoice in billing's own shape, as the twin holds it. */
const heldInvoice = (invoice: Stripe.Invoice): BillingInvoice => ({
  id: invoice.id,
  customerId: invoice.customer as string,
  number: null,
  created: invoice.created,
  amountDue: 0,
  currency: "usd",
  status: "paid",
  pdfUrl: null,
  hostedUrl: null,
});

function overTheTwin({ refused }: { refused?: Error } = {}): StripeInvoicesChannel {
  const invoices = MemoryStripeInvoicesChannel.create();
  for (const held of HELD) invoices.seed({ invoice: heldInvoice(held) });
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

type HeldCard = { brand: string; last4: string } | null;

/** One invoice the provider holds, its payment intent carrying the given methods. */
function retrievedOverTheProvider({
  attached,
  failed,
}: {
  attached?: HeldCard | "unexpanded";
  failed?: HeldCard;
}): StripeInvoicesChannel {
  const methodOf = (card: HeldCard | undefined) =>
    card === undefined ? null : { id: "pm_1", object: "payment_method", card };
  const stripe = stripeDouble({
    invoices: {
      retrieve: async (id: string) => ({
        id,
        object: "invoice",
        customer: "cus_1",
        created: 1_700_000_000,
        amount_due: 5000,
        currency: "eur",
        status: "open",
        payment_intent: {
          id: "pi_1",
          object: "payment_intent",
          payment_method: attached === "unexpanded" ? "pm_1" : methodOf(attached),
          last_payment_error:
            failed === undefined ? null : { type: "card_error", payment_method: methodOf(failed) },
        },
      }),
    },
  });
  return HttpStripeInvoicesChannel.create({ stripe });
}

/** The same invoice in the twin, seeded with the card the provider would answer. */
function retrievedOverTheTwin({
  attached,
  failed,
}: {
  attached?: HeldCard | "unexpanded";
  failed?: HeldCard;
}): StripeInvoicesChannel {
  const invoices = MemoryStripeInvoicesChannel.create();
  const picked = attached && attached !== "unexpanded" ? attached : (failed ?? null);
  const names: Record<string, string> = { visa: "Visa", amex: "American Express" };
  invoices.seed({
    invoice: heldInvoice(invoice({ id: "in_1", customer: "cus_1", created: 1 })),
    card: picked ? { brand: names[picked.brand] ?? "card", last4: picked.last4 } : null,
  });
  return invoices;
}

const retrievalTiers = [
  { tier: "the provider", compose: retrievedOverTheProvider },
  { tier: "the memory twin", compose: retrievedOverTheTwin },
];

describe.each(retrievalTiers)("One Stripe invoice's card over $tier", ({ compose }) => {
  it("answers the card attached to the invoice's payment, by its brand's display name", async () => {
    const detail = await compose({
      attached: { brand: "visa", last4: "4242" },
      failed: { brand: "amex", last4: "0005" },
    }).getInvoice({ invoiceId: "in_1" });

    expect(detail.card).toEqual({ brand: "Visa", last4: "4242" });
  });

  it("falls back to the card the last payment error names when none is attached", async () => {
    const detail = await compose({
      attached: "unexpanded",
      failed: { brand: "amex", last4: "0005" },
    }).getInvoice({ invoiceId: "in_1" });

    expect(detail.card).toEqual({ brand: "American Express", last4: "0005" });
  });

  it("names a brand outside the table plainly as a card", async () => {
    const detail = await compose({ attached: { brand: "link", last4: "1111" } }).getInvoice({
      invoiceId: "in_1",
    });

    expect(detail.card).toEqual({ brand: "card", last4: "1111" });
  });

  it("answers no card when the payment names none", async () => {
    const detail = await compose({}).getInvoice({ invoiceId: "in_1" });

    expect(detail.card).toBeNull();
  });
});

describe("Card brands over the provider", () => {
  it.each([
    ["amex", "American Express"],
    ["diners", "Diners Club"],
    ["discover", "Discover"],
    ["jcb", "JCB"],
    ["mastercard", "Mastercard"],
    ["unionpay", "UnionPay"],
    ["visa", "Visa"],
  ])("names %s as %s", async (brand, name) => {
    const detail = await retrievedOverTheProvider({
      attached: { brand, last4: "4242" },
    }).getInvoice({ invoiceId: "in_1" });

    expect(detail.card).toEqual({ brand: name, last4: "4242" });
  });
});

describe("Billing's invoice shape over the provider", () => {
  it("answers an invoice's number, amount due, status and links, and an expanded customer by its id", async () => {
    const stripe = stripeDouble({
      invoices: {
        list: async () => ({
          object: "list",
          has_more: false,
          url: "/v1/invoices",
          data: [
            {
              id: "in_1",
              object: "invoice",
              customer: { id: "cus_1", object: "customer" },
              number: "INV-001",
              created: 1_700_000_000,
              amount_due: 5000,
              currency: "usd",
              status: "paid",
              invoice_pdf: "https://pdf.example.com/in_1",
              hosted_invoice_url: "https://hosted.example.com/in_1",
            },
            {
              id: "in_draft",
              object: "invoice",
              customer: "cus_1",
              number: null,
              created: 1_700_001_000,
              amount_due: 3000,
              currency: "eur",
              status: "draft",
            },
          ],
        }),
      },
    });

    await expect(
      HttpStripeInvoicesChannel.create({ stripe }).listInvoices({ customerId: "cus_1", limit: 4 }),
    ).resolves.toEqual([
      {
        id: "in_1",
        customerId: "cus_1",
        number: "INV-001",
        created: 1_700_000_000,
        amountDue: 5000,
        currency: "usd",
        status: "paid",
        pdfUrl: "https://pdf.example.com/in_1",
        hostedUrl: "https://hosted.example.com/in_1",
      },
      {
        id: "in_draft",
        customerId: "cus_1",
        number: null,
        created: 1_700_001_000,
        amountDue: 3000,
        currency: "eur",
        status: "draft",
        pdfUrl: null,
        hostedUrl: null,
      },
    ]);
  });
});
