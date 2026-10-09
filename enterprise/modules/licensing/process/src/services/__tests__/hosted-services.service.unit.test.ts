/**
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { IssuedLicenseRecord } from "../../repositories/issued-license.repository.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { HostedServicesService } from "../hosted-services.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");
const KEY = { virtualKeyId: "vk-managed", organizationId: "org-acme" };

function rowFor(overrides: Partial<IssuedLicenseRecord> = {}): IssuedLicenseRecord {
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
    instanceId: "instance-1",
    instanceBoundAt: NOW,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    virtualKeyId: "vk-managed",
    seatsRaisedFrom: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function serviceOver(rows: IssuedLicenseRecord[]) {
  return HostedServicesService.create({
    licenses: MemoryIssuedLicenseRepository.create(rows),
    usage: {
      read: async () => ({ budgets: [], spendAvailable: true, readAt: NOW }),
    },
    contractBudgets: {
      termsOf: async () => ({
        commitUsdCents: 100_000,
        maximumUsdCents: 100_000,
        overageEnabled: false,
        services: ["instant_evals"],
        termEndsAt: null,
        termStartsAt: null,
      }),
    },
    now: () => NOW,
  });
}

describe("the active licence behind a managed key", () => {
  /** @scenario "findManagedKeyLicense answers the active licence behind a managed key, empty otherwise" */
  it("answers one entry with the entitled services for an active licence of the organization", async () => {
    await expect(serviceOver([rowFor()]).findManagedKeyLicense(KEY)).resolves.toEqual([
      { services: ["instant_evals"] },
    ]);
  });

  /** @scenario "findManagedKeyLicense answers the active licence behind a managed key, empty otherwise" */
  it("answers nothing for a revoked, expired or other organization's licence, or no licence", async () => {
    const answers = await Promise.all(
      [
        [rowFor({ revokedAt: NOW })],
        [rowFor({ expiresAt: Temporal.Instant.from("2025-12-31T00:00:00.000Z") })],
        [rowFor({ organizationId: "org-other" })],
        [],
      ].map((rows) => serviceOver(rows).findManagedKeyLicense(KEY)),
    );

    expect(answers).toEqual([[], [], [], []]);
  });

  /** @scenario "findManagedKeyLicense answers the active licence behind a managed key, empty otherwise" */
  it("answers an active licence entitled to no hosted service as one entry with no services", async () => {
    await expect(
      serviceOver([rowFor({ services: ["future_service"] })]).findManagedKeyLicense(KEY),
    ).resolves.toEqual([{ services: [] }]);
  });
});

describe("the hosted usage billing reads through licensing", () => {
  it("names the contract's services only where the key's licence is active", async () => {
    const caller = { ...KEY, projectId: null };

    const licensed = await serviceOver([rowFor()]).usage({ caller });
    const unlicensed = await serviceOver([]).usage({ caller });

    expect(licensed.services).toEqual(["instant_evals"]);
    expect(unlicensed.services).toEqual([]);
  });
});
