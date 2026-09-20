/**
 * The database and payment provider bindings of the quarterly seat true-up.
 *
 * Boundaries mocked: Prisma and Stripe. What is asserted is the shape of the
 * calls, because that is what decides whether a credit can reach the invoice
 * and whether a retry creates a second one.
 *
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */

import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  PrismaSeatTrueUpStore,
  StripeSeatTrueUpInvoicer,
} from "../seatTrueUp.prisma";

const QUARTER = new Date("2027-01-01T00:00:00.000Z");

function makeStore(overrides: Record<string, unknown> = {}) {
  const prisma = {
    issuedLicense: { findMany: vi.fn(async () => []) },
    connectedBillingAccount: { findUnique: vi.fn(async () => null) },
    licenseSeatReport: { findUnique: vi.fn(async () => null) },
    connectedSeatTrueUp: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => undefined),
    },
    ...overrides,
  };
  return {
    store: new PrismaSeatTrueUpStore(prisma as unknown as PrismaClient),
    prisma,
  };
}

function makeInvoicer() {
  const stripe = {
    invoiceItems: {
      create: vi.fn(async (..._args: unknown[]) => ({ id: "ii_1" })),
    },
    invoices: {
      create: vi.fn(async (..._args: unknown[]) => ({ id: "in_draft" })),
      finalizeInvoice: vi.fn(async (..._args: unknown[]) => ({
        id: "in_1",
        status: "open",
      })),
    },
  };
  const prisma = { connectedInvoice: { upsert: vi.fn(async () => undefined) } };
  return {
    invoicer: new StripeSeatTrueUpInvoicer({
      stripe: stripe as unknown as Stripe,
      prisma: prisma as unknown as PrismaClient,
    }),
    stripe,
    prisma,
  };
}

const invoiceInput = {
  accountId: "cba-1",
  quarterStartsAt: QUARTER,
  stripeCustomerId: "cus_acme",
  bankTransfer: null,
  currency: "USD" as const,
  unitAmountCents: 30_082,
  addedSeats: 8,
  amountCents: 240_656,
  description: "8 seats added",
  idempotencyKey: "connected-seat-true-up:lic-1:2027-01-01T00:00:00.000Z",
};

describe("PrismaSeatTrueUpStore", () => {
  describe("listLicenses", () => {
    it("fills in the default seat allowance when the license names none", async () => {
      const { store } = makeStore({
        issuedLicense: {
          findMany: vi.fn(async () => [
            {
              id: "lic-1",
              organizationId: "org-acme",
              issuedAt: QUARTER,
              maxMembers: 50,
              seatOverageAllowance: null,
              lastSyncAt: null,
            },
          ]),
        },
      });

      const licenses = await store.listLicenses();

      expect(licenses).toHaveLength(1);
      expect(licenses[0]!.seatOverageAllowance).toBe(10);
    });

    it("drops a license that names no customer", async () => {
      const { store } = makeStore({
        issuedLicense: {
          findMany: vi.fn(async () => [
            {
              id: "lic-2",
              organizationId: null,
              issuedAt: QUARTER,
              maxMembers: 50,
              seatOverageAllowance: 5,
              lastSyncAt: null,
            },
          ]),
        },
      });

      expect(await store.listLicenses()).toEqual([]);
    });
  });

  describe("findAccount", () => {
    it("reads the bank transfer the customer pays through", async () => {
      const { store } = makeStore({
        connectedBillingAccount: {
          findUnique: vi.fn(async () => ({
            id: "cba-1",
            stripeCustomerId: "cus_acme",
            seatCurrency: "EUR",
            seatRateCents: 60_000,
            seats: 50,
            termStartsAt: QUARTER,
            termEndsAt: QUARTER,
            bankTransferType: "eu_bank_transfer",
            bankTransferCountry: "NL",
          })),
        },
      });

      expect(await store.findAccount("org-acme")).toMatchObject({
        seatCurrency: "EUR",
        bankTransfer: { type: "eu_bank_transfer", country: "NL" },
      });
    });

    it("reads no bank transfer when the customer wires to LangWatch", async () => {
      const { store } = makeStore({
        connectedBillingAccount: {
          findUnique: vi.fn(async () => ({
            id: "cba-1",
            stripeCustomerId: "cus_acme",
            seatCurrency: "USD",
            seatRateCents: 60_000,
            seats: 50,
            termStartsAt: QUARTER,
            termEndsAt: QUARTER,
            bankTransferType: null,
            bankTransferCountry: null,
          })),
        },
      });

      expect(await store.findAccount("org-acme")).toMatchObject({
        bankTransfer: null,
      });
    });

    it("answers null for an organization that was never onboarded", async () => {
      const { store } = makeStore();

      expect(await store.findAccount("org-acme")).toBeNull();
    });
  });

  describe("record", () => {
    /** @scenario "Running the true-up twice for one quarter invoices once" */
    it("writes one row per license quarter, whatever the state it passes through", async () => {
      const { store, prisma } = makeStore();

      await store.record({
        licenseId: "lic-1",
        quarterStartsAt: QUARTER,
        peakSeats: 58,
        addedSeats: 8,
        amountCents: 240_656,
        currency: "USD",
        state: "intent",
        stripeInvoiceId: null,
      });

      expect(prisma.connectedSeatTrueUp.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            licenseId_quarterStartsAt: {
              licenseId: "lic-1",
              quarterStartsAt: QUARTER,
            },
          },
        }),
      );
    });
  });
});

