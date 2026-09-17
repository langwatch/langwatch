import { Temporal } from "@langwatch/time";
/**
 * Per-virtual-key spend, read from the cost path, not the budget ledger:
 * that only holds rows for keys with a budget, so it $0.00s uncapped keys
 * and double-counts doubly-capped ones. RMT deduped via argMax(UpdatedAt).
 */
import { createLogger } from "@langwatch/observability";

import { type GatewayClickHouseResolver,
  type GatewaySpendWindow,
  type GatewayTraceRow,
  type GatewayUsageBucket,
  type GatewayVirtualKeySpendRow,
  type GatewayVirtualKeySpend } from "../../app/gateway.members.ts";
import { usdDisplayString } from "@langwatch/gateway-contract";

const TRACE_SUMMARIES_TABLE = "trace_summaries";
const VK_ATTRIBUTE = "langwatch.virtual_key_id";

const logger = createLogger("langwatch:gateway:virtual-key-spend-repository");

export class GatewayVirtualKeySpendRepository implements GatewayVirtualKeySpend {
  static create(resolveClient: GatewayClickHouseResolver): GatewayVirtualKeySpendRepository {
    return new GatewayVirtualKeySpendRepository(resolveClient);
  }

  constructor(private readonly resolveClient: GatewayClickHouseResolver) {
  }

  /**
   * Spend per key over a window, summed across given project tenants
   * (plural: org/team-scoped keys land in the org's governance project, not
   * whatever an admin is viewing). Keys with no traffic are absent; $0.00.
   */
  async spendByVirtualKey(args: {
    tenantIds: string[];
    virtualKeyIds: string[];
    window: GatewaySpendWindow;
  }): Promise<GatewayVirtualKeySpendRow[]> {
    const { tenantIds, virtualKeyIds, window } = args;
    if (tenantIds.length === 0 || virtualKeyIds.length === 0) return [];

    const params: Record<string, string | number> = {
      vkAttr: VK_ATTRIBUTE,
      fromMs: window.fromDate.epochMilliseconds,
      toMs: window.toDate.epochMilliseconds,
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
   * The Usage tab's slices (per key/model/day, totals, blocked count), one
   * grouped ClickHouse query over deduped traces, bounded by keys x models x
   * days, not traffic — a busy 90-day window is millions of traces, one page.
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
      fromMs: window.fromDate.epochMilliseconds,
      toMs: window.toDate.epochMilliseconds,
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
   * Most recent gateway traces in the window, one row per trace, deduped, newest first. `limit`
   * is required — this is the "recent debits" list, and an unbounded pull of raw traces is
   * exactly what usageBuckets exists to avoid.
   */
  async gatewayTraces(args: {
    tenantIds: string[];
    window: GatewaySpendWindow;
    virtualKeyIds?: string[];
    /**
     * Narrow to one model, named the way usageBuckets names it: the trace's first model, or
     * "unknown" if none. Applied after dedup, on the winning version's array — a filter on raw
     * rows would answer from whichever version happened to match.
     */
    model?: string;
    limit: number;
  }): Promise<GatewayTraceRow[]> {
    const { tenantIds, window, virtualKeyIds, model, limit } = args;
    if (tenantIds.length === 0) return [];
    if (virtualKeyIds && virtualKeyIds.length === 0) return [];

    const params: Record<string, string | number> = {
      vkAttr: VK_ATTRIBUTE,
      fromMs: window.fromDate.epochMilliseconds,
      toMs: window.toDate.epochMilliseconds,
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
        occurredAt: Temporal.Instant.fromEpochMilliseconds(Number(r.occurredAtMs)),
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
