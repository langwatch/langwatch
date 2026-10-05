/**
 * Post-debit crossing detection against in-memory collaborators: which spend
 * read it asks for, and which crossings it records.
 */
import type {
  GatewayResolvedBudget,
  GatewayBudgetScopeType,
  RecordBudgetCrossingCommandData,
} from "@langwatch/gateway-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  BudgetSpendTarget,
  ScopeSpend,
} from "../../repositories/gateway-budget-spend.repository.ts";
import type { BucketBoundaryRow } from "../../repositories/gateway-budget.repository.ts";
import { GatewayBudgetCrossingService } from "../gateway-budget-crossing.service.ts";

const NOW = Temporal.Instant.from("2026-09-15T12:00:00Z");
const MONTH_START = Temporal.Instant.from("2026-09-01T00:00:00Z").epochMilliseconds;
const RESET_AT = Temporal.Instant.from("2026-09-10T00:00:00Z");
const epoch = Temporal.Instant.fromEpochMilliseconds(0);

function resolved({
  id,
  limitUsd = "100",
  scopeType = "VIRTUAL_KEY",
  bucketScopeId = `${id}-bucket`,
  cycleAnchorAt = null,
}: {
  id: string;
  limitUsd?: string;
  scopeType?: GatewayBudgetScopeType;
  bucketScopeId?: string;
  cycleAnchorAt?: Instant | null;
}): GatewayResolvedBudget {
  return {
    budget: {
      id,
      organizationId: "org-1",
      scopeType,
      scopeId: "vk-1",
      providerKey: null,
      name: id,
      description: null,
      window: "MONTH",
      limitUsd: { toString: () => limitUsd, toFixed: () => limitUsd },
      onBreach: "BLOCK",
      timezone: null,
      externalId: null,
      metadata: null,
      spentUsd: { toString: () => "0", toFixed: () => "0" },
      currentPeriodStartedAt: epoch,
      resetsAt: epoch,
      lastResetAt: null,
      cycleAnchorAt,
      archivedAt: null,
      createdAt: epoch,
      updatedAt: epoch,
      createdById: "usr-1",
      managedByVirtualKeyId: null,
    },
    bucketScopeId,
    principalUserId: null,
    groupId: null,
    endUserId: null,
  };
}

class StaticBudgets {
  constructor(private readonly boundaries: BucketBoundaryRow[] = []) {}

  async listSpendTenantIds(): Promise<string[]> {
    return ["project-1", "project-2"];
  }

  async findBucketBoundaries(): Promise<BucketBoundaryRow[]> {
    return this.boundaries;
  }
}

class StaticSpend {
  readonly asked: BudgetSpendTarget[][] = [];

  constructor(
    private readonly spent: Record<string, string>,
    private readonly refusal?: Error,
  ) {}

  async findSpendForTargetsAcrossTenants(
    _tenantIds: string[],
    targets: BudgetSpendTarget[],
  ): Promise<ScopeSpend[]> {
    if (this.refusal) throw this.refusal;
    this.asked.push(targets);
    return targets.map((t) => ({
      budgetId: t.budgetId,
      scope: t.scope,
      scopeId: t.scopeId,
      spentUsd: this.spent[t.budgetId] ?? "0",
      spentNanoUsd: 0,
    }));
  }
}

class RecordingFacts {
  readonly recorded: RecordBudgetCrossingCommandData[] = [];

  async recordBudgetCrossing(data: RecordBudgetCrossingCommandData): Promise<void> {
    this.recorded.push(data);
  }
}

function harness({
  spent,
  boundaries,
  refusal,
  now = NOW,
}: {
  spent: Record<string, string>;
  boundaries?: BucketBoundaryRow[];
  refusal?: Error;
  now?: Instant;
}) {
  const spend = new StaticSpend(spent, refusal);
  const facts = new RecordingFacts();
  const crossings = GatewayBudgetCrossingService.create({
    budgets: new StaticBudgets(boundaries),
    spend,
    facts,
    clock: () => now,
  });
  return { crossings, spend, facts };
}

