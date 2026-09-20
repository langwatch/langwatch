import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BankTransfer,
  type ConnectedBillingAccountRecord,
  type ConnectedBillingProvider,
  ConnectedBillingService,
  type ConnectedBillingStore,
  type ConnectedBillingTerms,
  type CreditGrantRecord,
  type InvoiceRecord,
  type OnboardInput,
  type ProviderInvoice,
} from "../connectedBilling.service";

const ACME = "org_acme";
const OPERATOR = "user_operator";
const TERM_STARTS = new Date("2026-10-01T00:00:00.000Z");
const TERM_ENDS = new Date("2027-10-01T00:00:00.000Z");
const NOW = new Date("2026-10-02T00:00:00.000Z");

class InMemoryStore implements ConnectedBillingStore {
  accounts: ConnectedBillingAccountRecord[] = [];
  grants = new Map<string, CreditGrantRecord[]>();
  invoices = new Map<string, (InvoiceRecord & { accountId: string })[]>();
  private sequence = 0;

  async findAccount(organizationId: string) {
    return (
      this.accounts.find((a) => a.organizationId === organizationId) ?? null
    );
  }
  async findAccountBySubscription(usageSubscriptionId: string) {
    return (
      this.accounts.find(
        (a) => a.usageSubscriptionId === usageSubscriptionId,
      ) ?? null
    );
  }
  async createAccount(account: Omit<ConnectedBillingAccountRecord, "id">) {
    const created = { ...account, id: `acct_${++this.sequence}` };
    this.accounts.push(created);
    return created;
  }
  async updateAccount(
    id: string,
    patch: Partial<ConnectedBillingAccountRecord>,
  ) {
    const index = this.accounts.findIndex((a) => a.id === id);
    const updated = {
      ...this.accounts[index],
      ...patch,
    } as ConnectedBillingAccountRecord;
    this.accounts[index] = updated;
    return updated;
  }
  async listCreditGrants(accountId: string) {
    return [...(this.grants.get(accountId) ?? [])];
  }
  async addCreditGrant(accountId: string, grant: CreditGrantRecord) {
    this.grants.set(accountId, [...(this.grants.get(accountId) ?? []), grant]);
  }
  async listInvoices(accountId: string) {
    return [...(this.invoices.get(accountId) ?? [])];
  }
  async findInvoice(stripeInvoiceId: string) {
    for (const rows of this.invoices.values()) {
      const found = rows.find((r) => r.stripeInvoiceId === stripeInvoiceId);
      if (found) return found;
    }
    return null;
  }
  async addInvoice(accountId: string, invoice: InvoiceRecord) {
    this.invoices.set(accountId, [
      ...(this.invoices.get(accountId) ?? []),
      { ...invoice, accountId },
    ]);
  }
  async updateInvoice(stripeInvoiceId: string, patch: Partial<InvoiceRecord>) {
    for (const rows of this.invoices.values()) {
      const found = rows.find((r) => r.stripeInvoiceId === stripeInvoiceId);
      if (found) Object.assign(found, patch);
    }
  }
}

function fakeProvider({
  usageInvoiceFinalized = true,
  invoices = {},
}: {
  usageInvoiceFinalized?: boolean;
  invoices?: Record<string, ProviderInvoice>;
} = {}) {
  let sequence = 0;
  const provider: ConnectedBillingProvider = {
    createCustomer: vi.fn(async () => ({ id: `cus_${++sequence}` })),
    createUsageSubscription: vi.fn(async () => ({
      id: `sub_${++sequence}`,
      itemId: `si_${sequence}`,
    })),
    createCreditGrant: vi.fn(async () => ({ id: `credgr_${++sequence}` })),
    createOneOffInvoice: vi.fn(
      async ({
        currency,
        lines,
      }: Parameters<ConnectedBillingProvider["createOneOffInvoice"]>[0]) => ({
        id: `in_${++sequence}`,
        status: "open",
        currency,
        amountDueCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
        subscriptionId: null,
        periodEnd: null,
      }),
    ),
    retrieveInvoice: vi.fn(async (id: string) => {
      const invoice = invoices[id];
      if (!invoice) throw new Error(`no invoice ${id}`);
      return invoice;
    }),
    hasFinalizedUsageInvoice: vi.fn(async () => usageInvoiceFinalized),
    creditInvoiceInFull: vi.fn(async () => undefined),
    addPendingSubscriptionItem: vi.fn(async () => ({ id: `ii_${++sequence}` })),
    payOutOfBand: vi.fn(async () => undefined),
  };
  return provider;
}

