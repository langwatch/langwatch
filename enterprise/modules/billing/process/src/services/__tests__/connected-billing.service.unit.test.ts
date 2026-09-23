import type {
  ConnectedOnboardInput,
  ConnectedRenewInput,
} from "@langwatch/enterprise-billing-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryConnectedInvoicingChannel } from "../../channels/memory/memory.connected-invoicing.channel.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory-billing.store.ts";
import { MemoryConnectedBillingRepository } from "../../repositories/memory/memory.connected-billing.repository.ts";
import {
  ConnectedBillingService,
  type ConnectedBillingTerms,
} from "../connected-billing.service.ts";

const at = (iso: string): Instant => Temporal.Instant.from(iso);

const ACME = "org-acme";
const OPERATOR = "user-operator";
const TERM_STARTS = at("2026-10-01T00:00:00Z");
const TERM_ENDS = at("2027-10-01T00:00:00Z");
const NOW = at("2026-10-02T00:00:00Z");
const BANK_DETAILS = "IBAN NL00 BANK 0000 0000 00";

/** The license registry, holding the commit an operator agreed on the license. */
class AgreedTerms implements ConnectedBillingTerms {
  readonly syncedBudgets: { organizationId: string; operatorId: string }[] = [];
  readonly resetBudgets: { organizationId: string; operatorId: string }[] = [];
  readonly raises: { organizationId: string; byUsdCents: number; operatorId: string }[] = [];

  constructor(public commitUsdCents: number) {}

  async termsOf(_organizationId: string): Promise<{ commitUsdCents: number }> {
    return { commitUsdCents: this.commitUsdCents };
  }

  async raiseCommit(input: {
    organizationId: string;
    byUsdCents: number;
    operatorId: string;
  }): Promise<void> {
    this.raises.push(input);
    this.commitUsdCents += input.byUsdCents;
  }

  async syncBudget(input: { organizationId: string; operatorId: string }): Promise<void> {
    this.syncedBudgets.push(input);
  }

  async resetBudget(input: { organizationId: string; operatorId: string }): Promise<void> {
    this.resetBudgets.push(input);
  }
}

function harness({
  commitUsdCents = 100_000,
  isSaas = true,
  bankDetails = BANK_DETAILS as string | null,
  usageInvoiceFinalized = true,
} = {}) {
  const store = MemoryBillingStore.create();
  const repository = MemoryConnectedBillingRepository.create(store);
  const invoicing = MemoryConnectedInvoicingChannel.create();
  if (usageInvoiceFinalized) invoicing.finalizedUsagePeriodEndsMs.add(TERM_ENDS.epochMilliseconds);
  const terms = new AgreedTerms(commitUsdCents);
  const service = ConnectedBillingService.create({
    repository,
    invoicing,
    terms,
    isSaas,
    bankDetails: () => bankDetails,
    now: () => NOW,
  });

  return { store, repository, invoicing, terms, service };
}

const onboarding = (patch: Partial<ConnectedOnboardInput> = {}): ConnectedOnboardInput => ({
  organizationId: ACME,
  organizationName: "ACME",
  billingEmail: "finance@acme.test",
  termStartsAt: TERM_STARTS,
  termEndsAt: TERM_ENDS,
  seats: 50,
  seatRateCents: 60_000,
  seatCurrency: "USD",
  commitUsdCents: 100_000,
  bankTransfer: { type: "us_bank_transfer" },
  operatorId: OPERATOR,
  ...patch,
});

