/**
 * Invoicing a mid-term seat change: the amount, the idempotency of the
 * intent row, and the seats that are never credited.
 *
 * @see ../seatChange.service.ts
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */

import { describe, expect, it, vi } from "vitest";
import type {
  ConnectedBillingAccountRecord,
  InvoiceRecord,
} from "../connectedBilling.service";
import {
  proratedSeatUnitAmountCents,
  SeatChangeBillingService,
  type SeatChangeInvoicer,
  type SeatChangeRecord,
  type SeatChangeStore,
} from "../seatChange.service";

const ACME = "org_acme";
const TERM_STARTS = new Date("2026-10-01T00:00:00.000Z");
const TERM_ENDS = new Date("2027-10-01T00:00:00.000Z");
/** 183 days into a 365 day term, so 182 remain. */
const NOW = new Date("2027-04-02T00:00:00.000Z");

const ACCOUNT: ConnectedBillingAccountRecord = {
  id: "acct_1",
  organizationId: ACME,
  stripeCustomerId: "cus_acme",
  usageSubscriptionId: "sub_1",
  usageSubscriptionItemId: "si_1",
  termStartsAt: TERM_STARTS,
  termEndsAt: TERM_ENDS,
  commitUsdCents: 100_000,
  seatCurrency: "USD",
  seatRateCents: 60_000,
  seats: 50,
  bankTransferType: null,
  bankTransferCountry: null,
  billingEmail: "finance@acme.test",
  pendingRenewal: null,
};

class InMemoryStore implements SeatChangeStore {
  changes = new Map<string, SeatChangeRecord>();
  invoices: (InvoiceRecord & { accountId: string })[] = [];

  constructor(private readonly account: ConnectedBillingAccountRecord | null) {}

  async findAccount(organizationId: string) {
    return this.account?.organizationId === organizationId
      ? this.account
      : null;
  }
  async findAccountById(accountId: string) {
    return this.account?.id === accountId ? this.account : null;
  }
  async findSeatChange(licenseRowId: string) {
    return this.changes.get(licenseRowId) ?? null;
  }
  async recordSeatChange(record: SeatChangeRecord) {
    this.changes.set(record.licenseRowId, { ...record });
  }
  async listPendingSeatChanges() {
    return [...this.changes.values()].filter((row) => row.state === "intent");
  }
  async addInvoice(accountId: string, invoice: InvoiceRecord) {
    this.invoices.push({ ...invoice, accountId });
  }
}

function fakeInvoicer({ failFirst = false } = {}) {
  let calls = 0;
  const provider: SeatChangeInvoicer = {
    createOneOffInvoice: vi.fn(async ({ currency, lines }) => {
      calls += 1;
      if (failFirst && calls === 1) throw new Error("the provider is down");
      return {
        id: `in_${calls}`,
        status: "open",
        currency,
        amountDueCents: lines.reduce(
          (sum: number, line: { amountCents: number }) =>
            sum + line.amountCents,
          0,
        ),
        subscriptionId: null,
        periodEnd: null,
      };
    }),
  };
  return provider;
}

function build({
  account = ACCOUNT,
  provider = fakeInvoicer(),
}: {
  account?: ConnectedBillingAccountRecord | null;
  provider?: SeatChangeInvoicer;
} = {}) {
  const store = new InMemoryStore(account);
  const service = new SeatChangeBillingService({
    store,
    provider,
    now: () => NOW,
  });
  return { service, store, provider };
}

const change = (seats: number, previousSeats = 50) => ({
  organizationId: ACME,
  licenseRowId: "il_new",
  previousSeats,
  seats,
});

describe("proratedSeatUnitAmountCents", () => {
  /** @scenario Seats added mid-term are invoiced prorated to the end of the term */
  it("rounds the per-seat share of the term to the cent", () => {
    expect(
      proratedSeatUnitAmountCents({
        seatRateCents: 60_000,
        daysRemaining: 183,
        termDays: 365,
      }),
    ).toBe(30_082);
    expect(
      proratedSeatUnitAmountCents({
        seatRateCents: 60_000,
        daysRemaining: 0,
        termDays: 365,
      }),
    ).toBe(0);
  });
});

