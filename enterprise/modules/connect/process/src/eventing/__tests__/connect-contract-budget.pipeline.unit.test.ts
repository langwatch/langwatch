/**
 * @vitest-environment node
 * Connect syncs a customer's contract budget from licensing's contract_terms_changed fact, and
 * resets then syncs it from billing's renewal fact.
 * @see enterprise/modules/connect/specs/connect.feature
 */
import {
  CONNECTED_BILLING_AGGREGATE_TYPE,
  CONNECTED_BILLING_EVENT_VERSION,
  CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE,
  CONNECTED_TERM_RENEWED_EVENT_TYPE,
  connectedCustomerOnboardedEventDataSchema,
  connectedTermRenewedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  CONTRACT_TERMS_CHANGED_EVENT_TYPE,
  type ContractTermsChangedEventData,
  contractTermsChangedEventDataSchema,
  LICENSING_CUSTOMER_EVENT_VERSION,
  type ContractTerms,
  type LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  type ContractBudget,
  ContractBudgetService,
  type ContractBudgetStore,
} from "../../services/contract-budget.service.ts";
import { buildConnectContractBudgetPipeline } from "../connect-contract-budget.pipeline.ts";

const TERMS: ContractTerms = {
  commitUsdCents: 100_000,
  maximumUsdCents: 100_000,
  overageEnabled: false,
  services: ["instant_evals"],
  termEndsAt: "2027-01-01T00:00:00Z",
  termStartsAt: "2025-12-01T00:00:00Z",
};

/** Licensing's customer pipeline as its contract names the terms fact. */
function licensingStandIn() {
  return definePipeline({
    name: "licensing_customer_stand_in",
    aggregate: defineAggregate({ type: "licensing_customer" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(CONTRACT_TERMS_CHANGED_EVENT_TYPE),
        data: contractTermsChangedEventDataSchema,
      }),
    ])
    .build();
}

/** Billing's connected_billing pipeline as its contract names the onboarding and renewal facts. */
function billingStandIn() {
  return definePipeline({
    name: "connected_billing_stand_in",
    aggregate: defineAggregate({ type: CONNECTED_BILLING_AGGREGATE_TYPE }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE),
        data: connectedCustomerOnboardedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(CONNECTED_TERM_RENEWED_EVENT_TYPE),
        data: connectedTermRenewedEventDataSchema,
      }),
    ])
    .build();
}

/** The gateway's budget table in memory: one contract budget per organization. */
class MemoryBudgets implements ContractBudgetStore {
  readonly created: number[] = [];
  readonly steps: string[] = [];
  budget: ContractBudget | null = null;

  async findForOrganization(): Promise<ContractBudget | null> {
    return this.budget;
  }

  async create({ limitUsdCents }: { limitUsdCents: number }): Promise<void> {
    this.created.push(limitUsdCents);
    this.budget = { id: "budget-1", limitUsdCents, capSetByCustomer: false, lastResetAt: null };
  }

  async setLimit({ limitUsdCents }: { limitUsdCents: number }): Promise<void> {
    this.steps.push("sync");
    if (this.budget) this.budget = { ...this.budget, limitUsdCents };
  }

  async reset(): Promise<void> {
    this.steps.push("reset");
  }
}

