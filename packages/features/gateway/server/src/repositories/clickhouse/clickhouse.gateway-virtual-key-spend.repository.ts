/**
 * Per-virtual-key spend, read from the cost path rather than the budget
 * ledger.
 *
 * The budget ledger holds rows ONLY for keys that have at least one
 * applicable budget, and one row per applicable budget.
 * Reading spend from it therefore reports $0.00 for every key nobody has
 * capped, and multiplies spend by the number of budgets for every key
 * somebody has capped twice. Neither is a number to put in front of a
 * customer, and both disagree with the Usage tab a click-through is
 * supposed to land on.
 *
 * `trace_summaries` carries the enriched per-trace cost and the
 * `langwatch.virtual_key_id` attribute the gateway stamps on every span, so
 * it answers "what did this key cost" for every key, budget or not, and it
 * is the same store the rest of the product bills and reports from.
 *
 * Dedup: `trace_summaries` is a ReplacingMergeTree keyed on
 * (TenantId, TraceId), so every read collapses a trace with
 * `argMax(..., UpdatedAt)` before summing. Without it an unmerged
 * re-projection counts twice.
 */
import { createLogger } from "@langwatch/observability";

import type { GatewayClickHouseResolver } from "../../ports/gateway-clickhouse.port";
import {
  type GatewaySpendWindow,
  type GatewayTraceRow,
  type GatewayUsageBucket,
  type GatewayVirtualKeySpend,
  GatewayVirtualKeySpendPort,
} from "../../ports/gateway-virtual-key-spend.port";
import { usdDisplayString } from "@langwatch/gateway-contract";

const TRACE_SUMMARIES_TABLE = "trace_summaries";
const VK_ATTRIBUTE = "langwatch.virtual_key_id";

const logger = createLogger("langwatch:gateway:virtual-key-spend-repository");

export class GatewayVirtualKeySpendRepository extends GatewayVirtualKeySpendPort {
  constructor(private readonly resolveClient: GatewayClickHouseResolver) {
    super();
  }

  /**
   * Spend per key over a window, summed across the given project tenants.
   *
   * Tenants are plural because a key's traces land in whichever project
   * resolved as its trace destination: for org- and team-scoped keys that
   * is the org's governance project, not the project an admin happens to
   * be looking at. Reading a single tenant is how those keys came to show
   * nothing at all.
   *
   * Keys with no traffic are absent from the result; callers render $0.00
   * for them rather than a blank.
   */
  async spendByVirtualKey(args: {
    tenantIds: string[];
    virtualKeyIds: string[];
    window: GatewaySpendWindow;
  }): Promise<GatewayVirtualKeySpend[]> {
    const { tenantIds, virtualKeyIds, window } = args;
    if (tenantIds.length === 0 || virtualKeyIds.length === 0) return [];

    const params: Record<string, string | number> = {
      vkAttr: VK_ATTRIBUTE,
      fromMs: window.fromDate.getTime(),
      toMs: window.toDate.getTime(),
    };
    const tenantPlaceholders = tenantIds
      .map((id, i) => {
        params[`tenant${i}`] = id;
        return `{tenant${i}:String}`;
      })
      .join(",");
    const vkPlaceholders = virtualKeyIds
      .map((id, i) => {
        params[`vk${i}`] = id;
        return `{vk${i}:String}`;
      })
      .join(",");

    try {
      const client = await this.resolveClient(tenantIds[0]!);
      const result = await client.query({
        query: `
          SELECT
            VirtualKeyId,
            toString(sum(TraceCost)) AS SpentUSD,
            count() AS Requests
          FROM (
            SELECT
              TenantId,
              TraceId,
              argMax(Attributes[{vkAttr:String}], UpdatedAt) AS VirtualKeyId,
              argMax(coalesce(TotalCost, 0), UpdatedAt) AS TraceCost
            FROM ${TRACE_SUMMARIES_TABLE}
            WHERE TenantId IN (${tenantPlaceholders})
              AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
              AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
              AND Attributes[{vkAttr:String}] IN (${vkPlaceholders})
            GROUP BY TenantId, TraceId
          )
          GROUP BY VirtualKeyId
        `,
        query_params: params,
        format: "JSONEachRow",
      });
      type Row = {
        VirtualKeyId: string;
        SpentUSD: string;
        Requests: number | string;
      };
      const rows = (await result.json()) as Row[];
      return rows.map((r) => ({
        virtualKeyId: r.VirtualKeyId,
        // `SpentUSD` is a stringified `Float64` sum, so it arrives carrying
        // the drift of the addition: 45 micro-USD of spend reads
        // "0.000044999999999999996". Normalising at the read boundary is what
        // keeps the REST string and the UI's number the same figure, the same
        // way the spend-event rows derive theirs from nano here.
        spentUsd: usdDisplayString(r.SpentUSD),
        requests: Number(r.Requests) || 0,
      }));
    } catch (error) {
      logger.warn(
        { tenantIds, error },
        "failed to read per-virtual-key spend from trace summaries",
      );
      throw error;
    }
  }

