// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/licensing/seat-rotation.feature
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

import { PrismaSeatEventSubscriptionRepository } from "../prisma.seat-event-subscription.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaSeatEventSubscriptionRepository seat line repairs", () => {
  const run = `seat_repair_${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:seat-line-repair"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const subscriptions = PrismaSeatEventSubscriptionRepository.create(prisma);
  let organizationId = "";

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${run}` },
    });
    organizationId = organization.id;
  });

  const seed = async (suffix: string) => {
    const id = `${run}_${suffix}`;
    await prisma.subscription.create({
      data: {
        id,
        organizationId,
        plan: "GROWTH_SEAT_EUR_MONTHLY",
        status: "ACTIVE",
        stripeSubscriptionId: `${id}_stripe`,
        maxMembers: 3,
      },
    });
    return id;
  };
  const pendingOfRun = async () =>
    (await subscriptions.findSeatRepairs()).filter((row) => row.id.startsWith(run));

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  /** @scenario "A seat line Stripe refused to put back is recorded for repair" */
  it("records a repair, counts its failures with the Ops flag, and clears it", async () => {
    const id = await seed("lifecycle");

    await subscriptions.recordSeatRepair({ id, quantity: 3 });
    expect(await pendingOfRun()).toEqual([
      {
        id,
        organizationId,
        stripeSubscriptionId: `${id}_stripe`,
        quantity: 3,
        attempts: 0,
        flaggedAt: null,
      },
    ]);

    const flaggedAt = Temporal.Instant.from("2026-11-06T12:00:00Z");
    await subscriptions.recordSeatRepairFailure({ id, quantity: 3, attempts: 5, flaggedAt });
    expect(await pendingOfRun()).toEqual([expect.objectContaining({ id, attempts: 5, flaggedAt })]);

    await subscriptions.clearSeatRepair({ id, quantity: 3 });
    expect(await pendingOfRun()).toEqual([]);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id } })).toMatchObject({
      seatRepairQuantity: null,
      seatRepairSince: null,
      seatRepairAttempts: null,
      seatRepairFlaggedAt: null,
    });
  });

  /** @scenario "A later seat change replaces a pending repair" */
  it("keeps a newer repair when an older pass clears, and a seat change clears any", async () => {
    const id = await seed("newer");

    await subscriptions.recordSeatRepair({ id, quantity: 3 });
    await subscriptions.recordSeatRepair({ id, quantity: 4 });
    await subscriptions.clearSeatRepair({ id, quantity: 3 });
    await subscriptions.recordSeatRepairFailure({ id, quantity: 3, attempts: 9, flaggedAt: null });
    expect(await pendingOfRun()).toEqual([
      expect.objectContaining({ id, quantity: 4, attempts: 0 }),
    ]);

    await subscriptions.reactivateWithSeats({ id, maxMembers: 4, kept: null });
    expect(await pendingOfRun()).toEqual([]);
  });
});