describe("StripeSeatTrueUpInvoicer", () => {
  /** @scenario "Seat invoices are never paid from the usage commit" */
  it("creates a one-off invoice that names no subscription", async () => {
    const { invoicer, stripe } = makeInvoicer();

    await invoicer.invoiceAddedSeats(invoiceInput);

    const item = stripe.invoiceItems.create.mock.calls[0]![0];
    const invoice = stripe.invoices.create.mock.calls[0]![0];
    expect(item).not.toHaveProperty("subscription");
    expect(invoice).not.toHaveProperty("subscription");
    expect(invoice).toMatchObject({
      collection_method: "send_invoice",
      days_until_due: 30,
      currency: "usd",
    });
  });

  /** @scenario "Seats added during a quarter are invoiced prorated to the end of the term" */
  it("puts the seats on the line as a quantity at a unit amount", async () => {
    const { invoicer, stripe } = makeInvoicer();

    await invoicer.invoiceAddedSeats(invoiceInput);

    expect(stripe.invoiceItems.create.mock.calls[0]![0]).toMatchObject({
      quantity: 8,
      unit_amount: 30_082,
      customer: "cus_acme",
    });
  });

  /** @scenario "A true-up that failed at the payment provider is retried without doubling" */
  it("passes an idempotency key on every call it makes", async () => {
    const { invoicer, stripe } = makeInvoicer();

    await invoicer.invoiceAddedSeats(invoiceInput);

    expect(stripe.invoiceItems.create.mock.calls[0]![1]).toEqual({
      idempotencyKey: `${invoiceInput.idempotencyKey}:item`,
    });
    expect(stripe.invoices.create.mock.calls[0]![1]).toEqual({
      idempotencyKey: `${invoiceInput.idempotencyKey}:invoice`,
    });
    expect(stripe.invoices.finalizeInvoice.mock.calls[0]![2]).toEqual({
      idempotencyKey: `${invoiceInput.idempotencyKey}:finalize`,
    });
  });

  /** @scenario "The seat true-up is its own invoice in the currency of the seat contract" */
  it("records the invoice as a seat true-up of its quarter", async () => {
    const { invoicer, prisma } = makeInvoicer();

    const result = await invoicer.invoiceAddedSeats({
      ...invoiceInput,
      currency: "EUR",
    });

    expect(result).toEqual({ invoiceId: "in_1" });
    expect(prisma.connectedInvoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeInvoiceId: "in_1" },
        create: {
          accountId: "cba-1",
          stripeInvoiceId: "in_1",
          kind: "seat_trueup",
          currency: "EUR",
          amountCents: 240_656,
          status: "open",
          quarterStartsAt: QUARTER,
        },
      }),
    );
  });

  it("offers bank transfer when the customer pays into a virtual account", async () => {
    const { invoicer, stripe } = makeInvoicer();

    await invoicer.invoiceAddedSeats({
      ...invoiceInput,
      bankTransfer: { type: "eu_bank_transfer", country: "NL" },
    });

    expect(stripe.invoices.create.mock.calls[0]![0]).toMatchObject({
      payment_settings: {
        payment_method_types: ["customer_balance"],
        payment_method_options: {
          customer_balance: {
            funding_type: "bank_transfer",
            bank_transfer: {
              type: "eu_bank_transfer",
              eu_bank_transfer: { country: "NL" },
            },
          },
        },
      },
    });
  });
});
