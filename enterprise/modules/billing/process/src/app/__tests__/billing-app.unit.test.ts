import { createApiFixture } from "@langwatch/api-fixture";
import type { RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { ContractTerms } from "@langwatch/enterprise-licensing-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillingRepositories } from "../../repositories/memory/memory.billing.repositories.ts";
import { type ConnectedBillingPeers, BillingApp } from "../billing.app.ts";

const ACME = "org-acme";
const STAFF = { id: "user-operator", email: "ops@langwatch.example" };
const CUSTOMER_ADMIN = { id: "user-customer", email: "admin@acme.example" };

/** The license registry as billing reads it: terms agreed at a fixed commit. */
function licensedAt(commitUsdCents: number) {
  const asked: string[] = [];
  const audited: RecordAuditLogCommand[] = [];
  const terms: ContractTerms = {
    commitUsdCents,
    maximumUsdCents: commitUsdCents,
    overageEnabled: false,
    services: ["managed_models"],
    termEndsAt: "2027-10-01T00:00:00Z",
    termStartsAt: "2026-10-01T00:00:00Z",
  };
  const peers: ConnectedBillingPeers = {
    licensing: createApiFixture<ConnectedBillingPeers["licensing"]>({
      getContractTerms: async ({ organizationId }) => {
        asked.push(organizationId);
        return terms;
      },
      getConnectedSeats: async () => ({
        licensed: 10,
        reported: 8,
        lastSyncAt: "2026-11-02T00:00:00Z",
        managedVirtualKeyId: null,
      }),
    }),
    operators: { isAdmin: ({ email }) => email === STAFF.email },
    auditLog: createApiFixture<ConnectedBillingPeers["auditLog"]>({
      record: async (command) => {
        audited.push(command);
      },
    }),
    organizations: createApiFixture<ConnectedBillingPeers["organizations"]>({
      findSelfHostedCustomers: async () => [{ organizationId: ACME, organizationName: "Acme" }],
    }),
    gateway: createApiFixture<ConnectedBillingPeers["gateway"]>({}),
  };
  return { asked, audited, peers };
}

function billingApp({
  isSaas,
  stripeSecretKey,
  commitUsdCents = 100_00,
}: {
  isSaas: boolean;
  stripeSecretKey: string | undefined;
  commitUsdCents?: number;
}) {
  const registry = licensedAt(commitUsdCents);
  const repositories = MemoryBillingRepositories.create();
  const app = BillingApp.assemble({
    members: { isSaas, nodeEnvironment: "test" },
    repositories,
    config: { bankDetails: undefined },
    peers: registry.peers,
    stripeSecretKey,
  });
  return { app, asked: registry.asked, audited: registry.audited, repositories };
}

const renewal = (commitUsdCents: number) => ({
  organizationId: ACME,
  termStartsAt: "2027-10-01T00:00:00Z",
  termEndsAt: "2028-10-01T00:00:00Z",
  seats: 10,
  seatRateCents: 50_00,
  seatCurrency: "USD" as const,
  commitUsdCents,
});

describe("the installed billing application", () => {
  describe("given a deployment that is not LangWatch Cloud and has no payment provider", () => {
    /** @scenario "Onboarding is refused outside LangWatch Cloud" */
    it("refuses connected billing by its handled code", async () => {
      const { app } = billingApp({ isSaas: false, stripeSecretKey: undefined });

      await expect(app.renewConnectedTerm(renewal(100_00), STAFF)).rejects.toMatchObject({
        code: "connected_billing_unavailable",
      });
    });

    it("runs no billing tick at all", async () => {
      const { app } = billingApp({ isSaas: false, stripeSecretKey: undefined });

      await expect(app.runConnectedBillingTick()).resolves.toBeUndefined();
    });
  });

  describe("given LangWatch Cloud with no payment provider key", () => {
    it("fails as a deployment fault rather than a refusal the customer can act on", async () => {
      const { app } = billingApp({ isSaas: true, stripeSecretKey: undefined });

      const failure = await app
        .renewConnectedTerm(renewal(100_00), STAFF)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toHaveProperty("code");
    });
  });

  describe("given LangWatch Cloud with a payment provider", () => {
    it("checks a renewal's commit against the terms the license registry holds", async () => {
      const { app, asked } = billingApp({
        isSaas: true,
        stripeSecretKey: "sk_test_unused",
        commitUsdCents: 100_00,
      });

      await expect(app.renewConnectedTerm(renewal(250_00), STAFF)).rejects.toMatchObject({
        code: "connected_billing_commit_mismatch",
      });
      expect(asked).toEqual([ACME]);
    });

    it("answers a seat change for a customer never onboarded without invoicing it", async () => {
      const { app } = billingApp({ isSaas: true, stripeSecretKey: "sk_test_unused" });

      await expect(
        app.invoiceAddedSeats({
          organizationId: ACME,
          licenseRowId: "license-1",
          previousSeats: 10,
          seats: 12,
        }),
      ).resolves.toBe("not_onboarded");
    });
  });

  describe("given the backoffice", () => {
    it("answers a caller off the staff list not found, saying nothing about why", async () => {
      const { app } = billingApp({ isSaas: true, stripeSecretKey: "sk_test_unused" });

      await expect(
        app.getConnectedBillingOverview({ organizationId: ACME }, CUSTOMER_ADMIN),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(app.renewConnectedTerm(renewal(100_00), CUSTOMER_ADMIN)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(
        app.markConnectedInvoicePaidOutOfBand({ stripeInvoiceId: "in_1" }, null),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("shows a staff member a customer never onboarded, with the license's terms and seats", async () => {
      const { app } = billingApp({ isSaas: true, stripeSecretKey: "sk_test_unused" });

      const overview = await app.getConnectedBillingOverview({ organizationId: ACME }, STAFF);

      expect(overview).toEqual({
        account: null,
        grants: [],
        invoices: [],
        spend: { spendAvailable: false, limitUsdCents: 100_00, spentUsdCents: null },
        terms: { commitUsdCents: 100_00, maximumUsdCents: 100_00, overageEnabled: false },
        seats: { licensed: 10, reported: 8, lastSyncAt: "2026-11-02T00:00:00Z" },
        seatChanges: [],
      });
    });

    it("records who read a customer's billing, as main's backoffice did", async () => {
      const { app, audited } = billingApp({ isSaas: true, stripeSecretKey: "sk_test_unused" });

      await app.getConnectedBillingOverview({ organizationId: ACME }, STAFF);

      expect(audited).toEqual([
        {
          userId: STAFF.id,
          action: "connectedBilling.get",
          args: { organizationId: ACME },
          targetKind: "organization",
          targetId: ACME,
        },
      ]);
    });
  });

  describe("given the daily tick on LangWatch Cloud", () => {
    it("reads the pending renewals of every connected customer and leaves one with none alone", async () => {
      const { app, repositories } = billingApp({ isSaas: true, stripeSecretKey: "sk_test_unused" });
      await repositories.connectedBilling.createAccount({
        organizationId: ACME,
        stripeCustomerId: "cus_acme",
        usageSubscriptionId: null,
        usageSubscriptionItemId: null,
        termStartsAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
        termEndsAt: Temporal.Instant.from("2027-10-01T00:00:00Z"),
        commitUsdCents: 100_00,
        seatCurrency: "USD",
        seatRateCents: 50_00,
        seats: 10,
        bankTransferType: null,
        bankTransferCountry: null,
        billingEmail: "finance@acme.example",
        pendingRenewal: null,
      });

      await expect(app.runConnectedBillingTick()).resolves.toBeUndefined();
      await expect(repositories.connectedBilling.findAccount(ACME)).resolves.toMatchObject({
        pendingRenewal: null,
      });
    });
  });
});

describe("the subscription plan billing answers entitlement", () => {
  /** @scenario "Billing answers a Cloud organization's active subscription plan" */
  it("answers the active subscription's plan, lifting limits for an impersonating operator", async () => {
    const { app, repositories } = billingApp({ isSaas: true, stripeSecretKey: undefined });
    const pending = await repositories.subscriptions.createPending({
      organizationId: ACME,
      plan: "LAUNCH",
    });
    await repositories.subscriptions.updateStatus({ id: pending.id, status: "ACTIVE" });

    await expect(
      app.getActiveSubscriptionPlan({
        organizationId: ACME,
        user: { ...CUSTOMER_ADMIN, impersonator: { email: STAFF.email } },
      }),
    ).resolves.toMatchObject({ type: "LAUNCH", free: false, overrideAddingLimitations: true });
    await expect(
      app.getActiveSubscriptionPlan({ organizationId: ACME, user: CUSTOMER_ADMIN }),
    ).resolves.toMatchObject({ type: "LAUNCH", overrideAddingLimitations: false });
  });
});
