/**
 * @vitest-environment node
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 * Two retirements of one tiered row: the one parked on the row lock re-checks it and returns
 * nothing to cancel in Stripe. Against a real Postgres.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { raceOnOneRow } from "@langwatch/test-harness/row-lock-race";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaBillingSubscriptionRepository } from "../prisma.subscription.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaBillingSubscriptionRepository.migrateToSeatEvent", () => {
  const ns = `seat-retire-${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:migrate-to-seat-event"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const subscriptions = PrismaBillingSubscriptionRepository.create(prisma);
  let organizationId: string;
  let tieredId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
    const tiered = await prisma.subscription.create({
      data: {
        organizationId,
        plan: "LAUNCH",
        status: "ACTIVE",
        stripeSubscriptionId: `sub_${ns}_tiered`,
      },
    });
    tieredId = tiered.id;
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("when one run retires the tiered row", () => {
    /** @scenario "A retirement cancels the live tiered subscription and hands it to Stripe" */
    it("cancels the row and returns it for cancellation in Stripe", async () => {
      await prisma.subscription.update({ where: { id: tieredId }, data: { status: "ACTIVE" } });

      const retired = await subscriptions.migrateToSeatEvent({
        organizationId,
        excludeSubscriptionId: `${ns}_growth`,
      });

      expect(retired).toEqual([{ stripeSubscriptionId: `sub_${ns}_tiered` }]);
      const tiered = await prisma.subscription.findUniqueOrThrow({ where: { id: tieredId } });
      expect(tiered.status).toBe("CANCELLED");
      expect(tiered.endDate).not.toBeNull();
    });
  });

  describe("when another run retires the tiered row while this one waits on it", () => {
    /** @scenario "Two retirements at once cancel the tiered subscription in Stripe once" */
    it("returns nothing for this run to cancel in Stripe", async () => {
      await prisma.subscription.update({ where: { id: tieredId }, data: { status: "ACTIVE" } });
      const answers = await raceOnOneRow<{ stripeSubscriptionId: string | null }[]>({
        prisma,
        table: "Subscription",
        first: async (tx) => {
          await tx.subscription.update({ where: { id: tieredId }, data: { status: "CANCELLED" } });
          return [{ stripeSubscriptionId: `sub_${ns}_tiered` }];
        },
        second: () =>
          subscriptions.migrateToSeatEvent({
            organizationId,
            excludeSubscriptionId: `${ns}_growth`,
          }),
      });

      expect(answers.second).toEqual([]);
      const tiered = await prisma.subscription.findUniqueOrThrow({ where: { id: tieredId } });
      expect(tiered.status).toBe("CANCELLED");
    });
  });
});
