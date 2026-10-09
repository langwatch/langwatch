import {
  ConnectBudgetAboveContractMaximumError,
  ConnectBudgetNotSetError,
  type ContractTerms,
  type LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
import { ValidationError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { ContractBudget, ContractBudgetStore } from "../contract-budget.service.ts";
import { ContractBudgetService } from "../contract-budget.service.ts";

const TERMS: ContractTerms = {
  commitUsdCents: 100_000,
  maximumUsdCents: 100_000,
  overageEnabled: false,
  services: ["instant_evals"],
  termEndsAt: "2027-01-01T00:00:00Z",
  termStartsAt: "2025-12-01T00:00:00Z",
};

class RecordingStore implements ContractBudgetStore {
  readonly limits: { id: string; limitUsdCents: number; capSetByCustomer: boolean }[] = [];

  constructor(private readonly budget: ContractBudget | null) {}

  async findForOrganization(): Promise<ContractBudget | null> {
    return this.budget;
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

const BUDGET: ContractBudget = { id: "budget-1", limitUsdCents: 100_000, capSetByCustomer: false };

function harness(options: { terms?: ContractTerms; budget?: ContractBudget | null }) {
  const store = new RecordingStore(options.budget === undefined ? BUDGET : options.budget);
  const service = ContractBudgetService.create({
    store,
    terms: createApiFixture<LicensingApi>({
      getContractTerms: async () => options.terms ?? TERMS,
    }),
    systemActorId: "system",
  });
  return { service, store };
}

const WITH_OVERAGE: ContractTerms = { ...TERMS, overageEnabled: true, maximumUsdCents: 150_000 };

describe("ContractBudgetService.setCap", () => {
  /** @scenario "A cap above the prepaid commit is refused when overage is off" */
  it("refuses a cap above the commit while overage is off", async () => {
    const { service } = harness({});

    await expect(
      service.setCap({ organizationId: "org-acme", capUsdCents: 150_000 }),
    ).rejects.toBeInstanceOf(ConnectBudgetAboveContractMaximumError);
  });

  /** @scenario "A cap may reach the commit plus the agreed overage maximum" */
  it("admits a cap up to the commit plus the agreed overage maximum", async () => {
    const { service, store } = harness({ terms: WITH_OVERAGE });

    const answer = await service.setCap({ organizationId: "org-acme", capUsdCents: 150_000 });

    expect(answer).toEqual({ capUsdCents: 150_000, maximumUsdCents: 150_000 });
    expect(store.limits).toEqual([
      { id: "budget-1", limitUsdCents: 150_000, capSetByCustomer: true },
    ]);
  });

  /** @scenario "A cap above the commit plus the overage maximum is refused" */
  it("refuses a cap above the commit plus the overage maximum", async () => {
    const { service } = harness({ terms: WITH_OVERAGE });

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
    const { service } = harness({});

    await expect(
      service.setCap({ organizationId: "org-acme", capUsdCents: 10.5 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  /** @scenario "A cap below what is already spent stops further use" */
  it("admits a cap below what is already spent, which is what stops further use", async () => {
    const { service, store } = harness({});

    await service.setCap({ organizationId: "org-acme", capUsdCents: 1 });

    expect(store.limits).toEqual([{ id: "budget-1", limitUsdCents: 1, capSetByCustomer: true }]);
  });
});
