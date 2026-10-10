import {
  ConnectBudgetAboveContractMaximumError,
  ConnectBudgetNotSetError,
  type ContractTerms,
  type LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
import { ValidationError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
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
  readonly created: { organizationId: string; limitUsdCents: number; operatorId: string }[] = [];
  readonly limits: { id: string; limitUsdCents: number; capSetByCustomer: boolean }[] = [];
  readonly resets: string[] = [];

  constructor(private budget: ContractBudget | null) {}

  async findForOrganization(): Promise<ContractBudget | null> {
    return this.budget;
  }

  async create(params: {
    organizationId: string;
    limitUsdCents: number;
    operatorId: string;
  }): Promise<void> {
    this.created.push(params);
    this.budget = {
      id: "budget-1",
      limitUsdCents: params.limitUsdCents,
      capSetByCustomer: false,
      lastResetAt: null,
    };
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
    this.budget = {
      id: params.id,
      limitUsdCents: params.limitUsdCents,
      capSetByCustomer: params.capSetByCustomer,
      lastResetAt: null,
    };
  }

  async reset(params: { organizationId: string; id: string; actorId: string }): Promise<void> {
    this.resets.push(params.id);
  }
}

const BUDGET: ContractBudget = {
  id: "budget-1",
  limitUsdCents: 100_000,
  capSetByCustomer: false,
  lastResetAt: null,
};

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

const RENEWED_MS = Date.UTC(2026, 0, 1);

const WITH_OVERAGE: ContractTerms = { ...TERMS, overageEnabled: true, maximumUsdCents: 150_000 };

const SYNC = { organizationId: "org-acme", operatorId: "operator-1" };

describe("ContractBudgetService.sync", () => {
  /** @scenario "A contract_terms_changed fact syncs the contract budget" */
  it("creates the budget at the commit when the customer has none", async () => {
    const { service, store } = harness({ budget: null });

    await service.sync(SYNC);

    expect(store.created).toEqual([
      { organizationId: "org-acme", limitUsdCents: 100_000, operatorId: "operator-1" },
    ]);
  });

  /** @scenario "A contract_terms_changed fact syncs the contract budget" */
  it("creates nothing when no commit and no overage were agreed", async () => {
    const { service, store } = harness({
      budget: null,
      terms: { ...TERMS, commitUsdCents: 0, maximumUsdCents: 0 },
    });

    await service.sync(SYNC);

    expect(store.created).toEqual([]);
    expect(store.limits).toEqual([]);
  });

  /** @scenario "A contract_terms_changed fact syncs the contract budget" */
  it("follows the commit where the cap was never the customer's own", async () => {
    const { service, store } = harness({
      budget: { id: "budget-1", limitUsdCents: 50_000, capSetByCustomer: false, lastResetAt: null },
    });

    await service.sync(SYNC);

    expect(store.limits).toEqual([
      { id: "budget-1", limitUsdCents: 100_000, capSetByCustomer: false },
    ]);
  });

  /** @scenario "A contract_terms_changed fact syncs the contract budget" */
  it("keeps a cap the customer chose, lowering it only past the new maximum", async () => {
    const kept = harness({
      budget: { id: "budget-1", limitUsdCents: 80_000, capSetByCustomer: true, lastResetAt: null },
    });
    await kept.service.sync(SYNC);
    expect(kept.store.limits).toEqual([]);

    const lowered = harness({
      terms: { ...TERMS, commitUsdCents: 20_000, maximumUsdCents: 20_000 },
      budget: { id: "budget-1", limitUsdCents: 80_000, capSetByCustomer: true, lastResetAt: null },
    });
    await lowered.service.sync(SYNC);
    expect(lowered.store.limits).toEqual([
      { id: "budget-1", limitUsdCents: 20_000, capSetByCustomer: true },
    ]);
  });

  /** @scenario "A redelivered fact syncs to the same cap" */
  it("leaves the budget at the same cap when the sync runs again", async () => {
    const { service, store } = harness({ budget: null });

    await service.sync(SYNC);
    await service.sync(SYNC);

    expect(store.created).toHaveLength(1);
    expect(store.limits).toEqual([]);
  });
});

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

describe("ContractBudgetService.reset", () => {
  it("starts a new window on the budget the customer has", async () => {
    const { service, store } = harness({});

    await service.reset({
      organizationId: "org-acme",
      operatorId: "operator-1",
      renewedAtMs: RENEWED_MS,
    });

    expect(store.resets).toEqual(["budget-1"]);
  });

  /** @scenario "A reset with no contract budget does nothing" */
  it("does nothing where no contract budget exists yet", async () => {
    const { service, store } = harness({ budget: null });

    await service.reset({
      organizationId: "org-acme",
      operatorId: "operator-1",
      renewedAtMs: RENEWED_MS,
    });

    expect(store.resets).toEqual([]);
  });

  /** @scenario "A redelivered renewal fact starts the window once" */
  it("leaves a window already restarted at or after the renewal alone", async () => {
    const { service, store } = harness({
      budget: { ...BUDGET, lastResetAt: Temporal.Instant.fromEpochMilliseconds(RENEWED_MS) },
    });

    await service.reset({
      organizationId: "org-acme",
      operatorId: "operator-1",
      renewedAtMs: RENEWED_MS,
    });

    expect(store.resets).toEqual([]);
  });
});
