/**
 * @vitest-environment node
 * @see ../../../../../../../specs/billing/over-plan-trace-withholding.feature
 * The over-plan columns on Subscription against a real Postgres: a mark reads back while open
 * and ends once.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOverPlanRepository } from "../prisma.over-plan.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const CUTOFF = Temporal.Instant.from("2026-11-20T09:00:00Z");

describe.skipIf(!DB_URL)("PrismaOverPlanRepository", () => {
  const ns = `over-plan-${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:over-plan"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const marks = PrismaOverPlanRepository.create(prisma);
  let organizationId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
    const subscription = await prisma.subscription.create({
      data: {
        organizationId,
        plan: "GROWTH_SEAT_EUR_MONTHLY",
        status: "CANCELLED",
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

  describe("when a cancelled subscription is marked and later ended", () => {
    /** @scenario "The over-plan mark is stored on the subscription and read back while open" */
    it("reads the mark with its cutoff while open and none once ended", async () => {
      expect(await marks.findOpenForOrganization(organizationId)).toEqual([]);

      await marks.mark({ subscriptionId, since: CUTOFF });

      const [open] = await marks.findOpenForOrganization(organizationId);
      expect(open).toMatchObject({ subscriptionId, organizationId });
      expect(open!.since.toString()).toBe(CUTOFF.toString());
      expect((await marks.findOpen()).map((mark) => mark.subscriptionId)).toContain(subscriptionId);

      const ended = await marks.end({ subscriptionId, endedAt: CUTOFF.add({ hours: 3 }) });
      const endedAgain = await marks.end({ subscriptionId, endedAt: CUTOFF.add({ hours: 4 }) });

      expect([ended, endedAgain]).toEqual([true, false]);
      expect(await marks.findOpenForOrganization(organizationId)).toEqual([]);
    });
  });
});
