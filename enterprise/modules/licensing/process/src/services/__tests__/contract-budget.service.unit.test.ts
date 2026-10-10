import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { IssuedLicenseRecord } from "../../repositories/issued-license.repository.ts";
import { ContractBudgetService } from "../contract-budget.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

function licenseFor(overrides: Partial<IssuedLicenseRecord> = {}): IssuedLicenseRecord {
  return {
    id: "license-1",
    licenseId: "lic-1",
    tokenHash: "hash-1",
    organizationId: "org-acme",
    organizationName: "ACME",
    email: "ops@example.com",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 0,
    issuedAt: Temporal.Instant.from("2025-12-01T00:00:00.000Z"),
    expiresAt: Temporal.Instant.from("2027-01-01T00:00:00.000Z"),
    source: "BACKOFFICE",
    issuedById: "operator-1",
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    pendingDeliveryLicense: null,
    services: ["instant_evals"],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 100_000,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: null,
    instanceBoundAt: null,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    virtualKeyId: null,
    seatsRaisedFrom: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function harness(options: { licenses?: IssuedLicenseRecord[] }) {
  const service = ContractBudgetService.create({
    licensesOf: async () => options.licenses ?? [licenseFor()],
    now: () => NOW,
  });
  return { service };
}

describe("ContractBudgetService.termsOf", () => {
  it("sums the commits of every counted license and drops a reissued one", async () => {
    const { service } = harness({
      licenses: [
        licenseFor({ id: "old", commitUsdCents: 100_000 }),
        licenseFor({ id: "new", replacesId: "old", commitUsdCents: 250_000 }),
      ],
    });

    expect(await service.termsOf("org-acme")).toMatchObject({
      commitUsdCents: 250_000,
      maximumUsdCents: 250_000,
    });
  });
});
