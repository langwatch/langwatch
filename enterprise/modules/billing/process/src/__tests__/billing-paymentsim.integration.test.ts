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
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { type ConnectedBillingPeers, BillingModule } from "../app/billing.app.ts";
import { createStripeUsageReporting } from "../billing.module.ts";
import { composeHttpBillingStripe } from "../channels/http/http.billing-stripe.channels.ts";
import { HttpStripeWebhooksChannel } from "../channels/http/http.billing.channels.ts";
import { MemoryBillingWebhookHostChannel } from "../channels/memory/memory.billing-webhook-host.channel.ts";
import { MemoryBillingOrganizationRepository } from "../repositories/memory/memory.billing-account-facts.repository.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingRepositories } from "../repositories/memory/memory.billing.repositories.ts";
import { MemoryBillingStore } from "../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../repositories/memory/memory.subscription.repository.ts";
import type { ResourceLimitAlertService } from "../services/resource-limit-alert.service.ts";
import type { UsageWarningService } from "../services/usage-warning.service.ts";
import { billingStripeWebhookRest } from "../transport/billing-stripe-webhook.rest.ts";

const SECRET_KEY = "sk_test_paymentsim";
const WEBHOOK_SECRET = "whsec_paymentsim";
const LAUNCH_PRICE = "price_1R9LHnIMsTw08cudoc9eO4L8";
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
