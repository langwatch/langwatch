/** @see specs/self-hosting/connected-services/connected-billing.feature */
import { createApiFixture } from "@langwatch/api-fixture";
import type { LicenseSeatChange, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryConnectedInvoicingChannel } from "../../channels/memory/memory.connected-invoicing.channel.ts";
import type { ConnectedBillingAccountRecord } from "../../repositories/connected-billing.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryConnectedBillingRepository } from "../../repositories/memory/memory.connected-billing.repository.ts";
import { ConnectedSeatChangeService } from "../connected-seat-change.service.ts";

const at = (iso: string): Instant => Temporal.Instant.from(iso);
const CHANGED_AT = "2026-07-04T10:00:00Z";

const account = (patch: Partial<ConnectedBillingAccountRecord> = {}) =>
  ({
    id: "acct-1",
    organizationId: "org-1",
    stripeCustomerId: "cus_1",
    usageSubscriptionId: "sub_1",
    usageSubscriptionItemId: "si_1",
    termStartsAt: at("2026-01-02T10:00:00Z"),
    termEndsAt: at("2027-01-02T10:00:00Z"),
    commitUsdCents: 1_000_000,
    seatCurrency: "USD",
    seatRateCents: 60_000,
    seats: 50,
    bankTransferType: null,
    bankTransferCountry: null,
    billingEmail: "finance@customer.example",
    pendingRenewal: null,
    ...patch,
  }) satisfies ConnectedBillingAccountRecord;

const addEightSeats: LicenseSeatChange = {
  licenseRowId: "lic-2",
  organizationId: "org-1",
  previousSeats: 50,
  seats: 58,
  changedAt: CHANGED_AT,
};

function harness({
  accounts = [account()],
  changes = [addEightSeats],
}: {
  accounts?: ConnectedBillingAccountRecord[];
  changes?: LicenseSeatChange[];
} = {}) {
  const store = MemoryBillingStore.create();
  for (const onboarded of accounts) {
    store.connectedBillingAccounts.set(onboarded.organizationId, onboarded);
  }
  const repository = MemoryConnectedBillingRepository.create(store);
  const invoicing = MemoryConnectedInvoicingChannel.create();
  const recorded = [...changes];
  const service = ConnectedSeatChangeService.create({
    repository,
    invoicing,
    licensing: createApiFixture<Pick<LicensingApi, "findSeatChanges">>({
      findSeatChanges: async () => recorded,
    }),
  });

  return { store, repository, invoicing, recorded, service };
}

