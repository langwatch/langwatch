/**
 * @vitest-environment node
 * Gateway's sole debit writer debits each cost a governance push source recorded, through its
 * own peer subscriber. Spec: specs/ai-gateway/governance/ingested-cost-ledger.feature
 */
import {
  INGESTED_COST_AGGREGATE_TYPE,
  INGESTED_COST_EVENT_TYPES,
  INGESTED_COST_EVENT_VERSIONS,
  type IngestedCostRecordedEventData,
  ingestedCostKey,
  ingestedCostRecordedEventDataSchema,
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
import type { GatewayResolvedBudget } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GatewayBudgetChangeDedupeService } from "../../features/budget/services/gateway-budget-change-dedupe.service.ts";
import { GatewaySpendDebitService } from "../../features/spend/services/gateway-spend-debit.service.ts";
import type { BudgetDebitRow } from "../../repositories/gateway-budget-spend.repository.ts";
import { buildGatewayIngestedCostLedgerPipeline } from "../gateway-ingested-cost-ledger.pipeline.ts";

const GOVERNANCE_TENANT = "project-governance-1";
const OCCURRED_AT = Date.UTC(2026, 10, 14);
const epoch = Temporal.Instant.fromEpochMilliseconds(0);

/** Governance's pipeline as its contract names the fact. */
function governanceStandIn() {
  return definePipeline({
    name: "governance_stand_in",
    aggregate: defineAggregate({ type: INGESTED_COST_AGGREGATE_TYPE }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(INGESTED_COST_EVENT_TYPES.RECORDED),
        data: ingestedCostRecordedEventDataSchema,
      }),
    ])
    .build();
}

const organizationBudget: GatewayResolvedBudget = {
  budget: {
    id: "budget-org",
    organizationId: "org-1",
    scopeType: "ORGANIZATION",
    scopeId: "org-1",
    providerKey: null,
    name: "org",
    description: null,
    window: "MONTH",
    limitUsd: { toString: () => "50", toFixed: () => "50.00" },
    onBreach: "WARN",
    timezone: null,
    externalId: null,
    metadata: null,
    spentUsd: { toString: () => "0", toFixed: () => "0.00" },
    currentPeriodStartedAt: epoch,
    resetsAt: epoch,
    lastResetAt: null,
    cycleAnchorAt: null,
    archivedAt: null,
    createdAt: epoch,
    updatedAt: epoch,
    createdById: "usr-1",
    managedByVirtualKeyId: null,
  },
  bucketScopeId: "org-1",
  principalUserId: null,
  groupId: null,
  endUserId: null,
};

function recordedFact(): IngestedCostRecordedEventData {
  return {
    ingestionSourceId: "src-1",
    sourceType: "otel_generic",
    organizationId: "org-1",
    teamId: null,
    requestId: "push-req-1",
    model: "claude-sonnet",
    tokensInput: 100,
    tokensOutput: 50,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    amountNanoUsd: 1_250_000_000,
    principalUserId: null,
    occurredAtMs: OCCURRED_AT,
    observedAtMs: OCCURRED_AT + 1_000,
  };
}

/** The ledger as ClickHouse keys it: a request already held for a budget is skipped. */
class KeyedLedger {
  readonly rows = new Map<string, BudgetDebitRow>();
  attempts = 0;
  refusals = 0;

  async insertDebitsForBudgets(rows: BudgetDebitRow[]): Promise<void> {
    this.attempts += 1;
    if (this.refusals > 0) {
      this.refusals -= 1;
      throw new Error("ClickHouse concurrency queue is full");
    }
    for (const row of rows) {
      this.rows.set(`${row.tenantId}:${row.budgetId}:${row.gatewayRequestId}`, row);
    }
  }
}

function harness({ refusals = 0 }: { refusals?: number } = {}) {
  const ledger = new KeyedLedger();
  ledger.refusals = refusals;
  const debits = GatewaySpendDebitService.create({
    budgets: { resolveApplicableBudgets: async () => [organizationBudget] },
    spend: ledger,
    dedupe: GatewayBudgetChangeDedupeService.create(null),
    changes: { append: async () => ({ revision: 1n }) },
    crossings: { detect: async () => {} },
  });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const governance = eventing.register(governanceStandIn());
  eventing.register(buildGatewayIngestedCostLedgerPipeline({ debits }));
  const record = (data: IngestedCostRecordedEventData, id: string) =>
    governance.service.storeEvents(
      [
        {
          id,
          aggregateId: ingestedCostKey(data),
          aggregateType: INGESTED_COST_AGGREGATE_TYPE,
          tenantId: createTenantId(GOVERNANCE_TENANT),
          type: INGESTED_COST_EVENT_TYPES.RECORDED,
          version: INGESTED_COST_EVENT_VERSIONS.RECORDED,
          createdAt: data.observedAtMs,
          occurredAt: data.occurredAtMs,
          data,
        },
      ],
      { tenantId: createTenantId(GOVERNANCE_TENANT) },
    );
  return { eventing, ledger, record };
}

describe("given gateway's ingested-cost ledger pipeline beside governance's recorded fact", () => {
  describe("when governance records the fact, and it is delivered a second time", () => {
    /** @scenario "The gateway budget ledger debits a recorded push cost" */
    it("debits the organization budget once, under the governance tenant", async () => {
      const { eventing, ledger, record } = harness();

      await record(recordedFact(), "evt-cost-1");
      await vi.waitFor(() => expect(ledger.rows.size).toBe(1));
      await record(recordedFact(), "evt-cost-2");
      await vi.waitFor(() => expect(ledger.attempts).toBe(2));

      expect([...ledger.rows.values()]).toEqual([
        expect.objectContaining({
          tenantId: GOVERNANCE_TENANT,
          budgetId: "budget-org",
          gatewayRequestId: "src-1:push-req-1",
          amountNanoUsd: 1_250_000_000,
        }),
      ]);
      await eventing.close();
    });
  });

  describe("when the ledger refuses the first write", () => {
    it("redelivers the fact until the debit lands", async () => {
      const { eventing, ledger, record } = harness({ refusals: 1 });

      await record(recordedFact(), "evt-cost-1");
      await vi.waitFor(() => expect(ledger.rows.size).toBe(1), { timeout: 15_000 });

      expect(ledger.attempts).toBeGreaterThanOrEqual(2);
      await eventing.close();
    });
  });
});
