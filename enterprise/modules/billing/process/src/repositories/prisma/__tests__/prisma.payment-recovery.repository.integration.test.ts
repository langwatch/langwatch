/**
 * @vitest-environment node
 * @see ../../../../../specs/payment-recovery.feature
 * The recovery columns on Subscription against a real Postgres: each write lands once, so a
 * redelivered event or a second sweep finds nothing left to do.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaPaymentRecoveryRepository } from "../prisma.payment-recovery.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const DAY_0 = Temporal.Instant.from("2026-11-02T09:00:00Z");

describe.skipIf(!DB_URL)("PrismaPaymentRecoveryRepository", () => {
  const ns = `payment-recovery-${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:payment-recovery"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const recoveries = PrismaPaymentRecoveryRepository.create(prisma);
  let organizationId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
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
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("when the same payment failure is recorded twice", () => {
    /** @scenario "A redelivered payment failure event changes nothing" */
    it("opens the case once and keeps the first day 0", async () => {
      const first = await recoveries.open({ subscriptionId, invoiceId: "in_1", startedAt: DAY_0 });
      const second = await recoveries.open({
        subscriptionId,
        invoiceId: "in_1",
        startedAt: DAY_0.add({ hours: 120 }),
      });

      expect([first, second]).toEqual([true, false]);
      const [open] = await recoveries.findOpenForOrganization(organizationId);
      expect(open).toMatchObject({ invoiceId: "in_1", noticeDay: null });
      expect(open!.startedAt.toString()).toBe(DAY_0.toString());
    });
  });

  describe("when two sweeps advance the same notice", () => {
    /** @scenario "Two sweeps on the same day send a reminder once" */
    it("lets only the first move the notice day", async () => {
      await recoveries.open({ subscriptionId, invoiceId: "in_1", startedAt: DAY_0 });

      const moves = await Promise.all([
        recoveries.advanceNotice({ subscriptionId, from: null, to: 0 }),
        recoveries.advanceNotice({ subscriptionId, from: null, to: 0 }),
      ]);

      expect(moves.toSorted()).toEqual([false, true]);
      const [open] = await recoveries.findOpenForOrganization(organizationId);
      expect(open!.noticeDay).toBe(0);
    });
  });

  describe("when the case is closed", () => {
    /** @scenario "Both paid events of one invoice close the case once" */
    it("closes it once, and leaves a case for another invoice open", async () => {
      await recoveries.open({ subscriptionId, invoiceId: "in_1", startedAt: DAY_0 });

      expect(await recoveries.close({ subscriptionId, invoiceId: "in_other" })).toEqual({
        outcome: "not_open",
      });
      const closed = await recoveries.close({ subscriptionId, invoiceId: "in_1" });
      const again = await recoveries.close({ subscriptionId, invoiceId: "in_1" });

      expect(closed).toMatchObject({ outcome: "closed", closed: { invoiceId: "in_1" } });
      expect(again).toEqual({ outcome: "not_open" });
      expect(await recoveries.findOpenForOrganization(organizationId)).toEqual([]);
      const row = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      expect(row).toMatchObject({
        status: "ACTIVE",
        paymentRecoveryInvoiceId: null,
        paymentRecoveryStartedAt: null,
        paymentRecoveryNoticeDay: null,
      });
    });
  });
});
