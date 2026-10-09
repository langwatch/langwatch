/**
 * @vitest-environment node
 * Connect syncs a customer's contract budget from licensing's contract_terms_changed fact.
 * @see enterprise/modules/connect/specs/connect.feature
 */
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

/** The gateway's budget table in memory: one contract budget per organization. */
class MemoryBudgets implements ContractBudgetStore {
  readonly created: number[] = [];
  budget: ContractBudget | null = null;

  async findForOrganization(): Promise<ContractBudget | null> {
    return this.budget;
  }

  async create({ limitUsdCents }: { limitUsdCents: number }): Promise<void> {
    this.created.push(limitUsdCents);
    this.budget = { id: "budget-1", limitUsdCents, capSetByCustomer: false };
  }

  async setLimit({ limitUsdCents }: { limitUsdCents: number }): Promise<void> {
    if (this.budget) this.budget = { ...this.budget, limitUsdCents };
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
  eventing.register(buildConnectContractBudgetPipeline({ contractBudgets: { sync } }));
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
  return { changed, store, sync };
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
