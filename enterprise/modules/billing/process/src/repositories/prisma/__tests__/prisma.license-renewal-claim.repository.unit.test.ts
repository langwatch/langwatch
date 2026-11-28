// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/licensing/self-serving-license-purchase.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaLicenseRenewalClaimRepository } from "../prisma.license-renewal-claim.repository.ts";

describe("PrismaLicenseRenewalClaimRepository.claim", () => {
  /** @scenario "Only one retry takes over an expired renewal claim" */
  it("rechecks the stale lease in one conditional write", async () => {
    const stripeInvoiceId = "in_stale_race";
    const oldToken = "old-token";
    const createMany = vi.fn(async () => ({ count: 0 }));
    const findUnique = vi.fn(async () => ({
      stripeInvoiceId,
      stripeSubscriptionId: "sub_license",
      claimToken: oldToken,
      claimedAt: new Date("2026-12-31T23:55:00.000Z"),
      issuedLicense: null,
      deliveredAt: null,
    }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn(async () => 1);
    const database = {
      $executeRaw: executeRaw,
      licenseRenewalClaim: { createMany, findUnique, updateMany },
    } as unknown as Parameters<typeof PrismaLicenseRenewalClaimRepository.create>[0];
    const claims = PrismaLicenseRenewalClaimRepository.create(database);
    const now = Temporal.Instant.from("2027-01-01T00:00:00Z");

    await expect(
      claims.claim({
        stripeInvoiceId,
        stripeSubscriptionId: "sub_license",
        now,
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toMatchObject({ outcome: "claimed" });

    expect(updateMany).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRaw.mock.calls[0] ?? [];
    const sql = Array.from(strings as readonly string[]).join("?");
    expect(sql).toContain('UPDATE "LicenseRenewalClaim"');
    expect(sql).toContain('"claimToken" = ?');
    expect(sql).toContain('"deliveredAt" IS NULL');
    expect(sql).toContain('"claimedAt" <= ?');
    expect(values).toContain(stripeInvoiceId);
    expect(values).toContain(oldToken);
  });
});
