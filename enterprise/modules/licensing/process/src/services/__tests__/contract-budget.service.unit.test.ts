import {
  ConnectBudgetAboveContractMaximumError,
  ConnectBudgetNotSetError,
} from "@langwatch/enterprise-licensing-contract";
import { ValidationError } from "@langwatch/handled-error";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { ContractBudget, ContractBudgetStore } from "../../app/licensing.members.ts";
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

class RecordingStore implements ContractBudgetStore {
  readonly created: { organizationId: string; limitUsdCents: number; operatorId: string }[] = [];
  readonly limits: { id: string; limitUsdCents: number; capSetByCustomer: boolean }[] = [];

  constructor(private budget: ContractBudget | null = null) {}

  async findForOrganization(): Promise<ContractBudget | null> {
    return this.budget;
  }

  async create(params: {
    organizationId: string;
    limitUsdCents: number;
    operatorId: string;
  }): Promise<void> {
    this.created.push(params);
    this.budget = { id: "budget-1", limitUsdCents: params.limitUsdCents, capSetByCustomer: false };
  }

  readonly resets: string[] = [];

  async reset(params: { organizationId: string; id: string; actorId: string }): Promise<void> {
    this.resets.push(params.id);
  }

  async setLimit(params: {
    id: string;
    limitUsdCents: number;
    capSetByCustomer: boolean;
  }): Promise<void> {
    this.limits.push({
      id: params.id,
      limitUsdCents: params.limitUsdCents,
      capSetByCustomer: params.capSetByCustomer,
    });
  }
}

function harness(options: { licenses?: IssuedLicenseRecord[]; budget?: ContractBudget | null }) {
  const store = new RecordingStore(options.budget ?? null);
  const service = ContractBudgetService.create({
    store,
    licensesOf: async () => options.licenses ?? [licenseFor()],
    systemActorId: "system",
    now: () => NOW,
  });
  return { service, store };
}

describe("ContractBudgetService.sync", () => {
  it("creates the budget at the commit when the customer has none", async () => {
    const { service, store } = harness({});

    await service.sync({ organizationId: "org-acme", operatorId: "operator-1" });

    expect(store.created).toEqual([
      { organizationId: "org-acme", limitUsdCents: 100_000, operatorId: "operator-1" },
    ]);
  });

  it("creates nothing when no commit and no overage were agreed", async () => {
    const { service, store } = harness({
      licenses: [licenseFor({ commitUsdCents: 0 })],
    });

    await service.sync({ organizationId: "org-acme", operatorId: "operator-1" });

    expect(store.created).toEqual([]);
    expect(store.limits).toEqual([]);
  });

  it("follows the commit where the cap was never the customer's own", async () => {
    const { service, store } = harness({
      budget: { id: "budget-1", limitUsdCents: 50_000, capSetByCustomer: false },
    });

    await service.sync({ organizationId: "org-acme", operatorId: "operator-1" });

    expect(store.limits).toEqual([
      { id: "budget-1", limitUsdCents: 100_000, capSetByCustomer: false },
    ]);
  });

  it("keeps a cap the customer chose, lowering it only past the new maximum", async () => {
    const { service, store } = harness({
      budget: { id: "budget-1", limitUsdCents: 80_000, capSetByCustomer: true },
    });

    await service.sync({ organizationId: "org-acme", operatorId: "operator-1" });

    expect(store.limits).toEqual([]);
  });

  it("lowers a customer cap that is above the new maximum", async () => {
    const { service, store } = harness({
      licenses: [licenseFor({ commitUsdCents: 20_000 })],
      budget: { id: "budget-1", limitUsdCents: 80_000, capSetByCustomer: true },
    });

    await service.sync({ organizationId: "org-acme", operatorId: "operator-1" });

    expect(store.limits).toEqual([
      { id: "budget-1", limitUsdCents: 20_000, capSetByCustomer: true },
    ]);
  });

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

describe("ContractBudgetService.setCap", () => {
  /** @scenario "A cap above the prepaid commit is refused when overage is off" */
  it("refuses a cap above the commit while overage is off", async () => {
    const { service } = harness({
      budget: { id: "budget-1", limitUsdCents: 100_000, capSetByCustomer: false },
    });

    await expect(
      service.setCap({ organizationId: "org-acme", capUsdCents: 150_000 }),
    ).rejects.toBeInstanceOf(ConnectBudgetAboveContractMaximumError);
  });

  /** @scenario "A cap may reach the commit plus the agreed overage maximum" */
  it("admits a cap up to the commit plus the agreed overage maximum", async () => {
    const { service, store } = harness({
      licenses: [licenseFor({ overageEnabled: true, overageMaxUsdCents: 50_000 })],
      budget: { id: "budget-1", limitUsdCents: 100_000, capSetByCustomer: false },
    });

    const answer = await service.setCap({ organizationId: "org-acme", capUsdCents: 150_000 });

    expect(answer).toEqual({ capUsdCents: 150_000, maximumUsdCents: 150_000 });
    expect(store.limits).toEqual([
      { id: "budget-1", limitUsdCents: 150_000, capSetByCustomer: true },
    ]);
  });

  /** @scenario "A cap above the commit plus the overage maximum is refused" */
  it("refuses a cap above the commit plus the overage maximum", async () => {
    const { service } = harness({
      licenses: [licenseFor({ overageEnabled: true, overageMaxUsdCents: 50_000 })],
      budget: { id: "budget-1", limitUsdCents: 100_000, capSetByCustomer: false },
    });

    await expect(
      service.setCap({ organizationId: "org-acme", capUsdCents: 150_001 }),
    ).rejects.toBeInstanceOf(ConnectBudgetAboveContractMaximumError);
  });

  it("refuses a cap when nothing was agreed to cap", async () => {
    const { service } = harness({ budget: null });

    await expect(
      service.setCap({ organizationId: "org-acme", capUsdCents: 1_000 }),
    ).rejects.toBeInstanceOf(ConnectBudgetNotSetError);
  });

  it("refuses an amount that is not a positive whole number of cents", async () => {
    const { service } = harness({
      budget: { id: "budget-1", limitUsdCents: 100_000, capSetByCustomer: false },
    });

    await expect(
      service.setCap({ organizationId: "org-acme", capUsdCents: 10.5 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  /** @scenario "A cap below what is already spent stops further use" */
  it("admits a cap below what is already spent, which is what stops further use", async () => {
    const { service, store } = harness({
      budget: { id: "budget-1", limitUsdCents: 100_000, capSetByCustomer: false },
    });

    await service.setCap({ organizationId: "org-acme", capUsdCents: 1 });

    expect(store.limits).toEqual([{ id: "budget-1", limitUsdCents: 1, capSetByCustomer: true }]);
  });
});
