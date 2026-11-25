/**
 * Post-debit crossing detection against in-memory collaborators: which spend
 * read it asks for, and which crossings it records.
 */
import type {
  GatewayResolvedBudget,
  GatewayBudgetScopeType,
  GatewayBudgetWindow,
  RecordBudgetCrossingCommandData,
} from "@langwatch/gateway-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { GatewayBudgetCrossingService } from "../../features/budget/services/gateway-budget-crossing.service.ts";
import type {
  BudgetSpendTarget,
  ModelSpend,
  ScopeSpend,
} from "../../repositories/gateway-budget-spend.repository.ts";
import type { BucketBoundaryRow } from "../../repositories/gateway-budget.repository.ts";

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
  window = "MONTH",
}: {
  id: string;
  limitUsd?: string;
  scopeType?: GatewayBudgetScopeType;
  bucketScopeId?: string;
  cycleAnchorAt?: Instant | null;
  window?: GatewayBudgetWindow;
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
      window,
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
  readonly askedByModel: BudgetSpendTarget[] = [];

  constructor(
    private readonly spent: Record<string, string>,
    private readonly refusal?: Error,
    private readonly byModel: ModelSpend[] = [],
    private readonly byModelRefusal?: Error,
  ) {}

  async findModelSpendForTarget({
    target,
  }: {
    tenantIds: string[];
    target: BudgetSpendTarget & { periodFloorMs: number };
  }): Promise<ModelSpend[]> {
    this.askedByModel.push(target);
    if (this.byModelRefusal) throw this.byModelRefusal;
    return this.byModel;
  }

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
  byModel,
  byModelRefusal,
  now = NOW,
}: {
  spent: Record<string, string>;
  boundaries?: BucketBoundaryRow[];
  refusal?: Error;
  byModel?: ModelSpend[];
  byModelRefusal?: Error;
  now?: Instant;
}) {
  const spend = new StaticSpend(spent, refusal, byModel, byModelRefusal);
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
        period_ends_at_ms: Temporal.Instant.from("2026-10-01T00:00:00Z").epochMilliseconds,
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

  describe("given a monthly budget anchored on the 31st", () => {
    describe("when it crosses in the period that starts on 28 February", () => {
      /** @scenario "A crossing carries when its period ends" */
      it("stamps that period's start and its end on 31 March, by gateway's own window logic", async () => {
        const anchor = Temporal.Instant.from("2027-01-31T00:00:00Z");
        const { crossings, facts } = harness({
          spent: { anchored: "90" },
          now: Temporal.Instant.from("2027-03-10T12:00:00Z"),
        });

        await crossings.detect({
          tenantId: "project-1",
          organizationId: "org-1",
          budgets: [resolved({ id: "anchored", cycleAnchorAt: anchor })],
        });

        expect(facts.recorded[0]).toMatchObject({
          period_started_at_ms: Temporal.Instant.from("2027-02-28T00:00:00Z").epochMilliseconds,
          period_ends_at_ms: Temporal.Instant.from("2027-03-31T00:00:00Z").epochMilliseconds,
        });
      });
    });
  });

  describe("given a budget whose window never rolls", () => {
    /** @scenario "A crossing carries when its period ends" */
    it("records a TOTAL budget's crossing with no period end, never the far-future sentinel", async () => {
      const { crossings, facts } = harness({ spent: { lifetime: "120" } });

      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: [resolved({ id: "lifetime", window: "TOTAL" })],
      });

      expect(facts.recorded.map((crossing) => crossing.period_ends_at_ms)).toEqual([null]);
    });
  });

  describe("given a key's own budget past its warn line, 62% of its spend on gpt-5-mini", () => {
    const byModel: ModelSpend[] = [
      { model: "claude-sonnet", spentNanoUsd: 380n },
      { model: "gpt-5-mini", spentNanoUsd: 620n },
    ];

    /** @scenario "A key budget's crossing names the model it spent most on" */
    it("records the crossing with gpt-5-mini and its 0.62 share, read over the stamped period", async () => {
      const { crossings, spend, facts } = harness({ spent: { key: "85" }, byModel });

      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: [resolved({ id: "key" })],
      });

      expect(facts.recorded[0]).toMatchObject({
        budget_id: "key",
        kind: "threshold_crossed",
        top_model: "gpt-5-mini",
        top_model_spend_share: 0.62,
      });
      expect(spend.askedByModel).toEqual([
        expect.objectContaining({
          budgetId: "key",
          scopeId: "key-bucket",
          periodFloorMs: MONTH_START,
        }),
      ]);
    });

    /** @scenario "A key budget's crossing names the model it spent most on" */
    it("reads by model once per crossing however many debits follow, and again for the breach", async () => {
      const spent = { key: "85" };
      const { crossings, spend, facts } = harness({ spent, byModel });
      const debit = () =>
        crossings.detect({
          tenantId: "project-1",
          organizationId: "org-1",
          budgets: [resolved({ id: "key" })],
        });

      for (let count = 0; count < 100; count++) await debit();
      expect(spend.askedByModel).toHaveLength(1);

      spent.key = "120";
      await debit();

      expect(spend.askedByModel).toHaveLength(2);
      expect(facts.recorded.map((crossing) => [crossing.kind, crossing.top_model]).at(-1)).toEqual([
        "breached",
        "gpt-5-mini",
      ]);
      expect(new Set(facts.recorded.map((crossing) => crossing.top_model))).toEqual(
        new Set(["gpt-5-mini"]),
      );
    });
  });

  describe("given a key's spend split evenly over two models", () => {
    /** @scenario "A key budget's crossing names the model it spent most on" */
    it("names the first by name at half the spend", async () => {
      const { crossings, facts } = harness({
        spent: { key: "85" },
        byModel: [
          { model: "gpt-5-mini", spentNanoUsd: 500n },
          { model: "claude-sonnet", spentNanoUsd: 500n },
        ],
      });

      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: [resolved({ id: "key" })],
      });

      expect(facts.recorded[0]).toMatchObject({
        top_model: "claude-sonnet",
        top_model_spend_share: 0.5,
      });
    });
  });

  describe("given the by-model read fails", () => {
    /** @scenario "A failed top-model read still records the crossing" */
    it("records the crossing without a top model, and does not re-drive the debit", async () => {
      const { crossings, facts } = harness({
        spent: { key: "85" },
        byModelRefusal: new Error("clickhouse read timed out"),
      });

      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: [resolved({ id: "key" })],
      });

      expect(facts.recorded).toHaveLength(1);
      expect(facts.recorded[0]).not.toHaveProperty("top_model");
      expect(facts.recorded[0]).not.toHaveProperty("top_model_spend_share");
    });
  });

  describe("given crossings of budgets that are not a key's own", () => {
    /** @scenario "A key budget's crossing names the model it spent most on" */
    it("records each without a top model and never reads by model", async () => {
      const scopes: GatewayBudgetScopeType[] = [
        "PROJECT",
        "TEAM",
        "ORGANIZATION",
        "PRINCIPAL",
        "ATTRIBUTED_USER",
      ];
      const { crossings, spend, facts } = harness({
        spent: Object.fromEntries(scopes.map((scope) => [scope, "90"])),
        byModel: [{ model: "gpt-5-mini", spentNanoUsd: 1n }],
      });

      await crossings.detect({
        tenantId: "project-1",
        organizationId: "org-1",
        budgets: scopes.map((scope) => resolved({ id: scope, scopeType: scope })),
      });

      expect(facts.recorded).toHaveLength(scopes.length);
      for (const crossing of facts.recorded) expect(crossing).not.toHaveProperty("top_model");
      expect(spend.askedByModel).toEqual([]);
    });
  });
});