describe("GatewayBudgetCrossingService", () => {
  describe("given buckets below, above and past their limit", () => {
    /** @scenario "Crossing detection reads the boundary-aware figure" */
    it("records a threshold for the one above the line and a breach for the one past it", async () => {
      const { crossings, facts } = harness({
        spent: { below: "10", above: "85", past: "120" },
      });

      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: [resolved({ id: "below" }), resolved({ id: "above" }), resolved({ id: "past" })],
      });

      expect(facts.recorded.map((c) => [c.budget_id, c.kind])).toEqual([
        ["above", "threshold_crossed"],
        ["past", "breached"],
      ]);
      expect(facts.recorded[1]).toMatchObject({
        tenantId: "project-1",
        organization_id: "org-1",
        scope_type: "virtual_key",
        bucket_scope_id: "past-bucket",
        virtual_key_id: "vk-1",
        anchor_project_id: null,
        window: "MONTH",
        period_started_at_ms: MONTH_START,
        limit_usd: "100.000000",
        spent_usd: "120.000000",
        on_breach: "block",
        occurred_at: NOW.epochMilliseconds,
      });
    });

    it("reads a bucket reset mid-period from its reset, and stamps that period", async () => {
      const { crossings, spend, facts } = harness({
        spent: { reset: "90" },
        boundaries: [
          { budgetId: "reset", bucketScopeId: "reset-bucket", periodStartedAt: RESET_AT },
        ],
      });

      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: [resolved({ id: "reset" })],
      });

      expect(spend.asked[0]?.[0]?.periodFloorMs).toBe(RESET_AT.epochMilliseconds);
      expect(facts.recorded[0]?.period_started_at_ms).toBe(RESET_AT.epochMilliseconds);
    });
  });

  describe("given every bucket below its warn line", () => {
    /** @scenario "Spend below the warn line records no crossing" */
    it("records nothing", async () => {
      const { crossings, facts } = harness({ spent: { a: "79" } });

      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: [resolved({ id: "a" })],
      });

      expect(facts.recorded).toEqual([]);
    });
  });

  describe("given a budget with no positive limit", () => {
    /** @scenario "A budget without a positive limit never crosses" */
    it("records nothing however much was spent", async () => {
      const { crossings, facts } = harness({ spent: { zero: "500" } });

      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: [resolved({ id: "zero", limitUsd: "0" })],
      });

      expect(facts.recorded).toEqual([]);
    });
  });

  describe("given the spend read fails", () => {
    /** @scenario "A failed crossing read re-drives the debit" */
    it("throws, so the debit that triggered it is re-driven", async () => {
      const refusal = new Error("clickhouse read timed out");
      const { crossings, facts } = harness({ spent: {}, refusal });

      await expect(
        crossings.detect({
          tenantId: "project-1",
          organizationId: "org-1",
          budgets: [resolved({ id: "a" })],
        }),
      ).rejects.toBe(refusal);
      expect(facts.recorded).toEqual([]);
    });
  });

  describe("given an anchored budget that crosses its limit", () => {
    const anchor = Temporal.Instant.from("2026-06-17T09:00:00Z");
    const crossingAt = async (now: Instant) => {
      const { crossings, facts } = harness({ spent: { anchored: "120" }, now });
      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: [resolved({ id: "anchored", cycleAnchorAt: anchor })],
      });
      return facts.recorded[0]?.period_started_at_ms;
    };

    /** @scenario A breach fires once per anchored period */
    it("stamps the anchored period start, holding it inside the period and moving it after", async () => {
      const early = await crossingAt(Temporal.Instant.from("2026-09-20T00:00:00Z"));
      const late = await crossingAt(Temporal.Instant.from("2026-10-10T00:00:00Z"));
      const afterRollover = await crossingAt(Temporal.Instant.from("2026-10-18T00:00:00Z"));

      expect(early).toBe(Temporal.Instant.from("2026-09-17T09:00:00Z").epochMilliseconds);
      expect(late).toBe(early);
      expect(afterRollover).toBe(Temporal.Instant.from("2026-10-17T09:00:00Z").epochMilliseconds);
    });
  });
});
