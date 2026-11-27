/**
 * Billing against paymentsim, the local Stripe stand-in run as the Go dev service: real SDK
 * calls, real signed deliveries into the mounted Stripe callback, over the memory tier.
 * @vitest-environment node
 * @see specs/setup/payment-simulator.feature
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { RestHost } from "@langwatch/api/rest";
import {
  PII_REDACTION_NANO_USD_PER_CHARACTER,
  PII_REDACTION_REQUEST_TYPE,
} from "@langwatch/data-privacy-contract/pii-redaction-spend";
import {
  BILLING_REPORT_COMMAND_TYPES,
  type ReportUsageForMonthCommandData,
} from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { GATEWAY_SPEND_CONFIRMED_EVENT_TYPE } from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { type ConnectedBillingPeers, BillingModule } from "../app/billing.app.ts";
import { createStripeUsageReporting } from "../billing.module.ts";
import { composeHttpBillingStripe } from "../channels/http/http.billing-stripe.channels.ts";
import { HttpStripeWebhooksChannel } from "../channels/http/http.billing.channels.ts";
import { MemoryBillingWebhookHostChannel } from "../channels/memory/memory.billing-webhook-host.channel.ts";
import {
  BILLING_SPEND_CONFIRMED_SUBSCRIBER_NAME,
  BillingReportingPipeline,
} from "../eventing/billing-reporting.pipeline.ts";
import {
  ReportUsageForMonthCommandHandler,
  type ReportUsageForMonthCommandDeps,
} from "../eventing/report-usage-for-month.commands.ts";
import { MemoryBillingOrganizationRepository } from "../repositories/memory/memory.billing-account-facts.repository.ts";
import { MemoryBillingReportOrganizationRepository } from "../repositories/memory/memory.billing-report-organization.repository.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingRepositories } from "../repositories/memory/memory.billing.repositories.ts";
import { MemoryBillingStore } from "../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../repositories/memory/memory.subscription.repository.ts";
import { priceLineOf } from "../rules/price-line.rules.ts";
import { BillingErrorReporter } from "../services/billing-error-reporter.service.ts";
import { PiiRedactionSpendQueryService } from "../services/pii-redaction-spend-query.service.ts";
import type { ResourceLimitAlertService } from "../services/resource-limit-alert.service.ts";
import type { UsageWarningService } from "../services/usage-warning.service.ts";
import { billingStripeWebhookRest } from "../transport/billing-stripe-webhook.rest.ts";

const SECRET_KEY = "sk_test_paymentsim";
const WEBHOOK_SECRET = "whsec_paymentsim";
const LAUNCH_PRICE = "price_1R9LHnIMsTw08cudoc9eO4L8";
const GROWTH_SEAT_USD_MONTHLY = "price_1SzP11IMsTw08cudRhGETYNa";
const GROWTH_PII_REDACTION_USD = "price_1Uat9tIMsTw08cudpWWrZG4a";
const GROWTH_SEAT_EUR_MONTHLY = "price_1SyxCwIMsTw08cudPPOqniRl";
const GROWTH_INSTANT_EVAL_USD = "price_instant_eval_usd_sim";
const INSTANT_EVAL_METER = "mtr_instant_eval_usd_sim";
const GROWTH_INSTANT_EVAL_USD_REPRICED = "price_instant_eval_usd_sim_v2";
const NICKNAMED_LOOKALIKE = "price_instant_eval_lookalike_sim";
const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const CATALOG = fileURLToPath(
  new URL("../../../contract/src/stripe-catalog.json", import.meta.url),
);
// CI's TS jobs set up no Go toolchain, so the suite skips there and runs wherever Go is present.
const goPresent = spawnSync("go", ["version"]).status === 0;

const eventList = z.object({
  events: z.array(
    z.object({
      event: z.object({
        id: z.string(),
        type: z.string(),
        data: z.object({ object: z.looseObject({ customer: z.string().nullish() }) }),
      }),
    }),
  ),
});
const attempts = z.object({ attempts: z.array(z.object({ status: z.number() })) });
const usageTotals = z.object({
  totals: z.array(z.object({ customer: z.string(), value: z.number(), events: z.number() })),
});
const stripeObject = z.looseObject({ id: z.string() });

/** Billing's subscriber on gateway's confirmed spend, as the global registry receives it. */
function confirmedSpendSubscriber({
  reporting,
}: {
  reporting: BillingReportingPipeline;
}): EventSubscriberDefinition<Event> {
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const definition = reporting.buildProcessing({ participation: "produce" });
  for (const projection of definition.globalProjections ?? []) {
    projection.register(
      createApiFixture<Parameters<typeof projection.register>[0]>({
        registerEventSubscriber: (subscriber) => void subscribers.push(subscriber),
      }),
    );
  }
  const lane = `billing_reporting.${BILLING_SPEND_CONFIRMED_SUBSCRIBER_NAME}`;
  const subscriber = subscribers.find(({ name }) => name === lane);
  if (!subscriber) throw new Error("billing registers no confirmed-spend subscriber");
  return subscriber;
}

