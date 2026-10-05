/**
 * The sole debit writer against in-memory collaborators: which rows reach the
 * ledger and which BUDGET_UPDATED change events reach the feed, rather than
 * ClickHouse or Postgres.
 */
import type {
  GatewayBudgetResolutionTarget,
  GatewayBudgetScopeType,
  GatewayResolvedBudget,
} from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { writeGatewayDebitsSchema } from "../../eventing/gateway-debit.intent.ts";
import { GatewayBudgetChangeDedupeRepository } from "../../repositories/gateway-budget-change-dedupe.repository.ts";
import type {
  BudgetDebitRow,
  GatewayBudgetSpendRepository,
} from "../../repositories/gateway-budget-spend.repository.ts";
import type {
  AppendGatewayChangeEventInput,
  GatewayChangeEventsRepository,
} from "../../repositories/gateway-change-event.repository.ts";
import { GatewayBudgetChangeDedupeService } from "../gateway-budget-change-dedupe.service.ts";
import type { GatewayBudgetCrossingService } from "../gateway-budget-crossing.service.ts";
import { GatewaySpendDebitService } from "../gateway-spend-debit.service.ts";
import type { GatewayService } from "../gateway.service.ts";

const epoch = Temporal.Instant.fromEpochMilliseconds(0);

function resolved({
  id,
  onBreach = "WARN",
  scopeType = "PROJECT",
  providerKey = null,
}: {
  id: string;
  onBreach?: "BLOCK" | "WARN";
  scopeType?: GatewayBudgetScopeType;
  providerKey?: string | null;
}): GatewayResolvedBudget {
  return {
    budget: {
      id,
      organizationId: "org-1",
      scopeType,
      scopeId: `${scopeType.toLowerCase()}-scope`,
      providerKey,
      name: id,
      description: null,
      window: "MONTH",
      limitUsd: { toString: () => "50", toFixed: () => "50.00" },
      onBreach,
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
    bucketScopeId: `${scopeType.toLowerCase()}-bucket`,
    principalUserId: null,
    groupId: null,
    endUserId: null,
  };
}

class StaticBudgets implements Pick<GatewayService, "resolveApplicableBudgets"> {
  readonly asked: GatewayBudgetResolutionTarget[] = [];

  constructor(private readonly budgets: GatewayResolvedBudget[]) {}

  async resolveApplicableBudgets(
    target: GatewayBudgetResolutionTarget,
  ): Promise<GatewayResolvedBudget[]> {
    this.asked.push(target);
    return this.budgets;
  }
}

class RecordingLedger implements Pick<GatewayBudgetSpendRepository, "insertDebitsForBudgets"> {
  readonly batches: BudgetDebitRow[][] = [];

  constructor(private readonly refusal?: Error) {}

  async insertDebitsForBudgets(rows: BudgetDebitRow[]): Promise<void> {
    if (this.refusal) throw this.refusal;
    this.batches.push(rows);
  }
}

/** Records each detection after the ledger's rows, so the order is observable. */
class RecordingCrossings implements Pick<GatewayBudgetCrossingService, "detect"> {
  readonly detected: { tenantId: string; budgetIds: string[] }[] = [];

  constructor(
    private readonly ledger: RecordingLedger,
    private readonly refusal?: Error,
  ) {}

  async detect(input: {
    tenantId: string;
    organizationId: string;
    budgets: GatewayResolvedBudget[];
  }): Promise<void> {
    if (this.ledger.batches.length === 0) throw new Error("detected before the debit landed");
    if (this.refusal) throw this.refusal;
    this.detected.push({
      tenantId: input.tenantId,
      budgetIds: input.budgets.map(({ budget }) => budget.id),
    });
  }
}

class RecordingChanges implements Pick<GatewayChangeEventsRepository, "append"> {
  readonly appended: AppendGatewayChangeEventInput[] = [];

  async append(input: AppendGatewayChangeEventInput): Promise<{ revision: bigint }> {
    this.appended.push(input);
    return { revision: BigInt(this.appended.length) };
  }
}

/** One window per project, as Redis SET NX holds it, until the test says it lapsed. */
class MemoryDedupeWindows extends GatewayBudgetChangeDedupeRepository {
  readonly claimed = new Set<string>();

  async claimWindow({ projectId }: { projectId: string }): Promise<boolean> {
    if (this.claimed.has(projectId)) return false;
    this.claimed.add(projectId);
    return true;
  }
}

const payload = (overrides: Record<string, unknown> = {}) =>
  writeGatewayDebitsSchema.parse({
    gateway_request_id: "req-1",
    project_id: "project-1",
    organization_id: "org-1",
    team_id: "team-1",
    virtual_key_id: "vk-1",
    principal_user_id: "usr-1",
    end_user_id: "",
    model: "gpt-x",
    model_provider_id: "openai",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 1,
      reasoning_tokens: 0,
    },
    cost_nano_usd: 420_000_000,
    rate_version: "catalog@2026-07-30",
    status: "confirmed",
    duration_ms: 120,
    occurred_at: 1_753_800_000_000,
    ...overrides,
  });

