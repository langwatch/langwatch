/**
 * @vitest-environment node
 * @see specs/billing/stripe-customer.feature
 * A claim parked on another checkout's row lock re-checks the committed row and loses: billing's
 * one admitted write on organization's shared table (round 46 D-b), against a real Postgres.
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

import { PrismaBillingOrganizationRepository } from "../prisma.billing-account-facts.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaBillingOrganizationRepository.claimStripeCustomerId", () => {
  const ns = `stripe-customer-${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:claim-stripe-customer"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const organizations = PrismaBillingOrganizationRepository.create(prisma);
  let organizationId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("given an organization with no Stripe customer", () => {
    describe("when a second checkout claims while the first holds the row", () => {
      /** @scenario "Two checkouts started together share one Stripe customer" */
      it("tells the second it lost and keeps the first customer", async () => {
        const answers = await raceOnOneRow({
          prisma,
          table: "Organization",
          first: async (tx) => {
            await tx.organization.update({
              where: { id: organizationId },
              data: { stripeCustomerId: `cus_${ns}_first` },
            });
            return true;
          },
          second: () =>
            organizations.claimStripeCustomerId({
              organizationId,
              stripeCustomerId: `cus_${ns}_second`,
            }),
        });

        expect(answers).toEqual({ first: true, second: false });
        const organization = await prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
        });
        expect(organization.stripeCustomerId).toBe(`cus_${ns}_first`);
      });
    });
  });
});
