import type { ContractTerms, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { billingProcessModule } from "../../billing.module.ts";
import { MemoryBillingWebhookHostChannel } from "../../channels/memory/memory.billing-webhook-host.channel.ts";
import { MemoryConnectedInvoicingChannel } from "../../channels/memory/memory.connected-invoicing.channel.ts";
import { MemoryStripeCustomersChannel } from "../../channels/memory/memory.stripe-customers.channel.ts";
import { MemoryStripeInvoicesChannel } from "../../channels/memory/memory.stripe-invoices.channel.ts";
import { MemoryStripeMetersChannel } from "../../channels/memory/memory.stripe-meters.channel.ts";
import { MemoryStripePricesChannel } from "../../channels/memory/memory.stripe-prices.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryStripeWebhooksChannel } from "../../channels/memory/memory.stripe-webhooks.channel.ts";
import type { RecordBillingAuditCommandData } from "../../eventing/billing-lifecycle.events.ts";
import { MemoryBillingRepositories } from "../../repositories/memory/memory.billing.repositories.ts";
import { BillingLifecycleAnnouncerService } from "../../services/billing-lifecycle-announcer.service.ts";
import type { ResourceLimitAlertService } from "../../services/resource-limit-alert.service.ts";
import type { UsageReportingService } from "../../services/usage-reporting.service.ts";
import type { UsageWarningService } from "../../services/usage-warning.service.ts";
import { billingStripeWebhookRest } from "../../transport/billing-stripe-webhook.rest.ts";
import { type ConnectedBillingPeers, BillingModule } from "../billing.app.ts";

const ACME = "org-acme";
const STAFF = { id: "user-operator", email: "ops@langwatch.example" };
const VIEWER = { id: "user-viewer", email: "view@langwatch.example" };
const CUSTOMER_ADMIN = { id: "user-customer", email: "admin@acme.example" };

/** The license registry as billing reads it: terms agreed at a fixed commit. */
function licensedAt(commitUsdCents: number) {
  const asked: string[] = [];
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
      findSeatChanges: async () => [
        {
          licenseRowId: "license-2",
          organizationId: ACME,
          previousSeats: 10,
          seats: 12,
          changedAt: "2026-11-01T00:00:00Z",
        },
      ],
    }),
    authorization: {
      can: async ({ principal, permission, scope }) =>
        principal.type === "user" &&
        scope.type === "platform" &&
        ((principal.id === STAFF.id &&
          (permission === "ops:manage" || permission === "ops:view")) ||
          (principal.id === VIEWER.id && permission === "ops:view")),
    },
    organizations: createApiFixture<ConnectedBillingPeers["organizations"]>({
      findSelfHostedCustomers: async () => [{ organizationId: ACME, organizationName: "Acme" }],
    }),
  };
  return { asked, peers };
}

/** Billing's lifecycle pipeline with its senders captured; only the audit facts are kept. */
function lifecycleRecording() {
  const audited: RecordBillingAuditCommandData[] = [];
  const ignored = <Payload>(kept: Payload[] = []): EventingCommandSender<Payload> => ({
    send: async (payload) => {
      kept.push(payload);
    },
    sendBatch: async (payloads) => {
      kept.push(...payloads);
    },
    close: async () => {},
    waitUntilReady: async () => {},
  });
  const lifecycle = BillingLifecycleAnnouncerService.create({
    subscriptions: { findLastNonCancelled: async () => null },
    organizations: { getAllMembers: async () => [] },
    resourceLimitAlerts: { notifyResourceLimitReached: async () => {} },
    planLimitAlerts: { notifyPlanLimitReached: async () => {} },
    billingOrganizations: { getOrganizationForBilling: async () => ({ outcome: "not_found" }) },
  });
  lifecycle.connect({
    recordSubscriptionChanged: ignored(),
    recordSubscriptionStarted: ignored(),
    recordCheckoutCompleted: ignored(),
    recordUsageBillingChanged: ignored(),
    recordAudit: ignored(audited),
  });
  return { lifecycle, audited };
}

/** Billing's Stripe as memory twins; the SDK client refuses any call by name. */
function stripeTwins({ webhookSecret }: { webhookSecret: string | undefined }) {
  const channels = {
    webhooks: MemoryStripeWebhooksChannel.create({ signingSecret: webhookSecret }),
    customers: MemoryStripeCustomersChannel.create(),
    subscriptions: MemoryStripeSubscriptionsChannel.create(),
    invoices: MemoryStripeInvoicesChannel.create(),
    prices: MemoryStripePricesChannel.create(),
    meters: MemoryStripeMetersChannel.create(),
    connectedInvoicing: MemoryConnectedInvoicingChannel.create(),
  };
  return { channels };
}