describe("SeatChangeBillingService", () => {
  describe("given a customer with a billing account", () => {
    describe("when the seats go up mid-term", () => {
      /** @scenario Seats added mid-term are invoiced prorated to the end of the term */
      it("invoices the added seats per seat, times the days that remain", async () => {
        const { service, store, provider } = build();

        const outcome = await service.invoiceAddedSeats(change(58));

        expect(outcome).toBe("invoiced");
        const unit = Math.round((60_000 * 182) / 365);
        expect(provider.createOneOffInvoice).toHaveBeenCalledWith(
          expect.objectContaining({
            customerId: "cus_acme",
            currency: "USD",
            lines: [
              expect.objectContaining({
                quantity: 8,
                unitAmountCents: unit,
                amountCents: unit * 8,
              }),
            ],
            metadata: expect.objectContaining({
              kind: "seat_change",
              license_row_id: "il_new",
            }),
          }),
        );
        expect(store.changes.get("il_new")).toMatchObject({
          state: "invoiced",
          addedSeats: 8,
          amountCents: unit * 8,
          stripeInvoiceId: "in_1",
        });
        expect(store.invoices).toMatchObject([
          { kind: "seat_change", amountCents: unit * 8, currency: "USD" },
        ]);
      });

      /** @scenario Changing the seats twice for one reissued license invoices once */
      it("invoices once when the same change is run again", async () => {
        const { service, provider } = build();

        await service.invoiceAddedSeats(change(58));
        const again = await service.invoiceAddedSeats(change(58));

        expect(again).toBe("invoiced");
        expect(provider.createOneOffInvoice).toHaveBeenCalledTimes(1);
      });

      /** @scenario A seat invoice that failed at the payment provider is retried without doubling */
      it("keeps the intent when the provider fails and completes it on the next tick", async () => {
        const provider = fakeInvoicer({ failFirst: true });
        const { service, store } = build({ provider });

        await expect(service.invoiceAddedSeats(change(58))).rejects.toThrow(
          "the provider is down",
        );
        expect(store.changes.get("il_new")?.state).toBe("intent");

        const summary = await service.completePendingSeatChanges();

        expect(summary).toEqual({ invoiced: 1, failed: 0 });
        expect(store.changes.get("il_new")).toMatchObject({
          state: "invoiced",
          stripeInvoiceId: "in_2",
        });
        expect(provider.createOneOffInvoice).toHaveBeenCalledTimes(2);
      });
    });

    describe("when the seats go down mid-term", () => {
      /** @scenario Seats that went down are not credited back mid-term */
      it("creates no invoice and no credit", async () => {
        const { service, store, provider } = build();

        const outcome = await service.invoiceAddedSeats(change(40));

        expect(outcome).toBe("nothing_to_invoice");
        expect(provider.createOneOffInvoice).not.toHaveBeenCalled();
        expect(store.invoices).toEqual([]);
        expect(store.changes.get("il_new")).toMatchObject({
          state: "nothing_to_invoice",
          addedSeats: 0,
          amountCents: 0,
        });
      });
    });
  });

  describe("given a customer paying for seats in EUR and for usage in USD", () => {
    /** @scenario The seat invoice is its own invoice in the currency of the seat contract */
    it("invoices the added seats in EUR, off the USD usage subscription", async () => {
      const { service, store, provider } = build({
        account: { ...ACCOUNT, seatCurrency: "EUR" },
      });

      await service.invoiceAddedSeats(change(58));

      expect(provider.createOneOffInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "EUR" }),
      );
      const call = vi.mocked(provider.createOneOffInvoice).mock.calls[0]?.[0];
      expect(call).not.toHaveProperty("subscriptionId");
      expect(call).not.toHaveProperty("subscriptionItemId");
      expect(store.invoices).toMatchObject([
        { kind: "seat_change", currency: "EUR" },
      ]);
    });
  });

  describe("given a customer with unspent usage commit", () => {
    /** @scenario Seat invoices are never paid from the usage commit */
    it("owes the seat invoice in full, apart from the commit", async () => {
      const { service, store, provider } = build();

      await service.invoiceAddedSeats(change(58));

      const unit = Math.round((60_000 * 182) / 365);
      // The commit is a credit grant scoped to metered usage prices; a seat
      // line is not metered, so the one-off invoice is due in full.
      expect(provider.createOneOffInvoice).toHaveBeenCalledTimes(1);
      expect(store.invoices).toMatchObject([
        { kind: "seat_change", amountCents: unit * 8, status: "open" },
      ]);
      expect(store.changes.get("il_new")?.amountCents).toBe(unit * 8);
    });
  });

  describe("given a customer with no billing account", () => {
    /** @scenario A customer with no billing account gets no seat invoice from LangWatch */
    it("invoices nothing and says so", async () => {
      const { service, provider } = build({ account: null });

      expect(await service.invoiceAddedSeats(change(58))).toBe("not_onboarded");
      expect(provider.createOneOffInvoice).not.toHaveBeenCalled();
    });
  });
});