/** Gateway's confirmed pii_redaction spend for the organization, as the event bus delivers it. */
function piiRedactionSpendConfirmed({ organizationId }: { organizationId: string }): Event {
  const occurredAt = Date.now();
  const tenantId = `${organizationId}-project-1`;
  return {
    id: `evt_spend_${occurredAt}`,
    aggregateId: "gwreq_late",
    aggregateType: "gateway_spend",
    tenantId: createTenantId(tenantId),
    createdAt: occurredAt,
    occurredAt,
    type: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
    version: "2026-01-01",
    data: {
      gateway_request_id: "gwreq_late",
      occurred_at: occurredAt,
      tenantId,
      organization_id: organizationId,
      request_type: PII_REDACTION_REQUEST_TYPE,
      usage: {},
    },
  };
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

describe.skipIf(!goPresent)(
  "billing against paymentsim (skipped where no Go toolchain is on PATH)",
  () => {
    let sim: ChildProcess;
    let receiver: Server;
    let simBase = "";
    const store = MemoryBillingStore.create();
    const subscriptions = MemoryBillingSubscriptionRepository.create(store);

    async function control(path: string, init: { method?: string; body?: unknown } = {}) {
      const response = await fetch(`${simBase}/_sim/api${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: { "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      if (!response.ok) throw new Error(`paymentsim ${path} answered ${response.status}`);
      return response.json();
    }

    async function stripe(path: string, form: Record<string, string>) {
      const response = await fetch(`${simBase}/v1${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET_KEY}` },
        body: new URLSearchParams(form),
      });
      if (!response.ok) throw new Error(`paymentsim ${path} answered ${response.status}`);
      return stripeObject.parse(await response.json());
    }

    /** An organization with a Stripe customer and a PENDING subscription at checkout. */
    async function pendingCheckout(name: string) {
      const customer = (await stripe("/customers", { name })).id;
      store.organizations.set(name, {
        id: name,
        name,
        stripeCustomerId: customer,
        pricingModel: null,
        currency: null,
        selfHostedCustomer: false,
        teamIds: [],
        signupData: {},
      });
      const pending = await subscriptions.createPending({ organizationId: name, plan: "LAUNCH" });
      const session = await stripe("/checkout/sessions", {
        mode: "subscription",
        customer,
        success_url: "http://langwatch.test/settings/subscription",
        client_reference_id: `subscription_setup_${pending.id}`,
        "line_items[0][price]": LAUNCH_PRICE,
        "line_items[0][quantity]": "1",
      });
      await control(`/checkout/${session.id}/complete`, { body: {} });
      return { customer, organizationId: name, subscriptionId: pending.id };
    }

    /** The held events of one customer, oldest first. */
    async function eventsOf(customer: string, type?: string) {
      const { events } = eventList.parse(await control(type ? `/events?type=${type}` : "/events"));
      return events
        .map(({ event }) => event)
        .filter((event) => event.data.object.customer === customer);
    }

    async function deliver(ids: string[], signingSecret?: string) {
      const answer = attempts.parse(
        await control("/events/deliver", {
          body: { ids, ...(signingSecret ? { signingSecret } : {}) },
        }),
      );
      return answer.attempts.map((attempt) => attempt.status);
    }

    async function checkoutCompleted(customer: string) {
      const [completed] = await eventsOf(customer, "checkout.session.completed");
      if (!completed) throw new Error(`no checkout.session.completed for ${customer}`);
      return completed.id;
    }

    beforeAll(async () => {
      const repositories = {
        ...MemoryBillingRepositories.create(),
        organizations: MemoryBillingOrganizationRepository.create(store),
        subscriptions,
        webhookSubscriptions: MemoryBillingWebhookSubscriptionRepository.create({
          subscriptions,
          store,
        }),
        webhookOrganizations: MemoryBillingWebhookOrganizationRepository.create(store),
      };
      const simPort = await freePort();
      simBase = `http://127.0.0.1:${simPort}`;
      const app = BillingModule.assemble({
        repositories,
        config: {
          bankDetails: undefined,
          licensePaymentLinkId: undefined,
          isSaas: true,
          nodeEnvironment: "test",
        },
        peers: {
          licensing: createApiFixture<ConnectedBillingPeers["licensing"]>({}),
          authorization: { can: async () => false },
        },
        stripe: {
          channels: {
            webhooks: HttpStripeWebhooksChannel.create({ signingSecret: WEBHOOK_SECRET }),
            ...composeHttpBillingStripe({
              secretKey: SECRET_KEY,
              nodeEnvironment: "test",
              apiBase: simBase,
            }),
          },
        },
        usageReporting: () =>
          createStripeUsageReporting({
            secretKey: SECRET_KEY,
            nodeEnvironment: "test",
            apiBase: simBase,
          }),
        usageWarnings: createApiFixture<UsageWarningService>({}),
        resourceLimitAlerts: createApiFixture<ResourceLimitAlertService>({}),
        webhook: {
          host: MemoryBillingWebhookHostChannel.create(),
          licenses: createApiFixture<LicensingApi>({
            getLicenseStatus: async () => ({ hasLicense: false, valid: false }),
          }),
        },
      });
      const closed = {
        authenticate: () => {
          throw new Error("the provider callback resolves no credential.");
        },
      };
      const host = RestHost.create({
        authz: restTestAuthorization().forRequest(),
        identities: {
          project: closed,
          organization: closed,
          api_key: closed,
          instance_admin: closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
      });
      host.mount(billingStripeWebhookRest.router(), () => app);

      // paymentsim posts each delivery here; the mounted callback answers it.
      receiver = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          void Promise.resolve(
            host.app.fetch(
              new Request(`http://api.test${request.url ?? "/"}`, {
                method: request.method,
                headers: {
                  "content-type": request.headers["content-type"] ?? "application/json",
                  "stripe-signature": String(request.headers["stripe-signature"] ?? ""),
                },
                body: Buffer.concat(chunks),
              }),
            ),
          ).then(async (answer) => {
            response.writeHead(answer.status).end(await answer.text());
          });
        });
      });
      await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
      const { port: receiverPort } = receiver.address() as AddressInfo;

      sim = spawn("go", ["run", "-tags", "dev", "./cmd/service", "paymentsim"], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PAYMENTSIM_ADDR: `127.0.0.1:${simPort}`,
          PAYMENTSIM_WEBHOOK_URL: `http://127.0.0.1:${receiverPort}/api/webhooks/stripe`,
          PAYMENTSIM_WEBHOOK_SECRET: WEBHOOK_SECRET,
          PAYMENTSIM_CATALOG: CATALOG,
        },
      });
      const deadline = Date.now() + 120_000;
      for (;;) {
        const up = await fetch(`${simBase}/healthz`).then(
          (answer) => answer.ok,
          () => false,
        );
        if (up) break;
        if (Date.now() > deadline) throw new Error("paymentsim did not answer within 120s");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      // Every delivery is driven by hand, so each case controls its order and signature.
      await control("/webhooks/hold", { body: { held: true } });
    }, 180_000);

    afterAll(async () => {
      // `go run` leaves the built binary as a child: the group goes down together.
      if (sim?.pid) process.kill(-sim.pid, "SIGTERM");
      await new Promise((resolve) => (receiver ? receiver.close(resolve) : resolve(undefined)));
    });

    /** @scenario "Billing refuses a delivery with a bad signature" */
    it("answers 400 to a delivery signed with another secret and leaves the subscription pending", async () => {
      const { customer, organizationId } = await pendingCheckout("org-bad-signature");

      const statuses = await deliver([await checkoutCompleted(customer)], "whsec_not_billing");

      expect(statuses).toEqual([400]);
      expect(await subscriptions.findLastNonCancelled(organizationId)).toMatchObject({
        status: "PENDING",
        stripeSubscriptionId: null,
      });
    }, 30_000);

    /** @scenario "A duplicate Stripe event leaves the subscription unchanged" */
    it("leaves an activated subscription unchanged when checkout.session.completed comes again", async () => {
      const { customer, organizationId } = await pendingCheckout("org-duplicate");
      const completed = await checkoutCompleted(customer);
      expect(await deliver([completed])).toEqual([200]);
      const activated = await subscriptions.findLastNonCancelled(organizationId);
      expect(activated).toMatchObject({ status: "ACTIVE" });

      expect(await deliver([completed])).toEqual([200]);

      expect(await subscriptions.findLastNonCancelled(organizationId)).toEqual(activated);
    }, 30_000);

    /** @scenario "Events out of order still activate the subscription" */
    it("ends ACTIVE when the invoice events arrive before checkout.session.completed", async () => {
      const { customer, organizationId } = await pendingCheckout("org-out-of-order");
      const newestFirst = (await eventsOf(customer)).map((event) => event.id).reverse();
      expect(newestFirst.at(-1)).toBe(await checkoutCompleted(customer));

      const statuses = await deliver(newestFirst);

      expect(statuses.every((status) => status === 200)).toBe(true);
      expect(await subscriptions.findLastNonCancelled(organizationId)).toMatchObject({
        status: "ACTIVE",
      });
    }, 60_000);

    /** @scenario "Reported usage reaches the meter exactly once" */
    it("totals a month's billable events once at the meter, and a rerun adds nothing", async () => {
      const customer = (await stripe("/customers", { name: "org-usage" })).id;
      const { now } = z.object({ now: z.number() }).parse(await control("/status"));
      const usage = createStripeUsageReporting({
        secretKey: SECRET_KEY,
        nodeEnvironment: "test",
        apiBase: simBase,
      });
      const run = {
        stripeCustomerId: customer,
        organizationId: "org-usage",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 1234,
            timestamp: now,
            identifier: "org-usage:2026-09:billable_events",
            previouslyReportedValue: 0,
          },
        ],
      };

      await usage.reportUsageSet(run);
      await usage.reportUsageSet(run);

      const { totals } = usageTotals.parse(await control(`/usage?customer=${customer}`));
      expect(totals).toEqual([expect.objectContaining({ value: 1234, events: 1 })]);
    }, 30_000);

    /**
     * A usage-billed organization on a Growth subscription in dollars, with or without the PII
     * redaction line at the provider, whose ledger holds `nanoUsd` of pii_redaction rows.
     */
    async function piiRedactionCustomer({
      organizationId,
      withPiiRedactionLine,
      nanoUsd,
    }: {
      organizationId: string;
      withPiiRedactionLine: boolean;
      nanoUsd: number;
    }) {
      const customer = (await stripe("/customers", { name: organizationId })).id;
      store.organizations.set(organizationId, {
        id: organizationId,
        name: organizationId,
        stripeCustomerId: customer,
        pricingModel: "SEAT_EVENT",
        currency: "USD",
        selfHostedCustomer: false,
        teamIds: [],
        signupData: {},
      });
      const pending = await subscriptions.createPending({
        organizationId,
        plan: "GROWTH_SEAT_USD_MONTHLY",
      });
      await subscriptions.updateStatus({ id: pending.id, status: "ACTIVE" });
      const session = await stripe("/checkout/sessions", {
        mode: "subscription",
        customer,
        success_url: "http://langwatch.test/settings/subscription",
        "line_items[0][price]": GROWTH_SEAT_USD_MONTHLY,
        "line_items[0][quantity]": "1",
        ...(withPiiRedactionLine ? { "line_items[1][price]": GROWTH_PII_REDACTION_USD } : {}),
      });
      const completed = z
        .object({ subscription: z.string() })
        .parse(await control(`/checkout/${session.id}/complete`, { body: {} }));
      const stripeChannels = composeHttpBillingStripe({
        secretKey: SECRET_KEY,
        nodeEnvironment: "test",
        apiBase: simBase,
      });
      const repositories = MemoryBillingRepositories.create();
      const errors: Error[] = [];
      const errorReporter = new (class extends BillingErrorReporter {
        capture(error: Error): void {
          errors.push(error);
        }
      })();
      const ledgerReads: { requestType: string }[] = [];
      const windowStarts: (number | undefined)[] = [];
      const ledger = { nanoUsd };
      const piiRedactionSpend = PiiRedactionSpendQueryService.create({
        isSpendSourceAvailable: () => true,
        listProjectIds: async () => [`${organizationId}-project-1`, `${organizationId}-project-2`],
        sumSpendNanoUsdByRequestType: async (input) => {
          ledgerReads.push({ requestType: input.requestType });
          windowStarts.push(input.fromMs);
          return ledger.nanoUsd;
        },
      });
      const reportDeps: Omit<ReportUsageForMonthCommandDeps, "selfDispatch"> = {
        organizations: MemoryBillingReportOrganizationRepository.create(store),
        billingCheckpoints: repositories.checkpoints,
        organizationCache: repositories.organizationCache,
        getUsageReportingService: () =>
          createStripeUsageReporting({
            secretKey: SECRET_KEY,
            nodeEnvironment: "test",
            apiBase: simBase,
          }),
        queryInstantEvalSpendTotal: async () => ({ outcome: "unavailable" }),
        isInstantEvalMeterProvisioned: () => false,
        queryPiiRedactionSpendTotal: (input) =>
          piiRedactionSpend.queryPiiRedactionSpendTotal(input),
        isPiiRedactionMeterProvisioned: () => true,
        subscriptionPriceLine: async ({ stripeCustomerId, price, billingMonth }) =>
          priceLineOf({
            subscriptions: await stripeChannels.subscriptions.listCustomerSubscriptions({
              customerId: stripeCustomerId,
            }),
            prices: [
              {
                priceName: price,
                priceId:
                  price === "GROWTH_PII_REDACTION_USD" ? GROWTH_PII_REDACTION_USD : undefined,
              },
            ],
            billingMonth,
          }),
        errorReporter,
        connectedUsageCeiling: async () => null,
      };
      // Every report the roll-up dispatches, from the spend subscriber or from a report itself.
      const dispatched: ReportUsageForMonthCommandData[] = [];
      const handler = ReportUsageForMonthCommandHandler.create({
        ...reportDeps,
        selfDispatch: async (data) => void dispatched.push(data),
      });
      const reporting = BillingReportingPipeline.create({
        ...reportDeps,
        usageWarnings: createApiFixture<UsageWarningService>({}),
      });
      reporting.connectSelfDispatch(async (data) => void dispatched.push(data));
      const spendSubscriber = confirmedSpendSubscriber({ reporting });
      const now = new Date();
      const billingMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const run = (data: ReportUsageForMonthCommandData) =>
        handler.handle({
          tenantId: createTenantId(organizationId),
          aggregateId: organizationId,
          type: BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
          data,
        });
      const reportMonth = () =>
        run({ organizationId, billingMonth, tenantId: organizationId, occurredAt: Date.now() });
      const confirmSpend = () =>
        spendSubscriber.handle(piiRedactionSpendConfirmed({ organizationId }), {
          tenantId: `${organizationId}-project-1`,
          aggregateId: "gwreq_late",
        });
      const piiUsage = async () =>
        usageTotals.parse(
          await control(`/usage?customer=${customer}&event_name=langwatch_pii_redaction_usd`),
        ).totals;
      const subscriptionLines = async () =>
        (
          await stripeChannels.subscriptions.getSubscription({
            subscriptionId: completed.subscription,
          })
        ).items;
      return {
        subscription: completed.subscription,
        reportMonth,
        piiUsage,
        subscriptionLines,
        windowStarts,
        errors,
        ledgerReads,
        ledger,
        dispatched,
        confirmSpend,
        run,
      };
    }

    /** @scenario "The month's PII redaction total reaches the Stripe simulator" */
    /** @scenario "Usage is held while the subscription carries no PII redaction price" */
    it("holds the month until the subscription carries the PII redaction price, then reports it once", async () => {
      // A Growth subscription at the provider bought before the PII redaction price existed,
      // with 0.60 + 0.5234 dollars of pii_redaction rows across its two projects.
      const customer = await piiRedactionCustomer({
        organizationId: "org-pii",
        withPiiRedactionLine: false,
        nanoUsd: 1_123_400_000,
      });

      await customer.reportMonth();
      expect(await customer.piiUsage()).toEqual([]);

      await stripe(`/subscriptions/${customer.subscription}`, {
        "items[0][price]": GROWTH_PII_REDACTION_USD,
      });
      await customer.reportMonth();
      await customer.reportMonth();

      expect(customer.errors).toEqual([]);
      // The held run reads the ledger too, to log what it holds.
      expect(customer.ledgerReads).toEqual([
        { requestType: "pii_redaction" },
        { requestType: "pii_redaction" },
        { requestType: "pii_redaction" },
      ]);
      expect(await customer.piiUsage()).toEqual([
        expect.objectContaining({ value: 1.1234, events: 1 }),
      ]);
      // Once the line is there, the month is read from no earlier than the provider says it was
      // added (the seat start, to the millisecond, can sit inside that second).
      const lines = await customer.subscriptionLines();
      const piiLine = lines.find(({ priceId }) => priceId === GROWTH_PII_REDACTION_USD);
      expect(piiLine).toMatchObject({ createdAt: expect.any(Number) });
      expect(Math.min(...customer.windowStarts.slice(1).map(Number))).toBeGreaterThanOrEqual(
        Number(piiLine?.createdAt) * 1000,
      );
    }, 30_000);

    /** @scenario "Spend confirmed after the month's last trace is invoiced through the Stripe simulator" */
    /** @scenario "PII redaction spend after the month's last trace reaches the Stripe simulator" */
    it("invoices PII redaction spend confirmed after the month's last trace, with no later trace", async () => {
      const customer = await piiRedactionCustomer({
        organizationId: "org-pii-late",
        withPiiRedactionLine: true,
        nanoUsd: 600_000_000,
      });
      // The month's last trace was counted and reported: 0.60 dollars so far.
      await customer.reportMonth();
      expect(await customer.piiUsage()).toEqual([expect.objectContaining({ value: 0.6 })]);
      customer.dispatched.length = 0;

      // A redaction confirmed after it; gateway has not written its ledger row yet.
      await customer.confirmSpend();
      const [spendReport] = customer.dispatched;
      expect(spendReport?.trigger).toBe("spend_confirmed");
      await customer.run(spendReport!);
      expect(await customer.piiUsage()).toEqual([expect.objectContaining({ value: 0.6 })]);

      // The row lands within the follow-up's delay, and no trace ever follows.
      customer.ledger.nanoUsd = 1_123_400_000;
      const followUps = customer.dispatched.filter(({ trigger }) => trigger === "spend_follow_up");
      expect(followUps).toHaveLength(1);
      await customer.run(followUps[0]!);

      expect(customer.errors).toEqual([]);
      expect(await customer.piiUsage()).toEqual([
        expect.objectContaining({ value: 1.1234, events: 2 }),
      ]);
      expect(
        customer.dispatched.filter(({ trigger }) => trigger === "spend_follow_up"),
      ).toHaveLength(1);
    }, 30_000);

    /** @scenario "A paying organization's month reaches Stripe at 0.50 dollars per million characters" */
    it("sends a paying organization's whole month at the published rate, nothing taken off", async () => {
      // 250 long spans of 7,900 characters and 1,000 simple ones of 120, all answered by the model.
      const characters = 2_095_000;
      const customer = await piiRedactionCustomer({
        organizationId: "org-pii-paying",
        withPiiRedactionLine: true,
        nanoUsd: characters * PII_REDACTION_NANO_USD_PER_CHARACTER,
      });

      await customer.reportMonth();

      expect(customer.errors).toEqual([]);
      expect(await customer.piiUsage()).toEqual([
        expect.objectContaining({ value: 1.0475, events: 1 }),
      ]);
    }, 30_000);

    /** @scenario "A free organization's month sends nothing to Stripe" */
    it("sends a free organization nothing when every row of its month is priced at zero", async () => {
      const customer = await piiRedactionCustomer({
        organizationId: "org-pii-free",
        withPiiRedactionLine: true,
        nanoUsd: 0,
      });

      await customer.reportMonth();

      expect(customer.errors).toEqual([]);
      expect(customer.ledgerReads).toEqual([{ requestType: "pii_redaction" }]);
      expect(await customer.piiUsage()).toEqual([]);
    }, 30_000);

    /** @scenario "Only a subscription with the Instant Evals price reaches the Stripe simulator" */
    /** @scenario "A re-priced Instant Evals line is still recognised" */
    it("reports Instant Eval usage only to the subscription that carries its price", async () => {
      // The catalog maps no Instant Evals meter or price in test mode yet, so both are seeded here.
      await control("/meters", {
        body: { id: INSTANT_EVAL_METER, event_name: "langwatch_instant_eval_usd" },
      });
      await control("/prices", {
        body: {
          id: GROWTH_INSTANT_EVAL_USD,
          currency: "usd",
          unit_amount: 100,
          interval: "month",
          usage_type: "metered",
          meter: INSTANT_EVAL_METER,
          lookup_key: "GROWTH_INSTANT_EVAL_USD",
        },
      });
      // A re-price under the same keys with another nickname, and a price only named alike.
      await control("/prices", {
        body: {
          id: GROWTH_INSTANT_EVAL_USD_REPRICED,
          currency: "usd",
          unit_amount: 120,
          interval: "month",
          usage_type: "metered",
          meter: INSTANT_EVAL_METER,
          lookup_key: "GROWTH_INSTANT_EVAL_USD",
          nickname: "Instant Evals, renamed in the dashboard",
          metadata: { langwatch_key: "GROWTH_INSTANT_EVAL_USD" },
        },
      });
      await control("/prices", {
        body: {
          id: NICKNAMED_LOOKALIKE,
          currency: "usd",
          unit_amount: 100,
          interval: "month",
          usage_type: "metered",
          meter: INSTANT_EVAL_METER,
          nickname: "GROWTH_INSTANT_EVAL_USD",
        },
      });
      const growth = async ({
        organizationId,
        currency,
        lines,
      }: {
        organizationId: string;
        currency: "USD" | "EUR";
        lines: string[];
      }) => {
        const customer = (await stripe("/customers", { name: organizationId })).id;
        store.organizations.set(organizationId, {
          id: organizationId,
          name: organizationId,
          stripeCustomerId: customer,
          pricingModel: "SEAT_EVENT",
          currency,
          selfHostedCustomer: false,
          teamIds: [],
          signupData: {},
        });
        const pending = await subscriptions.createPending({
          organizationId,
          plan: `GROWTH_SEAT_${currency}_MONTHLY`,
        });
        await subscriptions.updateStatus({ id: pending.id, status: "ACTIVE" });
        const session = await stripe("/checkout/sessions", {
          mode: "subscription",
          customer,
          success_url: "http://langwatch.test/settings/subscription",
          ...Object.fromEntries(
            lines.map((price, index) => [`line_items[${index}][price]`, price]),
          ),
          "line_items[0][quantity]": "1",
        });
        await control(`/checkout/${session.id}/complete`, { body: {} });
        return customer;
      };
      // Bought before the Instant Evals price existed, a euro plan, and a paying dollar plan.
      const oldUsd = await growth({
        organizationId: "org-instant-old-usd",
        currency: "USD",
        lines: [GROWTH_SEAT_USD_MONTHLY],
      });
      const eur = await growth({
        organizationId: "org-instant-eur",
        currency: "EUR",
        lines: [GROWTH_SEAT_EUR_MONTHLY],
      });
      const paying = await growth({
        organizationId: "org-instant-paying",
        currency: "USD",
        lines: [GROWTH_SEAT_USD_MONTHLY, GROWTH_INSTANT_EVAL_USD],
      });
      const repriced = await growth({
        organizationId: "org-instant-repriced",
        currency: "USD",
        lines: [GROWTH_SEAT_USD_MONTHLY, GROWTH_INSTANT_EVAL_USD_REPRICED],
      });
      const lookalike = await growth({
        organizationId: "org-instant-lookalike",
        currency: "USD",
        lines: [GROWTH_SEAT_USD_MONTHLY, NICKNAMED_LOOKALIKE],
      });
      // The month's Instant Eval spend in the meter's units: 0.30, 0.30, 5.0428, 0.30 and 0.30.
      const spend: Record<string, number> = {
        "org-instant-old-usd": 3_000,
        "org-instant-eur": 3_000,
        "org-instant-paying": 50_428,
        "org-instant-repriced": 3_000,
        "org-instant-lookalike": 3_000,
      };
      const stripeChannels = composeHttpBillingStripe({
        secretKey: SECRET_KEY,
        nodeEnvironment: "test",
        apiBase: simBase,
      });
      const repositories = MemoryBillingRepositories.create();
      const errors: Error[] = [];
      const handler = ReportUsageForMonthCommandHandler.create({
        organizations: MemoryBillingReportOrganizationRepository.create(store),
        billingCheckpoints: repositories.checkpoints,
        organizationCache: repositories.organizationCache,
        getUsageReportingService: () =>
          createStripeUsageReporting({
            secretKey: SECRET_KEY,
            nodeEnvironment: "test",
            apiBase: simBase,
          }),
        queryInstantEvalSpendTotal: async ({ organizationId }) => ({
          outcome: "counted",
          total: spend[organizationId] ?? 0,
        }),
        isInstantEvalMeterProvisioned: () => true,
        queryPiiRedactionSpendTotal: async () => ({ outcome: "unavailable" }),
        isPiiRedactionMeterProvisioned: () => false,
        subscriptionPriceLine: async ({ stripeCustomerId, price, billingMonth }) =>
          priceLineOf({
            subscriptions: await stripeChannels.subscriptions.listCustomerSubscriptions({
              customerId: stripeCustomerId,
            }),
            prices: [
              {
                priceName: price,
                priceId: price === "GROWTH_INSTANT_EVAL_USD" ? GROWTH_INSTANT_EVAL_USD : undefined,
              },
            ],
            billingMonth,
          }),
        selfDispatch: async () => {},
        errorReporter: new (class extends BillingErrorReporter {
          capture(error: Error): void {
            errors.push(error);
          }
        })(),
        connectedUsageCeiling: async () => null,
      });
      const now = new Date();
      const billingMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const instantUsage = async (customer: string) =>
        usageTotals.parse(
          await control(`/usage?customer=${customer}&event_name=langwatch_instant_eval_usd`),
        ).totals;

      for (const organizationId of Object.keys(spend)) {
        await handler.handle({
          tenantId: createTenantId(organizationId),
          aggregateId: organizationId,
          type: BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
          data: { organizationId, billingMonth, tenantId: organizationId, occurredAt: Date.now() },
        });
      }

      expect(errors).toEqual([]);
      expect(await instantUsage(oldUsd)).toEqual([]);
      expect(await instantUsage(eur)).toEqual([]);
      expect(await instantUsage(paying)).toEqual([
        expect.objectContaining({ value: 5.0428, events: 1 }),
      ]);
      expect(await instantUsage(repriced)).toEqual([
        expect.objectContaining({ value: 0.3, events: 1 }),
      ]);
      expect(await instantUsage(lookalike)).toEqual([]);
    }, 30_000);

    /** @scenario "A failed renewal payment is recorded" */
    it("records the declined renewal on the subscription", async () => {
      const { customer, organizationId } = await pendingCheckout("org-renewal-declined");
      expect(await deliver([await checkoutCompleted(customer)])).toEqual([200]);
      await control("/payment-failures", { body: { customer } });

      // Last: the clock is shared, and moving it renews every subscription paymentsim holds.
      await control("/clock/advance", { body: { seconds: 32 * 24 * 60 * 60 } });
      const failed = await eventsOf(customer, "invoice.payment_failed");
      expect(failed).toHaveLength(1);
      expect(await deliver(failed.map((event) => event.id))).toEqual([200]);

      const recorded = await subscriptions.findLastNonCancelled(organizationId);
      expect(recorded?.lastPaymentFailedDate).not.toBeNull();
    }, 30_000);
  },
);