function harness() {
  const store = new MemoryBudgets();
  const contractBudgets = ContractBudgetService.create({
    store,
    terms: createApiFixture<LicensingApi>({ getContractTerms: async () => TERMS }),
    systemActorId: "system",
  });
  const sync = vi.fn((input: { organizationId: string; operatorId: string }) =>
    contractBudgets.sync(input),
  );
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const licensing = eventing.register(licensingStandIn());
  const billing = eventing.register(billingStandIn());
  eventing.register(
    buildConnectContractBudgetPipeline({
      contractBudgets: { sync, reset: (input) => contractBudgets.reset(input) },
    }),
  );
  const billed = (
    type: typeof CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE | typeof CONNECTED_TERM_RENEWED_EVENT_TYPE,
    id: string,
  ) =>
    billing.service.storeEvents(
      [
        {
          id,
          aggregateId: fact.organizationId,
          aggregateType: CONNECTED_BILLING_AGGREGATE_TYPE,
          tenantId: createTenantId(fact.tenantId),
          type,
          version: CONNECTED_BILLING_EVENT_VERSION,
          createdAt: fact.occurredAt,
          occurredAt: fact.occurredAt,
          idempotencyKey: id,
          data: fact,
        },
      ],
      { tenantId: createTenantId(fact.tenantId) },
    );
  const changed = (fact: ContractTermsChangedEventData, id: string) =>
    licensing.service.storeEvents(
      [
        {
          id,
          aggregateId: fact.organizationId,
          aggregateType: "licensing_customer",
          tenantId: createTenantId(fact.tenantId),
          type: CONTRACT_TERMS_CHANGED_EVENT_TYPE,
          version: LICENSING_CUSTOMER_EVENT_VERSION,
          createdAt: fact.occurredAt,
          occurredAt: fact.occurredAt,
          idempotencyKey: id,
          data: fact,
        },
      ],
      { tenantId: createTenantId(fact.tenantId) },
    );
  return { changed, billed, store, sync };
}

const fact: ContractTermsChangedEventData = {
  tenantId: "org-acme",
  occurredAt: 1_790_000_000_000,
  organizationId: "org-acme",
  operatorId: "operator-1",
};

describe("given licensing records a customer's contract terms as changed", () => {
  describe("when connect's subscriber receives the fact", () => {
    /** @scenario "A contract_terms_changed fact syncs the contract budget" */
    it("brings the organization's contract budget in line with its current terms", async () => {
      const { changed, store, sync } = harness();

      await changed(fact, "event-1");

      await vi.waitFor(() => expect(store.created).toEqual([100_000]));
      expect(sync).toHaveBeenCalledWith({ organizationId: "org-acme", operatorId: "operator-1" });
    });
  });

  describe("when the same fact is delivered again", () => {
    /** @scenario "A redelivered fact syncs to the same cap" */
    it("leaves the budget at the same cap and creates no second budget", async () => {
      const { changed, store, sync } = harness();

      await changed(fact, "event-1");
      await vi.waitFor(() => expect(store.created).toHaveLength(1));
      await changed(fact, "event-redelivered");
      await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
      await Promise.all(sync.mock.results.map((result) => result.value));

      expect(store.created).toEqual([100_000]);
      expect(store.budget?.limitUsdCents).toBe(100_000);
    });
  });
});

describe("given billing records a connected customer's renewal", () => {
  describe("when connect's subscriber receives the fact", () => {
    /** @scenario "A renewal fact resets then syncs the contract budget" */
    it("starts the budget's new window first, then brings it in line with the terms", async () => {
      const { billed, store, sync } = harness();
      store.budget = {
        id: "budget-1",
        limitUsdCents: 50_000,
        capSetByCustomer: false,
        lastResetAt: null,
      };

      await billed(CONNECTED_TERM_RENEWED_EVENT_TYPE, "renewed-1");

      await vi.waitFor(() => expect(store.steps).toEqual(["reset", "sync"]));
      expect(sync).toHaveBeenCalledWith({ organizationId: "org-acme", operatorId: "operator-1" });
      expect(store.budget?.limitUsdCents).toBe(100_000);
    });
  });
});

describe("given billing records a connected customer's onboarding", () => {
  describe("when connect's subscriber receives the fact", () => {
    /** @scenario "An onboarding fact syncs the contract budget" */
    it("brings the organization's contract budget in line with its current terms", async () => {
      const { billed, store, sync } = harness();

      await billed(CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE, "onboarded-1");

      await vi.waitFor(() => expect(store.created).toEqual([100_000]));
      expect(sync).toHaveBeenCalledWith({ organizationId: "org-acme", operatorId: "operator-1" });
      expect(store.steps).toEqual([]);
    });
  });
});