describe("onboarding a connected customer", () => {
  /** @scenario "Onboarding creates an invoice customer" */
  it("creates the billing customer with the bank transfer the operator named", async () => {
    const { invoicing, service } = harness();

    await service.onboard(onboarding());

    expect(invoicing.customers).toMatchObject([
      {
        organizationId: ACME,
        name: "ACME",
        email: "finance@acme.test",
        bankTransfer: { type: "us_bank_transfer" },
        invoiceFooter: null,
      },
    ]);
  });

  /** @scenario "Onboarding subscribes the customer to metered usage invoiced quarterly" */
  it("subscribes the customer to metered usage anchored at the term start", async () => {
    const { invoicing, service } = harness();

    const account = await service.onboard(onboarding());

    expect(invoicing.subscriptions).toMatchObject([
      { customerId: account.stripeCustomerId, termStartsAt: TERM_STARTS },
    ]);
    expect(account.usageSubscriptionId).toMatch(/^sub_/);
    expect(account.usageSubscriptionItemId).toMatch(/^si_/);
  });

  /** @scenario "The prepaid commit becomes a credit that only applies to metered usage" */
  /** @scenario "The commit credit outlives the last invoice of the term" */
  it("grants the commit as paid credit that expires 14 days after the term", async () => {
    const { invoicing, repository, service } = harness();

    const account = await service.onboard(onboarding());

    expect(invoicing.grants).toMatchObject([
      { amountUsdCents: 100_000, expiresAt: at("2027-10-15T00:00:00Z") },
    ]);
    expect(await repository.findCreditGrants(account.id)).toMatchObject([
      { kind: "commit", amountUsdCents: 100_000, termEndsAt: TERM_ENDS },
    ]);
  });

  /** @scenario "The commit is charged on the annual invoice, the credit charges nothing" */
  it("puts the seats and the commit on one annual invoice", async () => {
    const { invoicing, repository, service } = harness();

    const account = await service.onboard(onboarding());

    expect(invoicing.raised).toHaveLength(1);
    expect(invoicing.raised[0]).toMatchObject({
      currency: "USD",
      lines: [
        { description: expect.stringContaining("50 seats"), amountCents: 3_000_000 },
        { description: expect.stringContaining("commit"), amountCents: 100_000 },
      ],
    });
    expect(await repository.findInvoices(account.id)).toMatchObject([
      { kind: "annual", amountCents: 3_100_000, termStartsAt: TERM_STARTS },
    ]);
  });

  /** @scenario "The usage subscription is in USD whatever the seat currency" */
  it("invoices seats in the seat currency and keeps the commit in USD", async () => {
    const { invoicing, service } = harness();

    await service.onboard(onboarding({ seatCurrency: "EUR" }));

    expect(invoicing.raised[0]).toMatchObject({ currency: "EUR" });
    expect(invoicing.subscriptions).toHaveLength(1);
    expect(invoicing.grants).toMatchObject([{ amountUsdCents: 100_000 }]);
  });

  /** @scenario "The organization budget equals the commit" */
  it("asks the registry to sync the organization budget to the commit", async () => {
    const { terms, service } = harness();

    await service.onboard(onboarding());

    expect(terms.syncedBudgets).toEqual([{ organizationId: ACME, operatorId: OPERATOR }]);
  });

  /** @scenario "Onboarding twice does not create anything twice" */
  it("creates nothing twice when run again with the same terms", async () => {
    const { invoicing, store, service } = harness();

    await service.onboard(onboarding());
    await service.onboard(onboarding());

    expect(invoicing.customers).toHaveLength(1);
    expect(invoicing.subscriptions).toHaveLength(1);
    expect(invoicing.grants).toHaveLength(1);
    expect(invoicing.raised).toHaveLength(1);
    expect(store.connectedBillingAccounts.size).toBe(1);
  });

  /** @scenario "Onboarding that fails halfway can be resumed" */
  it("reuses the billing customer and completes the remaining steps after a failure", async () => {
    const { invoicing, service } = harness();
    const subscribe = invoicing.createUsageSubscription.bind(invoicing);
    let refused = false;
    invoicing.createUsageSubscription = async (input) => {
      if (refused) return subscribe(input);
      refused = true;
      throw new Error("provider down");
    };

    await expect(service.onboard(onboarding())).rejects.toThrow("provider down");
    const account = await service.onboard(onboarding());

    expect(invoicing.customers).toHaveLength(1);
    expect(account.usageSubscriptionId).toMatch(/^sub_/);
    expect(invoicing.grants).toHaveLength(1);
  });

  /** @scenario "Onboarding without a commit gives no hosted usage" */
  it("creates no credit when there is no commit", async () => {
    const { invoicing, terms, service } = harness({ commitUsdCents: 0 });

    await service.onboard(onboarding({ commitUsdCents: 0 }));

    expect(invoicing.grants).toHaveLength(0);
    expect(terms.syncedBudgets).toHaveLength(1);
  });

  /** @scenario "A customer who cannot pay through a virtual bank account is invoiced without one" */
  /** @scenario "An invoice shows the payment instructions that fit the customer" */
  it("prints LangWatch's bank details on the invoices of a customer paying by wire", async () => {
    const { invoicing, service } = harness();

    await service.onboard(onboarding({ bankTransfer: null }));

    expect(invoicing.customers[0]).toMatchObject({
      bankTransfer: null,
      invoiceFooter: BANK_DETAILS,
    });
    expect(invoicing.raised[0]).toMatchObject({ bankTransfer: null });
  });

  /** @scenario "Onboarding is refused outside LangWatch Cloud" */
  it("is refused outside LangWatch Cloud", async () => {
    const { invoicing, service } = harness({ isSaas: false });

    await expect(service.onboard(onboarding())).rejects.toMatchObject({
      code: "connected_billing_unavailable",
    });
    expect(invoicing.customers).toHaveLength(0);
  });

  it("refuses a commit that differs from the license terms", async () => {
    const { invoicing, service } = harness();

    await expect(service.onboard(onboarding({ commitUsdCents: 50_000 }))).rejects.toMatchObject({
      code: "connected_billing_commit_mismatch",
      meta: { licenseCommitUsd: 1000 },
    });
    expect(invoicing.customers).toHaveLength(0);
  });
});

