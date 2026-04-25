/**
 * Trace-driven budget ledger in ClickHouse.
 *
 * Replaces the old PG `GatewayBudgetLedger.create` + `GatewayBudget.spentUsd`
 * counter path. The gateway no longer POSTs debits — instead, the trace it
 * emits (carrying `langwatch.virtual_key_id`, `langwatch.gateway_request_id`,
 * token counts, enriched cost) is the source of truth. The
 * `gatewayBudgetSync` reactor in the trace-processing pipeline calls
 * `insertDebit` on this repo once per applicable budget.
 *
 * Tables:
 *   - gateway_budget_ledger_events      — ReplacingMergeTree, idempotent by
 *                                         (TenantId, BudgetId, GatewayRequestId)
 *   - gateway_budget_scope_totals       — AggregatingMergeTree rollup per
 *                                         (scope, scope_id, window, period_start)
 *   - gateway_budget_scope_totals_mv    — MV feeding the rollup from events
 *
 * See: migration 00017_create_gateway_budget_ledger.sql
 * See: specs/ai-gateway/_shared/contract.md §4.5
 */
import type {
  GatewayBudget,
  GatewayBudgetLedgerStatus,
  GatewayBudgetScopeType,
  GatewayBudgetWindow,
} from "@prisma/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";

const EVENTS_TABLE = "gateway_budget_ledger_events" as const;
const TOTALS_TABLE = "gateway_budget_scope_totals" as const;

const logger = createLogger(
  "langwatch:gateway:budget-clickhouse-repository",
);

export type BudgetDebitRow = {
  tenantId: string;
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  virtualKeyId: string;
  providerCredentialId?: string | null;
  gatewayRequestId: string;
  amountUsd: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  providerSlot?: string | null;
  durationMs?: number | null;
  status: GatewayBudgetLedgerStatus;
  occurredAt: Date;
};

export type ScopeSpend = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  spentUsd: string;
};

/**
 * Read-shape for ledger events. Mirrors the columns previously read off
 * the PG `GatewayBudgetLedger` table, scoped to whatever the caller needs
 * (one VK, one budget, or all VKs in a project). All fields use the same
 * names as the equivalent Prisma row so call sites can be migrated with
 * minimal shape juggling.
 */
export type LedgerEventRow = {
  id: string; // GatewayRequestId — unique within (tenant, budget)
  budgetId: string;
  virtualKeyId: string;
  amountUsd: string; // Decimal-as-string
  model: string;
  providerSlot: string | null;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number | null;
  status: GatewayBudgetLedgerStatus;
  occurredAt: Date;
};

