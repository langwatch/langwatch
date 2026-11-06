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

  const issued = {
    licenseKey: "signed-key",
    licenseData: {
      licenseId: "lic-1",
      plan: { type: "GROWTH" },
      expiresAt: "2028-01-01T00:00:00Z",
      organizationName: "ACME",
    },
  };
  const tokenOf = (answer: Awaited<ReturnType<typeof claim>>) => {
    if (answer.outcome !== "claimed") throw new Error(`expected a claim, got ${answer.outcome}`);
    return answer.token;
  };

  describe("given two deliveries of one paid renewal invoice", () => {
    /** @scenario "Only one delivery claims a renewal invoice" */
    it("lets the first claim, refuses the concurrent second, then reports it delivered", async () => {
      const invoiceId = `${run}_concurrent`;

      const answers = await Promise.all([claim(invoiceId, now), claim(invoiceId, now)]);
      expect(answers.map((answer) => answer.outcome).toSorted()).toEqual(["claimed", "in_flight"]);
      const token = tokenOf(answers.find((answer) => answer.outcome === "claimed") ?? answers[0]);

      expect(
        await claims.markDelivered({
          stripeInvoiceId: invoiceId,
          token,
          licenseId: "lic-1",
          deliveredAt: now,
        }),
      ).toBe(true);
      await claims.release({ stripeInvoiceId: invoiceId, token });

      expect((await claim(invoiceId, later(LEASE_MS * 2))).outcome).toBe("delivered");
    });
  });

  describe("given a claim never delivered", () => {
    it("is taken over once the lease has passed, and the stale holder can neither complete nor release it", async () => {
      const invoiceId = `${run}_stale`;
      const stale = tokenOf(await claim(invoiceId, now));

      expect((await claim(invoiceId, later(1000))).outcome).toBe("in_flight");
      const current = tokenOf(await claim(invoiceId, later(LEASE_MS + 1)));

      await claims.release({ stripeInvoiceId: invoiceId, token: stale });
      expect(
        await claims.markDelivered({
          stripeInvoiceId: invoiceId,
          token: stale,
          licenseId: "lic-stale",
          deliveredAt: now,
        }),
      ).toBe(false);
      expect((await claim(invoiceId, later(LEASE_MS + 2))).outcome).toBe("in_flight");
      expect(
        await claims.markDelivered({
          stripeInvoiceId: invoiceId,
          token: current,
          licenseId: "lic-1",
          deliveredAt: now,
        }),
      ).toBe(true);
    });

    it("is claimed afresh after a release", async () => {
      const invoiceId = `${run}_released`;
      const token = tokenOf(await claim(invoiceId, now));

      await claims.release({ stripeInvoiceId: invoiceId, token });

      expect((await claim(invoiceId, now)).outcome).toBe("claimed");
    });
  });

  describe("given a licence minted but not mailed", () => {
    it("hands the minted licence to the next claim and clears it once delivered", async () => {
      const invoiceId = `${run}_minted`;
      const first = tokenOf(await claim(invoiceId, now));
      expect(await claims.recordIssued({ stripeInvoiceId: invoiceId, token: first, issued })).toBe(
        true,
      );

      await claims.release({ stripeInvoiceId: invoiceId, token: first });

      const retry = await claim(invoiceId, later(1000));
      expect(retry).toMatchObject({ outcome: "claimed", issued });
      await claims.markDelivered({
        stripeInvoiceId: invoiceId,
        token: tokenOf(retry),
        licenseId: "lic-1",
        deliveredAt: now,
      });
      const row = await prisma.licenseRenewalClaim.findUnique({
        where: { stripeInvoiceId: invoiceId },
      });
      expect(row?.issuedLicense).toBeNull();
      expect(row?.licenseId).toBe("lic-1");
    });
  });
});
