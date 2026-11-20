// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's plan copy through the tenancy guards: the conditional write is the fold rule in SQL.
 * Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaNurturingOrganizationPlanRepository } from "../prisma.nurturing-organization-plan.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-plan-${randomUUID()}`;
const realFirst = `${namespace}-real`;
const catchUpFirst = `${namespace}-catch-up`;

describe.skipIf(!databaseUrl)("given nurturing's plan copy", () => {
  let connection: PrismaConnection;
  let plans: PrismaNurturingOrganizationPlanRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:plans"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    plans = PrismaNurturingOrganizationPlanRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const organizationId of [realFirst, catchUpFirst]) {
      await connection.client.nurturingOrganizationPlan.deleteMany({ where: { organizationId } });
    }
    await connection.closeOnce();
  });

  it("keeps the newest fact: an older or tied catch-up loses, a newer catch-up wins", async () => {
    const record = (plan: string, occurredAt: number, fromCatchUp: boolean) =>
      plans.recordPlan({ organizationId: realFirst, fact: { plan, occurredAt, fromCatchUp } });
    const held = () => plans.findPlan({ organizationId: realFirst });

    await record("LAUNCH", 2_000, false);
    await record("FREE", 1_000, false);
    await record("FREE", 2_000, true);

    await expect(held()).resolves.toEqual({
      outcome: "held",
      fact: { plan: "LAUNCH", occurredAt: 2_000, fromCatchUp: false },
    });

    await record("GROWTH", 3_000, true);

    await expect(held()).resolves.toEqual({
      outcome: "held",
      fact: { plan: "GROWTH", occurredAt: 3_000, fromCatchUp: true },
    });
  });

  it("gives a tie to a real fact over a held catch-up", async () => {
    await plans.recordPlan({
      organizationId: catchUpFirst,
      fact: { plan: "FREE", occurredAt: 1_000, fromCatchUp: true },
    });
    await plans.recordPlan({
      organizationId: catchUpFirst,
      fact: { plan: "LAUNCH", occurredAt: 1_000, fromCatchUp: false },
    });

    await expect(plans.findPlan({ organizationId: catchUpFirst })).resolves.toEqual({
      outcome: "held",
      fact: { plan: "LAUNCH", occurredAt: 1_000, fromCatchUp: false },
    });
  });
});
