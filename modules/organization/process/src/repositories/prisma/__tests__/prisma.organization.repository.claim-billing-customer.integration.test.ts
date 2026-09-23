/**
 * @vitest-environment node
 * @see specs/billing/stripe-customer.feature
 *
 * One Stripe customer per organization, against a real Postgres: a claim parked
 * on another checkout's row lock re-checks against the committed row and loses.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";
import { raceOnOneRow } from "./support/row-lock-race.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaOrganizationRepository.claimBillingCustomerId", () => {
  const ns = `stripe-customer-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:claim-billing-customer"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const organizations = PrismaOrganizationRepository.create(prisma);
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
            organizations.claimBillingCustomerId({
              organizationId,
              billingCustomerId: `cus_${ns}_second`,
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