export class GatewayBudgetClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /**
   * Insert one debit row per applicable budget. Idempotency is structural at
   * the ledger table level (ReplacingMergeTree on (TenantId, BudgetId,
   * GatewayRequestId) collapses replays on merge), but the
   * gateway_budget_scope_totals materialised view aggregates at INSERT time
   * and does NOT dedup. Without a pre-insert guard, replaying the same
   * gateway_request_id multiplies the rollup totals (3 fires of $0.0125 →
   * $0.0375 visible to /budget/check until the merge eventually fires —
   * which can be hours later or never if the ledger sees no further
   * activity).
   *
   * App-side dedup: skip the insert entirely if any row for this
   * (TenantId, GatewayRequestId) already exists in the ledger. The ledger
   * ORDER BY is `(TenantId, BudgetId, GatewayRequestId)` so this query
   * hits the index and is sub-millisecond. All rows in a single insertDebit
   * call share the same gateway_request_id (one reactor fire = one VK
   * trace = one batch covering every applicable budget) so a single
   * existence probe covers the whole batch.
   */
  async insertDebit(rows: BudgetDebitRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tenantId = rows[0]!.tenantId;
    const gatewayRequestId = rows[0]!.gatewayRequestId;
    if (rows.some((r) => r.tenantId !== tenantId)) {
      throw new Error(
        "GatewayBudgetClickHouseRepository.insertDebit: rows span multiple tenants",
      );
    }
    if (rows.some((r) => r.gatewayRequestId !== gatewayRequestId)) {
      throw new Error(
        "GatewayBudgetClickHouseRepository.insertDebit: rows span multiple gateway_request_ids",
      );
    }

    const client = await this.resolveClient(tenantId);
    const probe = await client.query({
      query: `SELECT 1 FROM ${EVENTS_TABLE} WHERE TenantId = {tenantId:String} AND GatewayRequestId = {gatewayRequestId:String} LIMIT 1`,
      query_params: { tenantId, gatewayRequestId },
      format: "JSONEachRow",
    });
    const probeRows = (await probe.json()) as unknown[];
    if (probeRows.length > 0) {
      logger.debug(
        { tenantId, gatewayRequestId, batchSize: rows.length },
        "skipping replay — gateway_request_id already in ledger",
      );
      return;
    }

    const records = rows.map((r) => ({
      TenantId: r.tenantId,
      BudgetId: r.budgetId,
      Scope: scopeToClickHouse(r.scope),
      ScopeId: r.scopeId,
      Window: windowToClickHouse(r.window),
      VirtualKeyId: r.virtualKeyId,
      ProviderCredentialId: r.providerCredentialId ?? "",
      GatewayRequestId: r.gatewayRequestId,
      AmountUSD: r.amountUsd,
      TokensInput: r.tokensInput,
      TokensOutput: r.tokensOutput,
      TokensCacheRead: r.tokensCacheRead,
      TokensCacheWrite: r.tokensCacheWrite,
      Model: r.model,
      ProviderSlot: r.providerSlot ?? "",
      DurationMS: r.durationMs ?? 0,
      Status: r.status.toLowerCase(),
      OccurredAt: r.occurredAt.getTime(),
      EventTimestamp: Date.now(),
    }));

    try {
      await client.insert({
        table: EVENTS_TABLE,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        { tenantId, count: rows.length, error },
        "failed to insert gateway budget ledger events",
      );
      throw error;
    }
  }

  /**
   * Read current-period spend for a set of budgets from the materialised
   * view. Returns one ScopeSpend per budget requested; missing budgets
   * are reported with spentUsd = "0".
   */
  async getSpendForBudgets(
    tenantId: string,
    budgets: GatewayBudget[],
  ): Promise<ScopeSpend[]> {
    if (budgets.length === 0) return [];

    const now = new Date();
    const byWindow = new Map<GatewayBudgetWindow, GatewayBudget[]>();
    for (const b of budgets) {
      const list = byWindow.get(b.window) ?? [];
      list.push(b);
      byWindow.set(b.window, list);
    }

    const out: Map<string, ScopeSpend> = new Map();

    for (const [window, budgetsForWindow] of byWindow) {
      const periodStart = currentPeriodStart(window, now);
      const scopeTuples = budgetsForWindow.map((b) => ({
        scope: scopeToClickHouse(b.scopeType),
        scopeId: b.scopeId,
        budgetId: b.id,
      }));

      // Build a parameter-safe IN clause. We query every (Scope, ScopeId)
      // tuple for this window in one round-trip and stitch results back by
      // budget id after.
      const scopeFilter = scopeTuples
        .map((_, i) => `(Scope = {scope${i}:String} AND ScopeId = {scopeId${i}:String})`)
        .join(" OR ");
      const params: Record<string, string | number> = {
        tenantId,
        window: windowToClickHouse(window),
        periodStart: periodStart.getTime(),
      };
      for (let i = 0; i < scopeTuples.length; i++) {
        params[`scope${i}`] = scopeTuples[i]!.scope;
        params[`scopeId${i}`] = scopeTuples[i]!.scopeId;
      }

      try {
        const client = await this.resolveClient(tenantId);
        const result = await client.query({
          query: `
            SELECT
              Scope,
              ScopeId,
              toString(sumMerge(SpendUSD)) AS SpentUSD
            FROM ${TOTALS_TABLE}
            WHERE TenantId = {tenantId:String}
              AND Window = {window:String}
              AND PeriodStart = fromUnixTimestamp64Milli({periodStart:Int64})
              AND (${scopeFilter})
            GROUP BY Scope, ScopeId
          `,
          query_params: params,
          format: "JSONEachRow",
        });
        type Row = { Scope: string; ScopeId: string; SpentUSD: string };
        const rows = (await result.json()) as Row[];
        const byKey = new Map<string, string>();
        for (const r of rows) {
          byKey.set(`${r.Scope}:${r.ScopeId}`, r.SpentUSD);
        }
        for (const t of scopeTuples) {
          const key = `${t.scope}:${t.scopeId}`;
          out.set(t.budgetId, {
            budgetId: t.budgetId,
            scope: budgetsForWindow.find((b) => b.id === t.budgetId)!
              .scopeType,
            scopeId: t.scopeId,
            spentUsd: byKey.get(key) ?? "0",
          });
        }
      } catch (error) {
        logger.error(
          { tenantId, window, error },
          "failed to read gateway budget scope totals",
        );
        throw error;
      }
    }

    return budgets.map(
      (b) =>
        out.get(b.id) ?? {
          budgetId: b.id,
          scope: b.scopeType,
          scopeId: b.scopeId,
          spentUsd: "0",
        },
    );
  }

  /**
   * Most recent ledger events for a single budget, ordered by `OccurredAt`
   * descending. Used by the budget detail page to render the recent-activity
   * panel (post-cutover replacement for `prisma.gatewayBudgetLedger.findMany`
   * in budget.service.ts:getDetail).
   */
  async recentEventsForBudget(
    tenantId: string,
    budgetId: string,
    limit = 20,
  ): Promise<LedgerEventRow[]> {
    const client = await this.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT
          GatewayRequestId AS id,
          BudgetId AS budgetId,
          VirtualKeyId AS virtualKeyId,
          toString(AmountUSD) AS amountUsd,
          Model AS model,
          ProviderSlot AS providerSlot,
          TokensInput AS tokensInput,
          TokensOutput AS tokensOutput,
          DurationMS AS durationMs,
          Status AS status,
          toUnixTimestamp64Milli(OccurredAt) AS occurredAtMs
        FROM ${EVENTS_TABLE}
        WHERE TenantId = {tenantId:String}
          AND BudgetId = {budgetId:String}
        ORDER BY OccurredAt DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { tenantId, budgetId, limit },
      format: "JSONEachRow",
    });
    type Row = Omit<LedgerEventRow, "occurredAt" | "status"> & {
      occurredAtMs: string;
      status: string;
    };
    const rows = (await result.json()) as Row[];
    return rows.map(toLedgerEventRow);
  }

  /**
   * Ledger events for a set of virtual keys within a time window.
   * Used by the project-wide gateway usage page (post-cutover replacement
   * for `prisma.gatewayBudgetLedger.findMany` in usage.service.ts:summary).
   *
   * Note: a single completion that triggers N applicable budgets produces
   * N ledger rows (one per budget). This matches the pre-cutover PG
   * semantics — callers that want per-request semantics need to dedup
   * by `id` (GatewayRequestId) themselves.
   */
  async eventsForVirtualKeys(
    tenantId: string,
    virtualKeyIds: string[],
    fromDate: Date,
    toDate: Date,
  ): Promise<LedgerEventRow[]> {
    if (virtualKeyIds.length === 0) return [];
    const client = await this.resolveClient(tenantId);
    const params: Record<string, string | number> = {
      tenantId,
      from: fromDate.getTime(),
      to: toDate.getTime(),
    };
    const placeholders = virtualKeyIds
      .map((id, i) => {
        params[`vk${i}`] = id;
        return `{vk${i}:String}`;
      })
      .join(",");
    const result = await client.query({
      query: `
        SELECT
          GatewayRequestId AS id,
          BudgetId AS budgetId,
          VirtualKeyId AS virtualKeyId,
          toString(AmountUSD) AS amountUsd,
          Model AS model,
          ProviderSlot AS providerSlot,
          TokensInput AS tokensInput,
          TokensOutput AS tokensOutput,
          DurationMS AS durationMs,
          Status AS status,
          toUnixTimestamp64Milli(OccurredAt) AS occurredAtMs
        FROM ${EVENTS_TABLE}
        WHERE TenantId = {tenantId:String}
          AND VirtualKeyId IN (${placeholders})
          AND OccurredAt >= fromUnixTimestamp64Milli({from:Int64})
          AND OccurredAt <  fromUnixTimestamp64Milli({to:Int64})
        ORDER BY OccurredAt DESC
      `,
      query_params: params,
      format: "JSONEachRow",
    });
    type Row = Omit<LedgerEventRow, "occurredAt" | "status"> & {
      occurredAtMs: string;
      status: string;
    };
    const rows = (await result.json()) as Row[];
    return rows.map(toLedgerEventRow);
  }
}