describe("invoicing the seat changes licensing recorded", () => {
  describe("given a customer onboarded for billing", () => {
    /** @scenario "Seats added mid-term are invoiced prorated to the end of the term" */
    it("charges the added seats for the rest of the term, per seat then multiplied", async () => {
      const { invoicing, service } = harness();

      await expect(service.invoicePendingSeatChanges()).resolves.toEqual({
        decided: 1,
        invoiced: 1,
        failed: 0,
      });
      expect(invoicing.raised[0]?.lines[0]).toMatchObject({
        quantity: 8,
        unitAmountCents: 29_918,
        amountCents: 239_344,
      });
    });

    /** @scenario "The seat invoice is its own invoice in the currency of the seat contract" */
    it("raises the invoice in the currency of the seat contract", async () => {
      const { invoicing, service } = harness({ accounts: [account({ seatCurrency: "EUR" })] });

      await service.invoicePendingSeatChanges();

      expect(invoicing.raised[0]?.currency).toBe("EUR");
      expect(invoicing.raised[0]?.customerId).toBe("cus_1");
    });

    it("records the invoice it raised against the account", async () => {
      const { store, service } = harness();

      await service.invoicePendingSeatChanges();

      expect([...store.connectedInvoices.values()][0]).toMatchObject({
        accountId: "acct-1",
        kind: "seat_change",
        amountCents: 239_344,
        paidOutOfBandAt: null,
      });
      expect(store.connectedSeatChanges.get("lic-2")).toMatchObject({
        state: "invoiced",
        organizationId: "org-1",
      });
    });

    it("carries the customer's bank transfer onto the invoice", async () => {
      const { invoicing, service } = harness({
        accounts: [account({ bankTransferType: "eu_bank_transfer", bankTransferCountry: "NL" })],
      });

      await service.invoicePendingSeatChanges();

      expect(invoicing.raised[0]?.bankTransfer).toEqual({
        type: "eu_bank_transfer",
        country: "NL",
      });
    });

    /** @scenario "Changing the seats twice for one reissued license invoices once" */
    it("names the license, so a second pass raises nothing more", async () => {
      const { invoicing, service } = harness();

      await service.invoicePendingSeatChanges();
      await expect(service.invoicePendingSeatChanges()).resolves.toEqual({
        decided: 0,
        invoiced: 0,
        failed: 0,
      });

      expect(invoicing.raised).toHaveLength(1);
      expect(invoicing.raised[0]?.metadata).toMatchObject({
        kind: "seat_change",
        license_row_id: "lic-2",
        organization_id: "org-1",
      });
    });

    it("charges nothing when the term has already ended", async () => {
      const { invoicing, store, service } = harness({
        accounts: [account({ termEndsAt: at("2026-06-01T10:00:00Z") })],
      });

      await service.invoicePendingSeatChanges();

      expect(store.connectedSeatChanges.get("lic-2")?.state).toBe("nothing_to_invoice");
      expect(invoicing.raised).toEqual([]);
    });

    /** @scenario "A seat change recorded while billing was down is invoiced from when it happened" */
    it("prorates from when the seats changed, not from when the pass ran", async () => {
      const { invoicing, service } = harness({
        changes: [{ ...addEightSeats, changedAt: "2026-12-31T10:00:00Z" }],
      });

      await service.invoicePendingSeatChanges();

      expect(invoicing.raised[0]?.lines[0]?.unitAmountCents).toBe(329);
    });
  });

  describe("given a customer never onboarded for billing", () => {
    /** @scenario "A customer with no billing account gets no seat invoice from LangWatch" */
    it("stores not onboarded, and a later onboarding never bills the change", async () => {
      const { invoicing, store, service } = harness({ accounts: [] });

      await service.invoicePendingSeatChanges();
      store.connectedBillingAccounts.set("org-1", account());
      await service.invoicePendingSeatChanges();

      expect(store.connectedSeatChanges.get("lic-2")).toMatchObject({
        state: "not_onboarded",
        accountId: null,
        currency: null,
        addedSeats: 8,
      });
      expect(invoicing.raised).toEqual([]);
    });
  });

  describe("when the payment provider is down", () => {
    /** @scenario "A seat invoice that failed at the payment provider is retried without doubling" */
    it("keeps the intent and invoices it once on the next pass", async () => {
      const { invoicing, store, service } = harness();
      vi.spyOn(invoicing, "createOneOffInvoice").mockRejectedValueOnce(new Error("provider down"));

      await expect(service.invoicePendingSeatChanges()).resolves.toEqual({
        decided: 1,
        invoiced: 0,
        failed: 1,
      });
      expect(store.connectedSeatChanges.get("lic-2")?.state).toBe("intent");

      await expect(service.invoicePendingSeatChanges()).resolves.toMatchObject({ invoiced: 1 });
      await service.invoicePendingSeatChanges();
      expect(invoicing.raised).toHaveLength(1);
      expect(store.connectedSeatChanges.get("lic-2")?.state).toBe("invoiced");
    });
  });

  describe("given an earlier attempt raised the invoice and never recorded it", () => {
    /** @scenario "A seat invoice raised but never recorded is found rather than raised again" */
    it("records the invoice the provider already holds instead of raising another", async () => {
      const { invoicing, store, repository, service } = harness({ changes: [] });
      const earlier = await invoicing.createOneOffInvoice({
        customerId: "cus_1",
        currency: "USD",
        lines: [{ description: "8 seats", amountCents: 239_344 }],
        bankTransfer: null,
        metadata: { organization_id: "org-1", kind: "seat_change", license_row_id: "lic-2" },
      });
      await repository.createSeatChange({
        licenseRowId: "lic-2",
        accountId: "acct-1",
        organizationId: "org-1",
        changedAt: at(CHANGED_AT),
        addedSeats: 8,
        unitAmountCents: 29_918,
        amountCents: 239_344,
        currency: "USD",
        state: "intent",
        stripeInvoiceId: null,
      });
      const raise = vi.spyOn(invoicing, "createOneOffInvoice");

      await service.invoicePendingSeatChanges();

      expect(raise).not.toHaveBeenCalled();
      expect(store.connectedSeatChanges.get("lic-2")).toMatchObject({
        state: "invoiced",
        stripeInvoiceId: earlier.id,
      });
    });
  });

  describe("when one change cannot be decided", () => {
    /** @scenario "A seat change billing cannot decide is retried on the next pass" */
    it("decides the others and retries it on the next pass", async () => {
      const { repository, store, service } = harness({
        changes: [addEightSeats, { ...addEightSeats, licenseRowId: "lic-3" }],
      });
      vi.spyOn(repository, "findAccount").mockRejectedValueOnce(new Error("database down"));

      await expect(service.invoicePendingSeatChanges()).resolves.toMatchObject({
        decided: 1,
        failed: 1,
      });
      await service.invoicePendingSeatChanges();

      expect(store.connectedSeatChanges.get("lic-2")?.state).toBe("invoiced");
      expect(store.connectedSeatChanges.get("lic-3")?.state).toBe("invoiced");
    });
  });
});
