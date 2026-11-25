/**
 * The organization's pricing model and currency, read against Postgres.
 * @vitest-environment node
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaOrganizationRepository pricing read", () => {
  const namespace = `pricing-read-${nanoid(8)}`;
  const organizationId = `${namespace}-organization`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:pricing-read"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });

  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: namespace,
        slug: namespace,
        pricingModel: "SEAT_EVENT",
        currency: "USD",
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("when the organization holds a pricing model and currency", () => {
    it("answers both, and no model with the default currency for an unknown organization", async () => {
      expect(await repository.getPricing({ organizationId })).toEqual({
        pricingModel: "SEAT_EVENT",
        currency: "USD",
      });
      expect(await repository.getPricing({ organizationId: `${namespace}-none` })).toEqual({
        pricingModel: null,
        currency: "EUR",
      });
    });
  });
});
