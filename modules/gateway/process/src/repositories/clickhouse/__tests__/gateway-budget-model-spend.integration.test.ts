/**
 * A key budget bucket's spend per model, against real ClickHouse: the read a crossing names its
 * top model from.
 * @vitest-environment node
 * @see modules/gateway/specs/gateway-governance-events.feature
 */
import { type Instant, nowInstant, Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { topModelOf } from "../../../rules/gateway-budget-crossing.rules.ts";
import type { BudgetSpendTarget } from "../../gateway-budget-spend.repository.ts";
import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import {
  createTestClickHouseClient,
  gatewayClickHouseOver,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const chUrl = testClickHouseUrl();
const suffix = nanoid(8);
const TENANT_ID = `proj-model-spend-${suffix}`;
const KEY_ID = `vk-model-spend-${suffix}`;
const KEY_BUDGET_ID = `bdg-key-${suffix}`;
const PROJECT_BUDGET_ID = `bdg-project-${suffix}`;
const NOW = nowInstant();
const FLOOR_MS = NOW.subtract({ hours: 1 }).epochMilliseconds;

const target: BudgetSpendTarget & { periodFloorMs: number } = {
  budgetId: KEY_BUDGET_ID,
  scope: "VIRTUAL_KEY",
  scopeId: KEY_ID,
  window: "MONTH",
  match: "exact",
  periodFloorMs: FLOOR_MS,
};

let repo: GatewayBudgetClickHouseRepository;

/** One request debited against the key's budget and the project's, as a real request is. */
async function request({
  model,
  amountNanoUsd,
  status = "SUCCESS",
  occurredAt = NOW,
  gatewayRequestId = `grq_${nanoid()}`,
}: {
  model: string;
  amountNanoUsd: number;
  status?: "SUCCESS" | "PROVIDER_ERROR";
  occurredAt?: Instant;
  gatewayRequestId?: string;
}): Promise<void> {
  const shared = {
    tenantId: TENANT_ID,
    window: "MONTH" as const,
    virtualKeyId: KEY_ID,
    gatewayRequestId,
    amountNanoUsd,
    tokensInput: 10,
    tokensOutput: 10,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    model,
    durationMs: 100,
    status,
    occurredAt,
  };
  await repo.insertDebitsForBudgets([
    { ...shared, budgetId: KEY_BUDGET_ID, scope: "VIRTUAL_KEY", scopeId: KEY_ID },
    { ...shared, budgetId: PROJECT_BUDGET_ID, scope: "PROJECT", scopeId: TENANT_ID },
  ]);
}

describe.skipIf(!chUrl)("given requests on a key over several models and budgets", () => {
  beforeAll(async () => {
    repo = new GatewayBudgetClickHouseRepository(
      gatewayClickHouseOver(createTestClickHouseClient(chUrl!)),
    );
    const replayed = `grq_replayed_${suffix}`;
    await request({ model: "gpt-5-mini", amountNanoUsd: 400, gatewayRequestId: replayed });
    await request({ model: "gpt-5-mini", amountNanoUsd: 400, gatewayRequestId: replayed });
    await request({ model: "gpt-5-mini", amountNanoUsd: 220 });
    await request({ model: "claude-sonnet", amountNanoUsd: 380 });
    await request({ model: "claude-sonnet", amountNanoUsd: 9_000, status: "PROVIDER_ERROR" });
    await request({
      model: "claude-sonnet",
      amountNanoUsd: 9_000,
      occurredAt: Temporal.Instant.fromEpochMilliseconds(FLOOR_MS).subtract({ hours: 1 }),
    });
  }, 120_000);

  describe("when the key budget's spend by model is read since its period start", () => {
    /** @scenario "A key budget's spend by model counts each request once in ClickHouse" */
    it("counts each request once, only successful ones in the period, and names gpt-5-mini at 62%", async () => {
      const spend = await repo.findModelSpendForTarget({ tenantIds: [TENANT_ID], target });

      expect(spend.toSorted((a, b) => (a.model < b.model ? -1 : 1))).toEqual([
        { model: "claude-sonnet", spentNanoUsd: 380n },
        { model: "gpt-5-mini", spentNanoUsd: 620n },
      ]);
      expect(topModelOf(spend)).toEqual({ outcome: "named", model: "gpt-5-mini", share: 0.62 });
    });
  });
});