function billingApp({
  isSaas,
  withStripe,
  commitUsdCents = 100_00,
  webhookSecret,
}: {
  isSaas: boolean;
  withStripe: boolean;
  commitUsdCents?: number;
  webhookSecret?: string;
}) {
  const registry = licensedAt(commitUsdCents);
  const repositories = MemoryBillingRepositories.create();
  const stripe = withStripe ? stripeTwins({ webhookSecret }) : void 0;
  const { lifecycle, audited } = lifecycleRecording();
  const app = BillingModule.assemble({
    lifecycle,
    usageWarnings: createApiFixture<UsageWarningService>({}),
    resourceLimitAlerts: createApiFixture<ResourceLimitAlertService>({}),
    repositories,
    config: {
      bankDetails: undefined,
      licensePaymentLinkId: undefined,
      isSaas,
      nodeEnvironment: "test",
    },
    peers: registry.peers,
    stripe,
    usageReporting: () => createApiFixture<UsageReportingService>({}, "usage meter"),
    webhook: {
      host: MemoryBillingWebhookHostChannel.create(),
      licenses: createApiFixture<LicensingApi>({}),
    },
  });
  return { app, asked: registry.asked, audited, repositories, stripe };
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
      const { app } = billingApp({ isSaas: false, withStripe: false });

      await expect(app.renewConnectedTerm(renewal(100_00), STAFF)).rejects.toMatchObject({
        code: "connected_billing_unavailable",
      });
    });

    it("runs no billing tick and no seat invoicing pass at all", async () => {
      const { app, repositories } = billingApp({ isSaas: false, withStripe: false });

      await expect(app.runConnectedBillingTick()).resolves.toBeUndefined();
      await expect(app.invoicePendingSeatChanges()).resolves.toBeUndefined();
      await expect(
        repositories.connectedBilling.findSeatChangesByLicenseRows(["license-2"]),
      ).resolves.toEqual([]);
    });
  });

  describe("given LangWatch Cloud with no payment provider key", () => {
    it("fails as a deployment fault rather than a refusal the customer can act on", async () => {
      const { app } = billingApp({ isSaas: true, withStripe: false });

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
        withStripe: true,
        commitUsdCents: 100_00,
      });

      await expect(app.renewConnectedTerm(renewal(250_00), STAFF)).rejects.toMatchObject({
        code: "connected_billing_commit_mismatch",
      });
      expect(asked).toEqual([ACME]);
    });

    /** @scenario "A deployment that bills composes the real subscription services" */
    it("answers renewals, seat changes and a signed delivery from the composed services", async () => {
      const { app, stripe } = billingApp({
        isSaas: true,
        withStripe: true,
        webhookSecret: "whsec_fixture",
        commitUsdCents: 100_00,
      });
      const payload = JSON.stringify({
        id: "evt_2",
        object: "event",
        type: "account.application.deauthorized",
        data: { object: { id: "ca_1", object: "application" } },
      });
      const signature = MemoryStripeWebhooksChannel.sign({
        payload,
        secret: "whsec_fixture",
      });

      await expect(app.renewConnectedTerm(renewal(250_00), STAFF)).rejects.toMatchObject({
        code: "connected_billing_commit_mismatch",
      });
      await expect(app.invoicePendingSeatChanges()).resolves.toBeUndefined();
      await expect(
        app.receiveStripeWebhook({ rawBody: new TextEncoder().encode(payload), signature }),
      ).resolves.toEqual({ received: true });
      expect(stripe?.channels.connectedInvoicing.raised).toEqual([]);
    });

    /** @scenario "The Billing section shows a seat change until billing decides it" */
    it("shows a recorded seat change as awaiting, then as not onboarded once a pass decided it", async () => {
      const { app } = billingApp({ isSaas: true, withStripe: true });
      const seatChangeState = async () =>
        (await app.getConnectedBillingOverview({ organizationId: ACME }, STAFF)).seatChanges.map(
          (change) => change.state,
        );

      await expect(seatChangeState()).resolves.toEqual(["awaiting"]);
      await app.invoicePendingSeatChanges();
      await expect(seatChangeState()).resolves.toEqual(["not_onboarded"]);
    });
  });

  describe("given the admin console", () => {
    it("shows a staff member a customer never onboarded, with the license's terms and seats", async () => {
      const { app } = billingApp({ isSaas: true, withStripe: true });

      const overview = await app.getConnectedBillingOverview({ organizationId: ACME }, STAFF);

      expect(overview).toEqual({
        account: null,
        grants: [],
        invoices: [],
        spend: { spendAvailable: false, limitUsdCents: 100_00, spentUsdCents: null },
        terms: { commitUsdCents: 100_00, maximumUsdCents: 100_00, overageEnabled: false },
        seats: { licensed: 10, reported: 8, lastSyncAt: "2026-11-02T00:00:00Z" },
        seatChanges: [
          {
            licenseId: "license-2",
            changedAt: "2026-11-01T00:00:00Z",
            addedSeats: 2,
            amountCents: 0,
            currency: null,
            state: "awaiting",
            stripeInvoiceId: null,
          },
        ],
      });
    });

    /** @scenario A platform operator's billing command records an audit fact for audit-log */
    it("records who read a customer's billing, as main's admin console did", async () => {
      const { app, audited } = billingApp({ isSaas: true, withStripe: true });

      await app.getConnectedBillingOverview({ organizationId: ACME }, STAFF);

      expect(audited).toEqual([
        {
          tenantId: ACME,
          occurredAt: expect.any(Number),
          idempotencyKey: expect.stringMatching(/^audit_/),
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
      const { app, repositories } = billingApp({ isSaas: true, withStripe: true });
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
    const { app, repositories } = billingApp({ isSaas: true, withStripe: false });
    const pending = await repositories.subscriptions.createPending({
      organizationId: ACME,
      plan: "LAUNCH",
    });
    await repositories.subscriptions.updateStatus({ id: pending.id, status: "ACTIVE" });

    await expect(
      app.getActiveSubscriptionPlan({
        organizationId: ACME,
        user: { ...CUSTOMER_ADMIN, impersonator: { id: STAFF.id, email: STAFF.email } },
      }),
    ).resolves.toMatchObject({ type: "LAUNCH", free: false, overrideAddingLimitations: true });
    await expect(
      app.getActiveSubscriptionPlan({
        organizationId: ACME,
        user: { ...CUSTOMER_ADMIN, impersonator: { id: VIEWER.id, email: VIEWER.email } },
      }),
    ).resolves.toMatchObject({ overrideAddingLimitations: true });
    await expect(
      app.getActiveSubscriptionPlan({ organizationId: ACME, user: CUSTOMER_ADMIN }),
    ).resolves.toMatchObject({ type: "LAUNCH", overrideAddingLimitations: false });
  });
});

describe("the Stripe callback BillingModule answers", () => {
  const payload = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "account.application.deauthorized",
    data: { object: { id: "ca_1", object: "application" } },
  });
  const rawBody = new TextEncoder().encode(payload);

  describe("given a hosted deployment with Stripe and its signing secret", () => {
    /** @scenario "A signed delivery is acknowledged" */
    it("acknowledges a delivery signed with that secret", async () => {
      const { app } = billingApp({
        isSaas: true,
        withStripe: true,
        webhookSecret: "whsec_fixture",
      });
      const signature = MemoryStripeWebhooksChannel.sign({
        payload,
        secret: "whsec_fixture",
      });

      await expect(app.receiveStripeWebhook({ rawBody, signature })).resolves.toEqual({
        received: true,
      });
    });

    it("refuses a delivery signed with another secret", async () => {
      const { app } = billingApp({
        isSaas: true,
        withStripe: true,
        webhookSecret: "whsec_fixture",
      });
      const signature = MemoryStripeWebhooksChannel.sign({
        payload,
        secret: "whsec_other",
      });

      await expect(app.receiveStripeWebhook({ rawBody, signature })).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe("given the module's declaration and a deployment that bills or does not", () => {
    /** @scenario "The Stripe webhook route is declared on a deployment that bills" */
    it("declares the callback in the module whichever deployment composes it", async () => {
      const billing = billingApp({
        isSaas: true,
        withStripe: true,
        webhookSecret: "whsec_fixture",
      });
      const notBilling = billingApp({ isSaas: false, withStripe: false });
      const signature = MemoryStripeWebhooksChannel.sign({
        payload,
        secret: "whsec_fixture",
      });

      expect(billingProcessModule.transports).toContain(billingStripeWebhookRest);
      await expect(billing.app.receiveStripeWebhook({ rawBody, signature })).resolves.toEqual({
        received: true,
      });
      await expect(
        notBilling.app.receiveStripeWebhook({ rawBody, signature }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("given a deployment with no Stripe key", () => {
    it("answers 404, as main did off SaaS", async () => {
      const { app } = billingApp({ isSaas: true, withStripe: false });

      await expect(
        app.receiveStripeWebhook({ rawBody, signature: "t=1,v1=abc" }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});

describe("the currency BillingModule detects", () => {
  describe("given LangWatch Cloud", () => {
    /** @scenario "LangWatch Cloud detects the currency a reader's prices are shown in" */
    it("answers from the request, falling back when nothing names a country", () => {
      const { app } = billingApp({ isSaas: true, withStripe: false });

      expect(app.detectCurrency({ headers: {} })).toEqual({ currency: "EUR", country: null });
    });
  });

  describe("given a self-hosted deployment", () => {
    /** @scenario "A self-hosted deployment serves no currency detection" */
    it("serves no detection, as main mounted none", () => {
      const { app } = billingApp({ isSaas: false, withStripe: false });

      expect(() => app.detectCurrency({ headers: {} })).toThrow(
        expect.objectContaining({ code: "not_found", httpStatus: 404 }),
      );
    });
  });
});

describe("the subscription door BillingModule serves", () => {
  describe("given a deployment that composed no subscription door", () => {
    it("answers not found, as main mounted no subscription router there", async () => {
      const { app } = billingApp({ isSaas: false, withStripe: false });

      await expect(app.listInvoices({ organizationId: ACME })).rejects.toMatchObject({
        code: "not_found",
        httpStatus: 404,
      });
    });
  });
});