describe("adding commit mid-term", () => {
  /** @scenario "Adding commit raises the credit and the budget together" */
  it("creates a second paid credit and raises the license commit the budget follows", async () => {
    const { repository, terms, service } = harness();
    const account = await service.onboard(onboarding());

    await service.addCommit({
      organizationId: ACME,
      amountUsdCents: 50_000,
      operatorId: OPERATOR,
    });

    expect(terms.raises).toEqual([
      { organizationId: ACME, byUsdCents: 50_000, operatorId: OPERATOR },
    ]);
    expect(terms.commitUsdCents).toBe(150_000);
    expect(await repository.findCreditGrants(account.id)).toMatchObject([
      { kind: "commit", amountUsdCents: 100_000 },
      { kind: "added", amountUsdCents: 50_000 },
    ]);
    expect((await repository.findAccount(ACME))?.commitUsdCents).toBe(150_000);
  });

  it("refuses to add commit for a customer with no billing account", async () => {
    const { service } = harness();

    await expect(
      service.addCommit({ organizationId: ACME, amountUsdCents: 50_000, operatorId: OPERATOR }),
    ).rejects.toMatchObject({ code: "connected_billing_not_onboarded" });
  });
});

describe("renewing a term", () => {
  const NEXT_TERM_ENDS = at("2028-10-01T00:00:00Z");
  const renewal: ConnectedRenewInput = {
    organizationId: ACME,
    termStartsAt: TERM_ENDS,
    termEndsAt: NEXT_TERM_ENDS,
    seats: 50,
    seatRateCents: 60_000,
    seatCurrency: "USD",
    commitUsdCents: 200_000,
    operatorId: OPERATOR,
  };

  /** @scenario "Renewal keeps the one usage subscription and resets the budget" */
  it("keeps the usage subscription, resets the budget and syncs it to the new commit", async () => {
    const { invoicing, terms, service } = harness();
    const before = await service.onboard(onboarding());
    terms.commitUsdCents = 200_000;

    const after = await service.renew(renewal);

    expect(after.usageSubscriptionId).toBe(before.usageSubscriptionId);
    expect(invoicing.subscriptions).toHaveLength(1);
    expect(terms.resetBudgets).toEqual([{ organizationId: ACME, operatorId: OPERATOR }]);
    expect(after).toMatchObject({ commitUsdCents: 200_000, termEndsAt: NEXT_TERM_ENDS });
    expect(invoicing.raised).toHaveLength(2);
  });

  /** @scenario "The renewal credit waits for the last usage invoice of the old term" */
  /** @scenario "Overage from the old term is not absorbed by the new credit" */
  it("creates the renewal credit only once the old term's last usage invoice is finalized", async () => {
    const { invoicing, repository, terms, service } = harness({ usageInvoiceFinalized: false });
    const account = await service.onboard(onboarding());
    terms.commitUsdCents = 200_000;

    await service.renew(renewal);

    expect(await repository.findCreditGrants(account.id)).toHaveLength(1);
    expect((await repository.findAccount(ACME))?.pendingRenewal).toMatchObject({
      commitUsdCents: 200_000,
      awaitingInvoicePeriodEnd: TERM_ENDS.toString(),
    });

    invoicing.finalizedUsagePeriodEndsMs.add(TERM_ENDS.epochMilliseconds);

    await expect(service.completeRenewalIfDue({ organizationId: ACME })).resolves.toBe("completed");
    expect(await repository.findCreditGrants(account.id)).toMatchObject([
      { kind: "commit" },
      { kind: "renewal", amountUsdCents: 200_000, termEndsAt: NEXT_TERM_ENDS },
    ]);
    expect((await repository.findAccount(ACME))?.pendingRenewal).toBeNull();
    await expect(service.completeRenewalIfDue({ organizationId: ACME })).resolves.toBe("none");
  });
});

describe("an invoice paid outside the payment provider", () => {
  /** @scenario "Finance marks an invoice paid out of band from the backoffice" */
  it("tells the provider and records when the money arrived", async () => {
    const { invoicing, repository, service } = harness();
    const account = await service.onboard(onboarding());
    const [invoice] = await repository.findInvoices(account.id);

    await service.markPaidOutOfBand({ stripeInvoiceId: invoice?.stripeInvoiceId ?? "" });

    expect(invoicing.paidOutOfBand).toEqual([invoice?.stripeInvoiceId]);
    expect(await repository.findInvoice(invoice?.stripeInvoiceId ?? "")).toMatchObject({
      status: "paid",
      paidOutOfBandAt: NOW,
    });
  });

  it("is refused outside LangWatch Cloud", async () => {
    const { service } = harness({ isSaas: false });

    await expect(service.markPaidOutOfBand({ stripeInvoiceId: "in_1" })).rejects.toMatchObject({
      code: "connected_billing_unavailable",
    });
  });
});