function fakeTerms(commitUsdCents: number) {
  const state = { commitUsdCents };
  const terms: ConnectedBillingTerms = {
    termsOf: vi.fn(async () => ({ commitUsdCents: state.commitUsdCents })),
    raiseCommit: vi.fn(async ({ byUsdCents }) => {
      state.commitUsdCents += byUsdCents;
    }),
    syncBudget: vi.fn(async () => undefined),
    resetBudget: vi.fn(async () => undefined),
  };
  return { terms, state };
}

function build({
  commitUsdCents = 100_000,
  isCloud = true,
  bankDetails = "IBAN NL00 BANK 0000 0000 00",
  provider = fakeProvider(),
}: {
  commitUsdCents?: number;
  isCloud?: boolean;
  bankDetails?: string | null;
  provider?: ConnectedBillingProvider;
} = {}) {
  const store = new InMemoryStore();
  const { terms, state } = fakeTerms(commitUsdCents);
  const service = new ConnectedBillingService({
    store,
    provider,
    terms,
    isCloud: () => isCloud,
    bankDetails: () => bankDetails,
    now: () => NOW,
  });
  return { service, store, provider, terms, state };
}

const onboarding = (overrides: Partial<OnboardInput> = {}): OnboardInput => ({
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
  ...overrides,
});