  /**
   * The Usage tab's slices (per key, per model, per day, totals, blocked
   * count), aggregated inside ClickHouse over the deduped traces. One
   * grouped query keeps every slice consistent with the others while the
   * result stays bounded by keys x models x days, not by traffic: a busy
   * project's 90-day window is millions of traces but only a page of
   * buckets.
   */
  async usageBuckets(args: {
    tenantIds: string[];
    window: GatewaySpendWindow;
    virtualKeyIds?: string[];
  }): Promise<GatewayUsageBucket[]> {
    const { tenantIds, window, virtualKeyIds } = args;
    if (tenantIds.length === 0) return [];
    if (virtualKeyIds && virtualKeyIds.length === 0) return [];

    const params: Record<string, string | number> = {
      vkAttr: VK_ATTRIBUTE,
      fromMs: window.fromDate.getTime(),
      toMs: window.toDate.getTime(),
    };
    const tenantPlaceholders = tenantIds
      .map((id, i) => {
        params[`tenant${i}`] = id;
        return `{tenant${i}:String}`;
      })
      .join(",");
    const vkFilter = virtualKeyIds
      ? `AND Attributes[{vkAttr:String}] IN (${virtualKeyIds
          .map((id, i) => {
            params[`vk${i}`] = id;
            return `{vk${i}:String}`;
          })
          .join(",")})`
      : `AND Attributes[{vkAttr:String}] != ''`;

    try {
      const client = await this.resolveClient(tenantIds[0]!);
      const result = await client.query({
        query: `
          SELECT
            VirtualKeyId AS virtualKeyId,
            Model AS model,
            Day AS day,
            toString(sum(TraceCost)) AS totalUsd,
            count() AS requests,
            countIf(Blocked) AS blockedRequests
          FROM (
            SELECT
              TenantId,
              TraceId,
              argMax(Attributes[{vkAttr:String}], UpdatedAt) AS VirtualKeyId,
              argMax(coalesce(TotalCost, 0), UpdatedAt) AS TraceCost,
              if(
                length(argMax(Models, UpdatedAt)) = 0,
                'unknown',
                arrayElement(argMax(Models, UpdatedAt), 1)
              ) AS Model,
              formatDateTime(argMax(OccurredAt, UpdatedAt), '%Y-%m-%d', 'UTC') AS Day,
              argMax(BlockedByGuardrail, UpdatedAt) AS Blocked
            FROM ${TRACE_SUMMARIES_TABLE}
            WHERE TenantId IN (${tenantPlaceholders})
              AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
              AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
              ${vkFilter}
            GROUP BY TenantId, TraceId
          )
          GROUP BY VirtualKeyId, Model, Day
        `,
        query_params: params,
        format: "JSONEachRow",
      });
      type Row = {
        virtualKeyId: string;
        model: string;
        day: string;
        totalUsd: string;
        requests: number | string;
        blockedRequests: number | string;
      };
      const rows = (await result.json()) as Row[];
      return rows.map((r) => ({
        virtualKeyId: r.virtualKeyId,
        model: r.model,
        day: r.day,
        totalUsd: r.totalUsd,
        requests: Number(r.requests) || 0,
        blockedRequests: Number(r.blockedRequests) || 0,
      }));
    } catch (error) {
      logger.warn({ tenantIds, error }, "failed to aggregate gateway usage from trace summaries");
      throw error;
    }
  }

