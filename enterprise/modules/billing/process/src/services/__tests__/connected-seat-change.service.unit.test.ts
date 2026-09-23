import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryConnectedInvoicingChannel } from "../../channels/memory/memory.connected-invoicing.channel.ts";
import type { ConnectedBillingAccountRecord } from "../../repositories/connected-billing.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryConnectedBillingRepository } from "../../repositories/memory/memory.connected-billing.repository.ts";
import { ConnectedSeatChangeService } from "../connected-seat-change.service.ts";

const at = (iso: string): Instant => Temporal.Instant.from(iso);
const CHANGED_AT = at("2026-07-04T10:00:00Z");

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

function harness(accounts: ConnectedBillingAccountRecord[] = [account()]) {
  const store = MemoryBillingStore.create();
  for (const account of accounts) {
    store.connectedBillingAccounts.set(account.organizationId, account);
  }
  const repository = MemoryConnectedBillingRepository.create(store);
  const invoicing = MemoryConnectedInvoicingChannel.create();
  const service = ConnectedSeatChangeService.create({
    repository,
    invoicing,
    now: () => CHANGED_AT,
  });

  return { store, repository, invoicing, service };
}

const addEightSeats = {
  organizationId: "org-1",
  licenseRowId: "lic-2",
  previousSeats: 50,
  seats: 58,
};

describe("invoicing a mid-term seat change", () => {
  it("charges the added seats for the rest of the term, per seat then multiplied", async () => {
    const { invoicing, service } = harness();

    await expect(service.invoiceAddedSeats(addEightSeats)).resolves.toBe("invoiced");
    expect(invoicing.raised[0]?.lines[0]).toMatchObject({
      quantity: 8,
      unitAmountCents: 29_918,
      amountCents: 239_344,
    });
  });

  it("raises the invoice in the currency of the seat contract", async () => {
    const { invoicing, service } = harness([account({ seatCurrency: "EUR" })]);

    await service.invoiceAddedSeats(addEightSeats);

    expect(invoicing.raised[0]?.currency).toBe("EUR");
  });

  it("names the license, so a repeat reaches the same invoice", async () => {
    const { invoicing, service } = harness();

    await service.invoiceAddedSeats(addEightSeats);
    await expect(service.invoiceAddedSeats(addEightSeats)).resolves.toBe("invoiced");

    expect(invoicing.raised).toHaveLength(1);
    expect(invoicing.raised[0]?.metadata).toMatchObject({
      kind: "seat_change",
      license_row_id: "lic-2",
      organization_id: "org-1",
    });
  });

  it("records the invoice it raised against the account", async () => {
    const { store, service } = harness();

    await service.invoiceAddedSeats(addEightSeats);

    expect([...store.connectedInvoices.values()][0]).toMatchObject({
      accountId: "acct-1",
      kind: "seat_change",
      amountCents: 239_344,
      paidOutOfBandAt: null,
    });
  });

  it("does not credit seats that went down", async () => {
    const { invoicing, service } = harness();

    await expect(
      service.invoiceAddedSeats({
        organizationId: "org-1",
        licenseRowId: "lic-3",
        previousSeats: 50,
        seats: 40,
      }),
    ).resolves.toBe("nothing_to_invoice");
    expect(invoicing.raised).toEqual([]);
  });

  it("charges nothing when the term has already ended", async () => {
    const { invoicing, service } = harness([account({ termEndsAt: at("2026-06-01T10:00:00Z") })]);

    await expect(service.invoiceAddedSeats(addEightSeats)).resolves.toBe("nothing_to_invoice");
    expect(invoicing.raised).toEqual([]);
  });

  it("tells the operator a customer with no billing account was not invoiced", async () => {
    const { invoicing, service } = harness([]);

    await expect(service.invoiceAddedSeats(addEightSeats)).resolves.toBe("not_onboarded");
    expect(invoicing.raised).toEqual([]);
  });

  it("carries the customer's bank transfer onto the invoice", async () => {
    const { invoicing, service } = harness([
      account({ bankTransferType: "eu_bank_transfer", bankTransferCountry: "NL" }),
    ]);

    await service.invoiceAddedSeats(addEightSeats);

    expect(invoicing.raised[0]?.bankTransfer).toEqual({ type: "eu_bank_transfer", country: "NL" });
  });

  it("completes an intent the provider call never confirmed, once", async () => {
    const { repository, invoicing, service } = harness();
    await repository.recordSeatChange({
      licenseRowId: "lic-9",
      accountId: "acct-1",
      changedAt: CHANGED_AT,
      addedSeats: 2,
      unitAmountCents: 29_918,
      amountCents: 59_836,
      currency: "USD",
      state: "intent",
      stripeInvoiceId: null,
    });

    await expect(service.completePendingSeatChanges()).resolves.toEqual({
      invoiced: 1,
      failed: 0,
    });
    await expect(service.completePendingSeatChanges()).resolves.toEqual({
      invoiced: 0,
      failed: 0,
    });
    expect(invoicing.raised).toHaveLength(1);
  });
});
