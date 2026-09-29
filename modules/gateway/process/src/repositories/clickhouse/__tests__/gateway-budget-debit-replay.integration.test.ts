/**
 * @vitest-environment node
 * A debit re-driven after its rows landed (its crossing read failed) against the
 * migrated ClickHouse: nothing is written twice, and the calendar rollup counts it once.
 */
import type {
  GatewayResolvedBudget,
  RecordBudgetCrossingCommandData,
} from "@langwatch/gateway-contract";
import { nowInstant } from "@langwatch/time";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import type { AppendGatewayChangeEventInput } from "../../../app/gateway.members.ts";
import { writeGatewayDebitsSchema } from "../../../eventing/gateway-debit.intent.ts";
import { GatewayBudgetChangeDedupeService } from "../../../services/gateway-budget-change-dedupe.service.ts";
import { GatewayBudgetCrossingService } from "../../../services/gateway-budget-crossing.service.ts";
import { GatewaySpendDebitService } from "../../../services/gateway-spend-debit.service.ts";
import type { BucketBoundaryRow } from "../../gateway-budget.repository.ts";
import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const chUrl = testClickHouseUrl();
const suffix = nanoid(8);
const TENANT_ID = `proj-replay-${suffix}`;
const REQUEST_ID = `grq-replay-${suffix}`;
const COST_NANO_USD = 2_000_000_000;

function monthBudget(): GatewayResolvedBudget {
  const at = nowInstant();
  return {
    budget: {
      id: `bdg-replay-${suffix}`,
      organizationId: `org-${suffix}`,
      scopeType: "PROJECT",
      scopeId: TENANT_ID,
      providerKey: null,
      name: "replay",
      description: null,
      window: "MONTH",
      limitUsd: { toString: () => "1", toFixed: () => "1" },
      onBreach: "BLOCK",
      timezone: null,
      externalId: null,
      metadata: null,
      spentUsd: { toString: () => "0", toFixed: () => "0" },
      currentPeriodStartedAt: at,
      resetsAt: at,
      lastResetAt: null,
      cycleAnchorAt: null,
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
      createdById: `usr-${suffix}`,
      managedByVirtualKeyId: null,
    },
    bucketScopeId: TENANT_ID,
    principalUserId: null,
    groupId: null,
    endUserId: null,
  };
}

/** Refuses the first crossing it is handed, as a timed-out append would. */
class FlakyFacts {
  readonly recorded: RecordBudgetCrossingCommandData[] = [];
  #refused = false;

  async recordBudgetCrossing(data: RecordBudgetCrossingCommandData): Promise<void> {
    if (!this.#refused) {
      this.#refused = true;
      throw new Error("governance append timed out");
    }
    this.recorded.push(data);
  }
}

describe.skipIf(!chUrl)("given a debit whose crossing could not be recorded", () => {
  const resolved = monthBudget();
  const facts = new FlakyFacts();
  let repo: GatewayBudgetClickHouseRepository;
  let firstAttempt: unknown;

  beforeAll(async () => {
    repo = new GatewayBudgetClickHouseRepository(async () => createTestClickHouseClient(chUrl!));
    const debits = GatewaySpendDebitService.create({
      budgets: { resolveApplicableBudgets: async () => [resolved] },
      spend: repo,
      dedupe: GatewayBudgetChangeDedupeService.create(null),
      changes: { append: async (_input: AppendGatewayChangeEventInput) => ({ revision: 1n }) },
      crossings: GatewayBudgetCrossingService.create({
        budgets: {
          listSpendTenantIds: async () => [TENANT_ID],
          findBucketBoundaries: async (): Promise<BucketBoundaryRow[]> => [],
        },
        spend: repo,
        facts,
      }),
    });
    const payload = writeGatewayDebitsSchema.parse({
      gateway_request_id: REQUEST_ID,
      project_id: TENANT_ID,
      organization_id: `org-${suffix}`,
      virtual_key_id: `vk-${suffix}`,
      model: "gpt-x",
      model_provider_id: "openai",
      usage: null,
      cost_nano_usd: COST_NANO_USD,
      rate_version: "v1",
      status: "confirmed",
      duration_ms: 10,
      occurred_at: nowInstant().epochMilliseconds,
    });

    firstAttempt = await debits.write(payload).catch((error: unknown) => error);
    await debits.write(payload);
  }, 120_000);

  describe("when the outbox re-drives it", () => {
    /** @scenario "A re-driven debit writes nothing new" */
    it("keeps the one ledger row the first attempt wrote", async () => {
      expect(firstAttempt).toBeInstanceOf(Error);
      const client = createTestClickHouseClient(chUrl!);
      const result = await client.query({
        query:
          "SELECT count() AS rows FROM gateway_budget_ledger_events WHERE TenantId = {tenant:String} AND GatewayRequestId = {request:String}",
        query_params: { tenant: TENANT_ID, request: REQUEST_ID },
        format: "JSONEachRow",
      });
      expect(await result.json()).toEqual([{ rows: "1" }]);
    });

    /** @scenario "The calendar-window total counts a re-driven request once" */
    it("reads the request's cost once from the month's rollup, and records its breach", async () => {
      const [spend] = await repo.getSpendForBudgets(TENANT_ID, [resolved.budget]);

      expect(spend?.spentUsd).toBe("2");
      expect(facts.recorded.map((c) => [c.kind, c.spent_usd])).toEqual([["breached", "2.000000"]]);
    });
  });
});
