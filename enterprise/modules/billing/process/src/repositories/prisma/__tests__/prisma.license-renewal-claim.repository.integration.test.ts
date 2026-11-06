// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/licensing/self-serving-license-purchase.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { Temporal, type Instant } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaLicenseRenewalClaimRepository } from "../prisma.license-renewal-claim.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const LEASE_MS = 5 * 60 * 1000;

describe.skipIf(!DB_URL)("PrismaLicenseRenewalClaimRepository", () => {
  const run = `in_${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:license-renewal-claim"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const claims = PrismaLicenseRenewalClaimRepository.create(prisma);
  const now = Temporal.Instant.from("2027-01-01T00:00:00Z");
  const later = (ms: number) => now.add({ milliseconds: ms });
  const claim = (stripeInvoiceId: string, at: Instant) =>
    claims.claim({
      stripeInvoiceId,
      stripeSubscriptionId: "sub_license",
      now: at,
      leaseMs: LEASE_MS,
    });

  afterAll(async () => {
    await prisma.licenseRenewalClaim.deleteMany({
      where: { stripeInvoiceId: { startsWith: run } },
    });
    await prisma.$disconnect();
  });

  describe("given two deliveries of one paid renewal invoice", () => {
    /** @scenario "Only one delivery claims a renewal invoice" */
    it("lets the first claim, refuses the concurrent second, then reports it delivered", async () => {
      const invoiceId = `${run}_concurrent`;

      const answers = await Promise.all([claim(invoiceId, now), claim(invoiceId, now)]);
      expect(answers.toSorted()).toEqual(["claimed", "in_flight"]);

      await claims.markDelivered({
        stripeInvoiceId: invoiceId,
        licenseId: "lic-1",
        deliveredAt: now,
      });
      await claims.release({ stripeInvoiceId: invoiceId });

      expect(await claim(invoiceId, later(LEASE_MS * 2))).toBe("delivered");
    });
  });

  describe("given a claim never delivered", () => {
    it("is taken over once the lease has passed", async () => {
      const invoiceId = `${run}_stale`;
      expect(await claim(invoiceId, now)).toBe("claimed");

      expect(await claim(invoiceId, later(1000))).toBe("in_flight");
      expect(await claim(invoiceId, later(LEASE_MS + 1))).toBe("claimed");
    });

    it("is claimed afresh after a release", async () => {
      const invoiceId = `${run}_released`;
      expect(await claim(invoiceId, now)).toBe("claimed");

      await claims.release({ stripeInvoiceId: invoiceId });

      expect(await claim(invoiceId, now)).toBe("claimed");
    });
  });
});
