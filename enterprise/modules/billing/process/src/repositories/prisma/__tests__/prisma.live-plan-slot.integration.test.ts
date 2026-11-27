// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Billing's answer to another module's subscription write, over a real Postgres.
 * @see ../../../../../specs/billing.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LivePlanSlotService } from "../../../services/live-plan-slot.service.ts";
import { PrismaBillingSubscriptionRepository } from "../prisma.subscription.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("billing's one-live-plan answer on Postgres", () => {
  const run = `live_slot_${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:live-plan-slot"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const service = LivePlanSlotService.create({
    subscriptions: PrismaBillingSubscriptionRepository.create(prisma),
  });
  let organizationId = "";

  beforeAll(async () => {
    ({ id: organizationId } = await prisma.organization.create({
      data: { name: "ACME", slug: `--${run}` },
    }));
    await prisma.subscription.createMany({
      data: [
        {
          id: `${run}_seat`,
          organizationId,
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          status: "ACTIVE",
          stripeSubscriptionId: `${run}_s_seat`,
        },
        {
          id: `${run}_tiered`,
          organizationId,
          plan: "LAUNCH",
          status: "ACTIVE",
          stripeSubscriptionId: `${run}_s_tiered`,
        },
        {
          id: `${run}_pending`,
          organizationId,
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          status: "PENDING",
          stripeSubscriptionId: `${run}_s_pending`,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  /** @scenario "Billing refuses another module's write that would start a second live plan" */
  it("refuses activating a second linked plan, naming only the live seat plan", async () => {
    await expect(
      service.assertWriteAllowed({ writes: [{ id: `${run}_pending`, status: "ACTIVE" }] }),
    ).rejects.toMatchObject({
      code: "subscription_already_active",
      meta: { organizationId, liveSubscriptionIds: [`${run}_seat`] },
    });
  });

  /** @scenario "Billing refuses another module's write that would start a second live plan" */
  it("allows an edit to the tiered plan and to the live seat plan", async () => {
    await expect(
      service.assertWriteAllowed({
        writes: [
          { id: `${run}_tiered`, status: "ACTIVE" },
          { id: `${run}_seat`, status: "ACTIVE" },
        ],
      }),
    ).resolves.toBeUndefined();
  });
});