function harness({
  budgets,
  windows = new MemoryDedupeWindows(),
  refusal,
  detectionRefusal,
}: {
  budgets: GatewayResolvedBudget[];
  windows?: GatewayBudgetChangeDedupeRepository | null;
  refusal?: Error;
  detectionRefusal?: Error;
}) {
  const resolver = new StaticBudgets(budgets);
  const ledger = new RecordingLedger(refusal);
  const changes = new RecordingChanges();
  const crossings = new RecordingCrossings(ledger, detectionRefusal);
  const debits = GatewaySpendDebitService.create({
    budgets: resolver,
    spend: ledger,
    dedupe: GatewayBudgetChangeDedupeService.create(windows),
    changes,
    crossings,
  });
  return { debits, resolver, ledger, changes, crossings };
}

describe("GatewaySpendDebitService", () => {
  describe("given a request whose target resolves every scope's budget", () => {
    /** @scenario The debits process writes one ledger row per applicable budget INCLUDING PRINCIPAL */
    it("writes one row per budget under the one request id, priced as the outcome was", async () => {
      const scopes: GatewayBudgetScopeType[] = [
        "ORGANIZATION",
        "TEAM",
        "PROJECT",
        "VIRTUAL_KEY",
        "PRINCIPAL",
      ];
      const { debits, resolver, ledger } = harness({
        budgets: scopes.map((scopeType) => resolved({ id: `b-${scopeType}`, scopeType })),
      });

      await debits.write(payload());

      expect(resolver.asked).toEqual([
        {
          organizationId: "org-1",
          teamId: "team-1",
          projectId: "project-1",
          virtualKeyId: "vk-1",
          principalUserId: "usr-1",
          endUserId: null,
        },
      ]);
      const rows = ledger.batches.flat();
      expect(rows.map((row) => row.scope)).toEqual(scopes);
      expect(new Set(rows.map((row) => row.gatewayRequestId))).toEqual(new Set(["req-1"]));
      expect(rows.find((row) => row.scope === "PRINCIPAL")).toMatchObject({
        budgetId: "b-PRINCIPAL",
        scopeId: "principal-bucket",
        tenantId: "project-1",
        amountNanoUsd: 420_000_000,
        tokensInput: 10,
        tokensOutput: 5,
        tokensCacheRead: 2,
        tokensCacheWrite: 1,
        providerKey: "openai",
        status: "SUCCESS",
      });
    });
  });

  describe("given a budget scoped to another provider", () => {
    /** @scenario Spend debits every budget the request applies to */
    it("debits the provider's and every-provider budgets and leaves the other alone", async () => {
      const { debits, ledger, changes } = harness({
        budgets: [
          resolved({ id: "any" }),
          resolved({ id: "openai-only", providerKey: "openai" }),
          resolved({ id: "anthropic-only", providerKey: "anthropic" }),
        ],
      });

      await debits.write(payload());

      expect(ledger.batches.flat().map((row) => row.budgetId)).toEqual(["any", "openai-only"]);
      expect(changes.appended).toEqual([
        {
          organizationId: "org-1",
          projectId: "project-1",
          kind: "BUDGET_UPDATED",
          payload: {
            gatewayRequestId: "req-1",
            virtualKeyId: "vk-1",
            budgetIds: ["any", "openai-only"],
          },
        },
      ]);
    });

    it("writes nothing and announces nothing when no budget applies", async () => {
      const { debits, ledger, changes } = harness({
        budgets: [resolved({ id: "anthropic-only", providerKey: "anthropic" })],
      });

      await debits.write(payload());

      expect(ledger.batches).toEqual([]);
      expect(changes.appended).toEqual([]);
    });
  });

  describe("given a failed outcome", () => {
    it("records a guardrail refusal apart from a provider error", async () => {
      const { debits, ledger } = harness({ budgets: [resolved({ id: "b" })] });

      await debits.write(
        payload({ status: "failed", error_type: "guardrail_blocked", usage: null }),
      );
      await debits.write(payload({ status: "failed", error_type: "provider_timeout" }));

      expect(ledger.batches.flat().map((row) => [row.status, row.tokensInput])).toEqual([
        ["BLOCKED_BY_GUARDRAIL", 0],
        ["PROVIDER_ERROR", 10],
      ]);
    });
  });

  describe("given the budget ledger refuses the insert", () => {
    /** @scenario A debit that fails to land is retried rather than dropped */
    it("fails the write so the outbox retries it, and announces nothing", async () => {
      const refusal = new Error("clickhouse unavailable");
      const { debits, changes } = harness({ budgets: [resolved({ id: "b" })], refusal });

      await expect(debits.write(payload())).rejects.toBe(refusal);
      expect(changes.appended).toEqual([]);
    });
  });

  describe("given the debit landed", () => {
    /** @scenario "A crossing is detected after the debit lands" */
    it("runs crossing detection over the debited budgets once the rows are written", async () => {
      const { debits, crossings } = harness({
        budgets: [
          resolved({ id: "any" }),
          resolved({ id: "anthropic-only", providerKey: "anthropic" }),
        ],
      });

      await debits.write(payload());

      expect(crossings.detected).toEqual([{ tenantId: "project-1", budgetIds: ["any"] }]);
    });
  });

  describe("given crossing detection fails after the debit landed", () => {
    /** @scenario "A failed crossing read re-drives the debit" */
    it("fails the write so the outbox re-drives it, and announces nothing yet", async () => {
      const refusal = new Error("clickhouse read timed out");
      const { debits, ledger, changes } = harness({
        budgets: [resolved({ id: "b" })],
        detectionRefusal: refusal,
      });

      await expect(debits.write(payload())).rejects.toBe(refusal);
      expect(ledger.batches).toHaveLength(1);
      expect(changes.appended).toEqual([]);
    });
  });

  describe("given a budget that blocks on breach", () => {
    /** @scenario "A blocking budget's spend update is never held back" */
    it("emits inside an already-claimed window, for the whole set it sits among", async () => {
      const windows = new MemoryDedupeWindows();
      windows.claimed.add("project-1");
      const { debits, changes } = harness({
        budgets: [resolved({ id: "b-warn" }), resolved({ id: "b-block", onBreach: "BLOCK" })],
        windows,
      });

      await debits.write(payload());

      expect(changes.appended.map((change) => change.payload)).toEqual([
        { gatewayRequestId: "req-1", virtualKeyId: "vk-1", budgetIds: ["b-warn", "b-block"] },
      ]);
    });
  });

  describe("given a budget that only warns on breach", () => {
    /** @scenario "Repeat updates for a warn-only budget collapse into one" */
    /** @scenario Two debits inside one window emit a single budget-updated signal */
    it("records both debits and appends one budget-updated signal per window", async () => {
      const { debits, ledger, changes } = harness({ budgets: [resolved({ id: "b-warn" })] });

      await debits.write(payload());
      await debits.write(payload({ gateway_request_id: "req-2" }));

      expect(ledger.batches).toHaveLength(2);
      expect(changes.appended).toHaveLength(1);
    });

    /** @scenario A process with no Redis emits a budget-updated signal for every debit */
    it("emits for every debit when the process has no dedupe store", async () => {
      const { debits, changes } = harness({ budgets: [resolved({ id: "b-warn" })], windows: null });

      await debits.write(payload());
      await debits.write(payload({ gateway_request_id: "req-2" }));

      expect(changes.appended).toHaveLength(2);
    });

    it("keeps the debit when the change feed refuses the announcement", async () => {
      const { debits, ledger, changes } = harness({ budgets: [resolved({ id: "b-warn" })] });
      changes.append = () => Promise.reject(new Error("postgres unavailable"));

      await expect(debits.write(payload())).resolves.toBeUndefined();
      expect(ledger.batches).toHaveLength(1);
    });
  });
});
