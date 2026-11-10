/**
 * @vitest-environment node
 * @see ../../../../specs/payment-recovery.feature
 * The recovery service over the Prisma repositories and the production tenancy guard: a paused
 * case heals on the sweep, and the day 3 email lands on the subscription that failed.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { Temporal, type Instant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryPaymentRecoveryEmailChannel } from "../../channels/memory/memory.billing.channels.ts";
import { MemoryStripeInvoicesChannel } from "../../channels/memory/memory.stripe-invoices.channel.ts";
import { PrismaBillingOrganizationRepository } from "../../repositories/prisma/prisma.billing-account-facts.repository.ts";
import { PrismaBillingWebhookSubscriptionRepository } from "../../repositories/prisma/prisma.billing-webhook-subscription.repository.ts";
import { PrismaPaymentRecoveryRepository } from "../../repositories/prisma/prisma.payment-recovery.repository.ts";
import { PrismaBillingSubscriptionRepository } from "../../repositories/prisma/prisma.subscription.repository.ts";
import { PaymentRecoveryService, type RecoveryInvoice } from "../payment-recovery.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const DAY_0 = Temporal.Instant.from("2026-11-02T09:00:00Z");

function dayOf(days: number, hours = 0): Instant {
  return DAY_0.add({ hours: days * 24 + hours });
}

describe.skipIf(!DB_URL)("PaymentRecoveryService over Postgres", () => {
  const ns = `payment-recovery-svc-${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:payment-recovery-service"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const recoveries = PrismaPaymentRecoveryRepository.create(prisma);
  let organizationId: string;
  let userId: string;
  let subscriptionId: string;
  let now: Instant;
  let invoices: MemoryStripeInvoicesChannel;
  let emails: MemoryPaymentRecoveryEmailChannel;
  let service: PaymentRecoveryService;

  const renewal = (): RecoveryInvoice => ({
    id: `in_${ns}`,
    subscriptionId: `sub_${ns}`,
    collectionMethod: "charge_automatically",
    billingReason: "subscription_cycle",
    amountDue: 28072,
    currency: "eur",
    number: "LW-0042",
    created: DAY_0.epochMilliseconds / 1000,
  });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
    const user = await prisma.user.create({ data: { name: "Ana", email: `ana-${ns}@acme.test` } });
    userId = user.id;
    await prisma.organizationUser.create({ data: { organizationId, userId, role: "ADMIN" } });
  });

  beforeEach(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId } });
    const subscription = await prisma.subscription.create({
      data: {
        organizationId,
        plan: "GROWTH_SEAT_EUR_MONTHLY",
        status: "ACTIVE",
        stripeSubscriptionId: `sub_${ns}`,
      },
    });
    subscriptionId = subscription.id;
    now = DAY_0;
    invoices = MemoryStripeInvoicesChannel.create();
    invoices.seed({
      invoice: {
        id: renewal().id,
        customerId: "cus_1",
        number: "LW-0042",
        created: renewal().created,
        amountDue: 28072,
        currency: "eur",
        status: "open",
        pdfUrl: null,
        hostedUrl: "https://invoice.stripe.test/in_renewal",
      },
      card: { brand: "Visa", last4: "4242" },
    });
    emails = MemoryPaymentRecoveryEmailChannel.create();
    service = PaymentRecoveryService.create({
      recoveries,
      subscriptions: PrismaBillingWebhookSubscriptionRepository.create({
        subscriptions: PrismaBillingSubscriptionRepository.create(prisma),
      }),
      organizations: PrismaBillingOrganizationRepository.create(prisma),
      invoices,
      emails,
      alerts: {
        sendSlackAccountPaymentFailed: async () => {
          throw new Error("no enterprise organization in this suite");
        },
      },
      publicBaseUrl: "https://app.langwatch.test",
      now: () => now,
    });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("given a case paused on day 21 whose paid event never arrived", () => {
    /** @scenario "A paused case whose paid event never arrived closes on the next sweep" */
    it("closes the row on the next sweep and sends one restored email", async () => {
      await service.paymentFailed({ invoice: renewal() });
      now = dayOf(3, 1);
      await service.sweep();
      now = dayOf(21, 1);
      await service.sweep();
      expect(await service.summary({ organizationId })).toEqual({ state: "paused" });
      invoices.settle({ invoiceId: renewal().id, status: "paid" });
      now = dayOf(26);

      await service.sweep();
      await service.sweep();

      const row = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      expect(row).toMatchObject({
        status: "ACTIVE",
        paymentRecoveryInvoiceId: null,
        paymentRecoveryStartedAt: null,
        paymentRecoveryNoticeDay: null,
      });
      expect(emails.sent.map((sent) => sent.email.kind)).toEqual(["failed", "paused", "restored"]);
      expect(emails.sent[0]!.email.accessStopsOn).toBe("23 November 2026");
    });
  });

  describe("given an older open case on another subscription of the organization", () => {
    /** @scenario "The first email belongs to the subscription that failed" */
    it("records day 3 on the failing subscription and leaves the older case's notice day", async () => {
      const older = await prisma.subscription.create({
        data: {
          organizationId,
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          status: "ACTIVE",
          stripeSubscriptionId: `sub_old_${ns}`,
        },
      });
      await recoveries.open({
        subscriptionId: older.id,
        invoiceId: "in_old",
        startedAt: dayOf(-4),
      });
      await recoveries.advanceNotice({ subscriptionId: older.id, from: null, to: 3 });

      await service.paymentFailed({ invoice: renewal() });
      now = dayOf(3, 1);
      await service.sweep();

      const [current] = await recoveries.findOpenForSubscription(subscriptionId);
      const [previous] = await recoveries.findOpenForSubscription(older.id);
      expect(current).toMatchObject({ invoiceId: renewal().id, noticeDay: 3 });
      expect(previous).toMatchObject({ invoiceId: "in_old", noticeDay: 3 });
      expect(emails.sent.map((sent) => sent.email.kind)).toEqual(["failed"]);
    });
  });
});