function toLedgerEventRow(r: {
  id: string;
  budgetId: string;
  virtualKeyId: string;
  amountUsd: string;
  model: string;
  providerSlot: string | null;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number | null;
  status: string;
  occurredAtMs: string;
}): LedgerEventRow {
  return {
    id: r.id,
    budgetId: r.budgetId,
    virtualKeyId: r.virtualKeyId,
    amountUsd: r.amountUsd,
    model: r.model,
    providerSlot: r.providerSlot && r.providerSlot !== "" ? r.providerSlot : null,
    tokensInput: Number(r.tokensInput),
    tokensOutput: Number(r.tokensOutput),
    durationMs:
      r.durationMs === null || r.durationMs === undefined || Number(r.durationMs) === 0
        ? null
        : Number(r.durationMs),
    status: ledgerStatusFromCH(r.status),
    occurredAt: new Date(Number(r.occurredAtMs)),
  };
}

function ledgerStatusFromCH(raw: string): GatewayBudgetLedgerStatus {
  switch (raw.toLowerCase()) {
    case "success":
      return "SUCCESS";
    case "provider_error":
      return "PROVIDER_ERROR";
    case "blocked_by_guardrail":
      return "BLOCKED_BY_GUARDRAIL";
    case "cancelled":
      return "CANCELLED";
    default:
      return "SUCCESS";
  }
}

function scopeToClickHouse(scope: GatewayBudgetScopeType): string {
  switch (scope) {
    case "ORGANIZATION":
      return "org";
    case "TEAM":
      return "team";
    case "PROJECT":
      return "project";
    case "VIRTUAL_KEY":
      return "virtual_key";
    case "PRINCIPAL":
      return "principal";
  }
}

function windowToClickHouse(window: GatewayBudgetWindow): string {
  return window.toString();
}

/**
 * Start-of-period (UTC) for the current window. Matches the multiIf()
 * branches in the MV (00017_create_gateway_budget_ledger.sql:115-119).
 * Windows smaller than DAY are not yet persisted in the rollup — callers
 * should use the events table directly for sub-day granularity.
 */
function currentPeriodStart(window: GatewayBudgetWindow, now: Date): Date {
  const d = new Date(now.getTime());
  if (window === "DAY") {
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (window === "WEEK") {
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    // ISO week start (Monday). Matches ClickHouse toStartOfWeek mode 1.
    const delta = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - delta);
    return d;
  }
  if (window === "MONTH") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
  // TOTAL / MINUTE / HOUR — the MV doesn't aggregate these. Return epoch
  // so matching queries find no rows and callers fall back to events-scan.
  return new Date(0);
}