describe("ConnectedBillingService", () => {
  describe("onboarding", () => {
    let context: ReturnType<typeof build>;

    beforeEach(() => {
      context = build();
    });

    /** @scenario Onboarding creates an invoice customer */
    it("creates the billing customer with the bank transfer the operator named", async () => {
      await context.service.onboard(onboarding());

      expect(context.provider.createCustomer).toHaveBeenCalledWith({
        organizationId: ACME,
        name: "ACME",
        email: "finance@acme.test",
        bankTransfer: { type: "us_bank_transfer" } satisfies BankTransfer,
        invoiceFooter: null,
      });
    });

    /** @scenario Onboarding subscribes the customer to metered usage invoiced quarterly */
    it("subscribes the customer to metered usage anchored at the term start", async () => {
      const account = await context.service.onboard(onboarding());

      expect(context.provider.createUsageSubscription).toHaveBeenCalledWith({
        customerId: account.stripeCustomerId,
        termStartsAt: TERM_STARTS,
        bankTransfer: { type: "us_bank_transfer" },
      });
      expect(account.usageSubscriptionId).toMatch(/^sub_/);
    });

    /** @scenario The prepaid commit becomes a credit that only applies to metered usage */
    /** @scenario The commit credit outlives the last invoice of the term */
    it("grants the commit as paid credit that expires 14 days after the term", async () => {
      const account = await context.service.onboard(onboarding());

      expect(context.provider.createCreditGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: account.stripeCustomerId,
          amountUsdCents: 100_000,
          expiresAt: new Date("2027-10-15T00:00:00.000Z"),
        }),
      );
      expect(await context.store.listCreditGrants(account.id)).toMatchObject([
        { kind: "commit", amountUsdCents: 100_000, termEndsAt: TERM_ENDS },
      ]);
    });

    /** @scenario The commit is charged on the annual invoice, the credit charges nothing */
    it("puts the seats and the commit on one annual invoice", async () => {
      const account = await context.service.onboard(onboarding());

      expect(context.provider.createOneOffInvoice).toHaveBeenCalledTimes(1);
      expect(context.provider.createOneOffInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: "USD",
          lines: [
            {
              description: expect.stringContaining("50 seats"),
              amountCents: 3_000_000,
            },
            {
              description: expect.stringContaining("commit"),
              amountCents: 100_000,
            },
          ],
        }),
      );
      expect(await context.store.listInvoices(account.id)).toMatchObject([
        { kind: "annual", amountCents: 3_100_000, termStartsAt: TERM_STARTS },
      ]);
    });

    /** @scenario The usage subscription is in USD whatever the seat currency */
    it("invoices seats in the seat currency and keeps usage in USD", async () => {
      await context.service.onboard(onboarding({ seatCurrency: "EUR" }));

      expect(context.provider.createOneOffInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "EUR" }),
      );
      expect(context.provider.createUsageSubscription).toHaveBeenCalledTimes(1);
      expect(context.provider.createCreditGrant).toHaveBeenCalledWith(
        expect.objectContaining({ amountUsdCents: 100_000 }),
      );
    });

    /** @scenario The organization budget equals the commit */
    it("asks the registry to sync the organization budget to the commit", async () => {
      await context.service.onboard(onboarding());

      expect(context.terms.syncBudget).toHaveBeenCalledWith({
        organizationId: ACME,
        operatorId: OPERATOR,
      });
    });

    /** @scenario Onboarding twice does not create anything twice */
    it("creates nothing twice when run again with the same terms", async () => {
      await context.service.onboard(onboarding());
      await context.service.onboard(onboarding());

      expect(context.provider.createCustomer).toHaveBeenCalledTimes(1);
      expect(context.provider.createUsageSubscription).toHaveBeenCalledTimes(1);
      expect(context.provider.createCreditGrant).toHaveBeenCalledTimes(1);
      expect(context.provider.createOneOffInvoice).toHaveBeenCalledTimes(1);
      expect(context.store.accounts).toHaveLength(1);
    });

    /** @scenario Onboarding that fails halfway can be resumed */
    it("reuses the billing customer and completes the remaining steps after a failure", async () => {
      const failing = fakeProvider();
      (
        failing.createUsageSubscription as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("provider down"));
      const resumed = build({ provider: failing });

      await expect(resumed.service.onboard(onboarding())).rejects.toThrow(
        "provider down",
      );
      const account = await resumed.service.onboard(onboarding());

      expect(failing.createCustomer).toHaveBeenCalledTimes(1);
      expect(account.usageSubscriptionId).toMatch(/^sub_/);
      expect(failing.createCreditGrant).toHaveBeenCalledTimes(1);
    });

    /** @scenario Onboarding without a commit gives no hosted usage */
    it("creates no credit when there is no commit", async () => {
      const none = build({ commitUsdCents: 0 });

      await none.service.onboard(onboarding({ commitUsdCents: 0 }));

      expect(none.provider.createCreditGrant).not.toHaveBeenCalled();
      expect(none.terms.syncBudget).toHaveBeenCalled();
    });

    /** @scenario A customer who cannot pay through a virtual bank account is invoiced without one */
    /** @scenario An invoice shows the payment instructions that fit the customer */
    it("prints LangWatch's bank details on the invoices of a customer paying by wire", async () => {
      await context.service.onboard(onboarding({ bankTransfer: null }));

      expect(context.provider.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          bankTransfer: null,
          invoiceFooter: "IBAN NL00 BANK 0000 0000 00",
        }),
      );
      expect(context.provider.createOneOffInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ bankTransfer: null }),
      );
    });

    /** @scenario Onboarding is refused outside LangWatch Cloud */
    it("is refused outside LangWatch Cloud", async () => {
      const selfHosted = build({ isCloud: false });

      await expect(
        selfHosted.service.onboard(onboarding()),
      ).rejects.toMatchObject({
        code: "connected_billing_unavailable",
      });
      expect(selfHosted.provider.createCustomer).not.toHaveBeenCalled();
    });

    it("refuses a commit that differs from the license terms", async () => {
      await expect(
        context.service.onboard(onboarding({ commitUsdCents: 50_000 })),
      ).rejects.toMatchObject({
        code: "connected_billing_commit_mismatch",
        meta: { licenseCommitUsd: 1000 },
      });
      expect(context.provider.createCustomer).not.toHaveBeenCalled();
    });
  });

  describe("adding commit mid-term", () => {
    /** @scenario Adding commit raises the credit and the budget together */
    it("creates a second paid credit and raises the license commit, which the budget follows", async () => {
      const context = build();
      const account = await context.service.onboard(onboarding());

      await context.service.addCommit({
        organizationId: ACME,
        amountUsdCents: 50_000,
        operatorId: OPERATOR,
      });

      expect(context.terms.raiseCommit).toHaveBeenCalledWith({
        organizationId: ACME,
        byUsdCents: 50_000,
        operatorId: OPERATOR,
      });
      expect(context.state.commitUsdCents).toBe(150_000);
      expect(await context.store.listCreditGrants(account.id)).toMatchObject([
        { kind: "commit", amountUsdCents: 100_000 },
        { kind: "added", amountUsdCents: 50_000 },
      ]);
      expect((await context.store.findAccount(ACME))?.commitUsdCents).toBe(
        150_000,
      );
    });
  });

  describe("renewal", () => {
    const NEXT_TERM_STARTS = TERM_ENDS;
    const NEXT_TERM_ENDS = new Date("2028-10-01T00:00:00.000Z");
    const renewal = {
      organizationId: ACME,
      termStartsAt: NEXT_TERM_STARTS,
      termEndsAt: NEXT_TERM_ENDS,
      seats: 50,
      seatRateCents: 60_000,
      seatCurrency: "USD" as const,
      commitUsdCents: 200_000,
      operatorId: OPERATOR,
    };

    /** @scenario Renewal keeps the one usage subscription and resets the budget */
    it("keeps the usage subscription, resets the budget and syncs it to the new commit", async () => {
      const context = build();
      const before = await context.service.onboard(onboarding());
      context.state.commitUsdCents = 200_000;

      const after = await context.service.renew(renewal);

      expect(after.usageSubscriptionId).toBe(before.usageSubscriptionId);
      expect(context.provider.createUsageSubscription).toHaveBeenCalledTimes(1);
      expect(context.terms.resetBudget).toHaveBeenCalledWith({
        organizationId: ACME,
        operatorId: OPERATOR,
      });
      expect(after).toMatchObject({
        commitUsdCents: 200_000,
        termEndsAt: NEXT_TERM_ENDS,
      });
      expect(context.provider.createOneOffInvoice).toHaveBeenCalledTimes(2);
    });

    /** @scenario The renewal credit waits for the last usage invoice of the old term */
    /** @scenario Overage from the old term is not absorbed by the new credit */
    it("creates the renewal credit only once the old term's last usage invoice is finalized", async () => {
      const context = build({
        provider: fakeProvider({ usageInvoiceFinalized: false }),
      });
      const account = await context.service.onboard(onboarding());
      context.state.commitUsdCents = 200_000;

      await context.service.renew(renewal);
      expect(await context.store.listCreditGrants(account.id)).toHaveLength(1);
      expect(
        (await context.store.findAccount(ACME))?.pendingRenewal,
      ).toMatchObject({
        commitUsdCents: 200_000,
        awaitingInvoicePeriodEnd: TERM_ENDS.toISOString(),
      });

      (
        context.provider.hasFinalizedUsageInvoice as ReturnType<typeof vi.fn>
      ).mockResolvedValue(true);
      expect(
        await context.service.completeRenewalIfDue({ organizationId: ACME }),
      ).toBe("completed");
      expect(await context.store.listCreditGrants(account.id)).toMatchObject([
        { kind: "commit" },
        {
          kind: "renewal",
          amountUsdCents: 200_000,
          termEndsAt: NEXT_TERM_ENDS,
        },
      ]);
      expect(
        (await context.store.findAccount(ACME))?.pendingRenewal,
      ).toBeNull();
      expect(
        await context.service.completeRenewalIfDue({ organizationId: ACME }),
      ).toBe("none");
    });
  });

  describe("small invoices and payment", () => {
    const usageInvoice = (amountDueCents: number): ProviderInvoice => ({
      id: "in_usage",
      status: "open",
      currency: "usd",
      amountDueCents,
      subscriptionId: "sub_1",
      periodEnd: new Date("2027-01-01T00:00:00.000Z"),
    });

    async function onboarded(amountDueCents: number) {
      const provider = fakeProvider({
        invoices: { in_usage: usageInvoice(amountDueCents) },
      });
      const context = build({ provider });
      await context.service.onboard(onboarding());
      const account = await context.store.findAccount(ACME);
      await context.store.updateAccount(account?.id ?? "", {
        usageSubscriptionId: "sub_1",
      });
      return context;
    }

    /** @scenario A usage invoice under 50 USD is rolled forward */
    it("credits an invoice under 50 USD in full and carries the amount to the next one", async () => {
      const context = await onboarded(1_200);

      expect(
        await context.service.rollForwardSmallInvoice({
          stripeInvoiceId: "in_usage",
        }),
      ).toBe("rolled");

      expect(context.provider.creditInvoiceInFull).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceId: "in_usage" }),
      );
      expect(context.provider.addPendingSubscriptionItem).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: "sub_1",
          amountCents: 1_200,
          currency: "USD",
          metadata: { rolled_forward_from: "in_usage" },
        }),
      );
      expect(
        (await context.store.findInvoice("in_usage"))?.rolledForwardTo,
      ).toMatch(/^ii_/);
    });

    /** @scenario A usage invoice of 50 USD or more is left alone */
    it("leaves an invoice of 50 USD or more alone", async () => {
      const context = await onboarded(5_000);

      expect(
        await context.service.rollForwardSmallInvoice({
          stripeInvoiceId: "in_usage",
        }),
      ).toBe("left");
      expect(context.provider.creditInvoiceInFull).not.toHaveBeenCalled();
    });

    /** @scenario Rolling the same invoice forward twice moves the amount once */
    it("moves the amount once when run twice", async () => {
      const context = await onboarded(1_200);

      await context.service.rollForwardSmallInvoice({
        stripeInvoiceId: "in_usage",
      });
      expect(
        await context.service.rollForwardSmallInvoice({
          stripeInvoiceId: "in_usage",
        }),
      ).toBe("already_rolled");

      expect(context.provider.creditInvoiceInFull).toHaveBeenCalledTimes(1);
      expect(context.provider.addPendingSubscriptionItem).toHaveBeenCalledTimes(
        1,
      );
    });

    it("marks an invoice paid out of band and records when", async () => {
      const context = await onboarded(80_000);
      const account = await context.store.findAccount(ACME);
      await context.store.addInvoice(account?.id ?? "", {
        stripeInvoiceId: "in_usage",
        kind: "usage",
        currency: "USD",
        amountCents: 80_000,
        status: "open",
        rolledForwardTo: null,
        paidOutOfBandAt: null,
        termStartsAt: null,
      });

      await context.service.markPaidOutOfBand({ stripeInvoiceId: "in_usage" });

      expect(context.provider.payOutOfBand).toHaveBeenCalledWith("in_usage");
      expect(await context.store.findInvoice("in_usage")).toMatchObject({
        status: "paid",
        paidOutOfBandAt: NOW,
      });
    });
  });
});
