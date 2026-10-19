/**
 * @vitest-environment node
 * Gateway's budget ledger debits governance's priced pulled-usage fact through its own peer
 * subscriber. Spec: specs/governance/pulled-usage-cost-reporting.feature
 */
import {
  PULLED_USAGE_AGGREGATE_TYPE,
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
  type PulledUsagePricedEventData,
  pulledUsagePricedEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GatewayBudgetLedgerService } from "../../features/budget/services/gateway-budget-ledger.service.ts";
import { MemoryGatewayBudgetSpendRepository } from "../../repositories/memory/memory.gateway-budget-spend.repository.ts";
import { buildGatewayPulledUsageLedgerPipeline } from "../gateway-pulled-usage-ledger.pipeline.ts";

const GOVERNANCE_TENANT = "project-governance-1";
const OCCURRED_AT = Date.UTC(2026, 7, 3);

/** Governance's pipeline as its contract names the fact. */
function governanceStandIn() {
  return definePipeline({
    name: "governance_stand_in",
    aggregate: defineAggregate({ type: PULLED_USAGE_AGGREGATE_TYPE }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(PULLED_USAGE_EVENT_TYPES.PRICED),
        data: pulledUsagePricedEventDataSchema,
      }),
    ])
    .build();
}

function pricedFact(): PulledUsagePricedEventData {
  return {
    restatementKey: "anthropic:org-1:2026-08-03:model-a",
    organizationId: "org-1",
    teamId: "team-1",
    scopeId: "team-1",
    model: "anthropic/model-a",
    amountNanoUsd: 2_500_000_000,
    tokensInput: 1_000,
    tokensOutput: 200,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    occurredAtMs: OCCURRED_AT,
    observedAtMs: OCCURRED_AT + 3_600_000,
  };
}

function harness() {
  const spend = MemoryGatewayBudgetSpendRepository.create();
  const ledger = GatewayBudgetLedgerService.create({ spend, changes: { append: vi.fn() } });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const governance = eventing.register(governanceStandIn());
  eventing.register(buildGatewayPulledUsageLedgerPipeline({ ledger }));
  const record = (data: PulledUsagePricedEventData, id: string) =>
    governance.service.storeEvents(
      [
        {
          id,
          aggregateId: data.restatementKey,
          aggregateType: PULLED_USAGE_AGGREGATE_TYPE,
          tenantId: createTenantId(GOVERNANCE_TENANT),
          type: PULLED_USAGE_EVENT_TYPES.PRICED,
          version: PULLED_USAGE_EVENT_VERSIONS.PRICED,
          createdAt: data.observedAtMs,
          occurredAt: data.occurredAtMs,
          data,
        },
      ],
      { tenantId: createTenantId(GOVERNANCE_TENANT) },
    );
  const totals = () =>
    spend.readPulledUsageTotals({
      tenantId: GOVERNANCE_TENANT,
      scopeIds: ["team-1"],
      from: Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT - 86_400_000),
      to: Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT + 86_400_000),
    });
  return { eventing, record, totals };
}

describe("given gateway's pulled-usage ledger pipeline beside governance's priced fact", () => {
  describe("when governance records the fact, and it is delivered a second time", () => {
    /** @scenario "The gateway budget ledger debits governance's priced pulled-usage fact" */
    it("debits the cost under the team's scope in the governance tenant, never summing a redelivery", async () => {
      const { eventing, record, totals } = harness();

      await record(pricedFact(), "evt-priced-1");
      await vi.waitFor(async () => expect((await totals()).items).toBe(1));
      await record(pricedFact(), "evt-priced-2");
      // Ordered per aggregate: once the later correction lands, the redelivery was handled.
      const corrected = {
        ...pricedFact(),
        amountNanoUsd: 3_000_000_000,
        observedAtMs: OCCURRED_AT + 7_200_000,
      };
      await record(corrected, "evt-priced-3");
      await vi.waitFor(async () => expect((await totals()).spentNanoUsd).toBe(3_000_000_000));

      const settled = await totals();
      expect(settled.items).toBe(1);
      expect(settled.tokensInput).toBe(1_000);
      await eventing.close();
    });
  });
});