  /**
   * The most recent gateway traces in the window, one row per trace,
   * deduped, newest first. `limit` is required: this is the query for a
   * "recent debits" list, and an unbounded pull of raw traces into Node
   * is exactly what `usageBuckets` exists to avoid.
   */
  async gatewayTraces(args: {
    tenantIds: string[];
    window: GatewaySpendWindow;
    virtualKeyIds?: string[];
    /**
     * Narrow to one model, named the way `usageBuckets` names it: the first
     * of the trace's models, or "unknown" when it recorded none. Applied
     * after the dedup, on the winning version's array, because a filter on
     * the raw rows would answer from whichever version happened to match.
     */
    model?: string;
    limit: number;
  }): Promise<GatewayTraceRow[]> {
    const { tenantIds, window, virtualKeyIds, model, limit } = args;
    if (tenantIds.length === 0) return [];
    if (virtualKeyIds && virtualKeyIds.length === 0) return [];

    const params: Record<string, string | number> = {
      vkAttr: VK_ATTRIBUTE,
      fromMs: window.fromDate.getTime(),
      toMs: window.toDate.getTime(),
      limit: Math.max(1, Math.floor(limit)),
    };
    let modelFilter = "";
    if (model) {
      params.model = model;
      modelFilter = `WHERE if(length(TraceModels) = 0, 'unknown', arrayElement(TraceModels, 1)) = {model:String}`;
    }
    const tenantPlaceholders = tenantIds
      .map((id, i) => {
        params[`tenant${i}`] = id;
        return `{tenant${i}:String}`;
      })
      .join(",");
    const vkFilter = virtualKeyIds
      ? `AND Attributes[{vkAttr:String}] IN (${virtualKeyIds
          .map((id, i) => {
            params[`vk${i}`] = id;
            return `{vk${i}:String}`;
          })
          .join(",")})`
      : `AND Attributes[{vkAttr:String}] != ''`;

    try {
      const client = await this.resolveClient(tenantIds[0]!);
      const result = await client.query({
        query: `
          SELECT
            TraceId AS traceId,
            VirtualKeyId AS virtualKeyId,
            toString(TraceCost) AS costUsd,
            TraceModels AS models,
            toUnixTimestamp64Milli(LatestOccurredAt) AS occurredAtMs,
            PromptTokens AS promptTokens,
            CompletionTokens AS completionTokens,
            DurationMs AS durationMs,
            HasError AS hasError,
            Blocked AS blocked
          FROM (
            SELECT
              TenantId,
              TraceId,
              argMax(Attributes[{vkAttr:String}], UpdatedAt) AS VirtualKeyId,
              argMax(coalesce(TotalCost, 0), UpdatedAt) AS TraceCost,
              argMax(Models, UpdatedAt) AS TraceModels,
              argMax(OccurredAt, UpdatedAt) AS LatestOccurredAt,
              argMax(coalesce(TotalPromptTokenCount, 0), UpdatedAt) AS PromptTokens,
              argMax(coalesce(TotalCompletionTokenCount, 0), UpdatedAt) AS CompletionTokens,
              argMax(TotalDurationMs, UpdatedAt) AS DurationMs,
              argMax(ContainsErrorStatus, UpdatedAt) AS HasError,
              argMax(BlockedByGuardrail, UpdatedAt) AS Blocked
            FROM ${TRACE_SUMMARIES_TABLE}
            WHERE TenantId IN (${tenantPlaceholders})
              AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
              AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
              ${vkFilter}
            GROUP BY TenantId, TraceId
          )
          ${modelFilter}
          ORDER BY occurredAtMs DESC
          LIMIT {limit:UInt32}
        `,
        query_params: params,
        format: "JSONEachRow",
      });
      type Row = {
        traceId: string;
        virtualKeyId: string;
        costUsd: string;
        models: string[];
        occurredAtMs: string | number;
        promptTokens: string | number;
        completionTokens: string | number;
        durationMs: string | number;
        hasError: boolean | number;
        blocked: boolean | number;
      };
      const rows = (await result.json()) as Row[];
      return rows.map((r) => ({
        traceId: r.traceId,
        virtualKeyId: r.virtualKeyId,
        costUsd: r.costUsd,
        models: r.models ?? [],
        occurredAt: new Date(Number(r.occurredAtMs)),
        promptTokens: Number(r.promptTokens) || 0,
        completionTokens: Number(r.completionTokens) || 0,
        durationMs: Number(r.durationMs) || 0,
        hasError: Boolean(Number(r.hasError)),
        blockedByGuardrail: Boolean(Number(r.blocked)),
      }));
    } catch (error) {
      logger.warn({ tenantIds, error }, "failed to read gateway traces from trace summaries");
      throw error;
    }
  }
}
