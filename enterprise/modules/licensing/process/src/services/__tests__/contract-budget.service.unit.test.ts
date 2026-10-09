import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { IssuedLicenseRecord } from "../../repositories/issued-license.repository.ts";
import type { ContractBudget, ContractBudgetStore } from "../contract-budget.service.ts";
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

class RecordingStore implements ContractBudgetStore {
  readonly resets: string[] = [];

  constructor(private readonly budget: ContractBudget | null) {}

  async findForOrganization(): Promise<ContractBudget | null> {
    return this.budget;
  }

  async reset(params: { organizationId: string; id: string; actorId: string }): Promise<void> {
    this.resets.push(params.id);
  }
}

function harness(options: { licenses?: IssuedLicenseRecord[]; budget?: ContractBudget | null }) {
  const store = new RecordingStore(options.budget ?? null);
  const service = ContractBudgetService.create({
    store,
    licensesOf: async () => options.licenses ?? [licenseFor()],
    now: () => NOW,
  });
  return { service, store };
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

describe("ContractBudgetService.reset", () => {
  it("starts a new window on the budget the customer has", async () => {
    const { service, store } = harness({
      budget: { id: "budget-1", limitUsdCents: 100_000, capSetByCustomer: false },
    });

    await service.reset({ organizationId: "org-acme", operatorId: "operator-1" });

    expect(store.resets).toEqual(["budget-1"]);
  });

  it("does nothing where nothing was agreed yet", async () => {
    const { service, store } = harness({ budget: null });

    await service.reset({ organizationId: "org-acme", operatorId: "operator-1" });

    expect(store.resets).toEqual([]);
  });
});
