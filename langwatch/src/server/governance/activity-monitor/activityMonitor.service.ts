/**
 * ActivityMonitorService — read-side queries that power the
 * /governance admin dashboard. Replaces Alexis's MOCK_* fixtures with
 * real data from gateway_activity_events (CH) + IngestionSource (PG).
 *
 * Org-scoped via OrganizationId column on gateway_activity_events
 * (denormalised at insert time, see migration 00019). All queries
 * include OrganizationId in the WHERE clause for tenant isolation.
 *
 * Auth is enforced at the tRPC layer
 * (`checkOrganizationPermission("organization:view")` for read paths,
 * `organization:manage` would be over-restrictive for a read).
 *
 * Spec: specs/ai-gateway/governance/activity-monitor.feature
 */
import type { PrismaClient } from "@prisma/client";

import {
  getClickHouseClientForOrganization,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";

export interface SummaryResult {
  spentThisWindowUsd: number;
  windowOverPreviousPct: number;
  activeUsersThisWindow: number;
  newUsersThisWindow: number;
  openAnomalyCount: number;
  anomalyBreakdown: { critical: number; warning: number; info: number };
}

export interface SpendByUserRow {
  actor: string;
  spendUsd: number;
  requests: number;
  lastActivityIso: string;
  trendVsPreviousPct: number;
  mostUsedTarget: string | null;
}

export interface IngestionSourceHealthRow {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  lastEventIso: string | null;
  eventsLast24h: number;
}

export interface ActivityEventDetailRow {
  eventId: string;
  eventType: string;
  actor: string;
  action: string;
  target: string;
  costUsd: number;
  tokensInput: number;
  tokensOutput: number;
  eventTimestampIso: string;
  ingestedAtIso: string;
  rawPayload: string;
}

export interface SourceHealthMetrics {
  events24h: number;
  events7d: number;
  events30d: number;
  lastSuccessIso: string | null;
}

const EMPTY_SUMMARY: SummaryResult = {
  spentThisWindowUsd: 0,
  windowOverPreviousPct: 0,
  activeUsersThisWindow: 0,
  newUsersThisWindow: 0,
  openAnomalyCount: 0,
  anomalyBreakdown: { critical: 0, warning: 0, info: 0 },
};

export class ActivityMonitorService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ActivityMonitorService {
    return new ActivityMonitorService(prisma);
  }

  /**
   * Summary cards: total spend, active users, anomaly count + window
   * delta. Returns empty zeros when ClickHouse is disabled — the
   * dashboard already empty-state-handles zeros.
   */
  async summary(input: {
    organizationId: string;
    windowDays: number;
  }): Promise<SummaryResult> {
    if (!isClickHouseEnabled()) return EMPTY_SUMMARY;
    const client = await getClickHouseClientForOrganization(
      input.organizationId,
    );
    if (!client) return EMPTY_SUMMARY;

    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const result = await client.query({
      query: `
        SELECT
          coalesce(sum(if(EventTimestamp >= toDateTime64({windowStart:String}, 3), CostUSD, 0)), 0) AS spent_this,
          coalesce(sum(if(EventTimestamp <  toDateTime64({windowStart:String}, 3), CostUSD, 0)), 0) AS spent_prev,
          uniqExact(if(EventTimestamp >= toDateTime64({windowStart:String}, 3) AND Actor != '', Actor, NULL)) AS active_users
        FROM gateway_activity_events
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= toDateTime64({prevStart:String}, 3)
      `,
      query_params: {
        organizationId: input.organizationId,
        windowStart: msToClickhouseTime(now - windowMs),
        prevStart: msToClickhouseTime(now - 2 * windowMs),
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      spent_this: string | number;
      spent_prev: string | number;
      active_users: string | number;
    }>;
    const row = rows[0] ?? { spent_this: 0, spent_prev: 0, active_users: 0 };
    const spentThis = Number(row.spent_this) || 0;
    const spentPrev = Number(row.spent_prev) || 0;
    const delta =
      spentPrev > 0 ? Math.round(((spentThis - spentPrev) / spentPrev) * 100) : 0;
    return {
      spentThisWindowUsd: roundCurrency(spentThis),
      windowOverPreviousPct: delta,
      activeUsersThisWindow: Number(row.active_users) || 0,
      newUsersThisWindow: 0, // Tracked once we persist user-first-seen
      openAnomalyCount: 0, // Option C
      anomalyBreakdown: { critical: 0, warning: 0, info: 0 },
    };
  }

  /**
   * Per-user spend breakdown. GROUP BY Actor (user email or principal id).
   */
  async spendByUser(input: {
    organizationId: string;
    windowDays: number;
    limit?: number;
  }): Promise<SpendByUserRow[]> {
    if (!isClickHouseEnabled()) return [];
    const client = await getClickHouseClientForOrganization(
      input.organizationId,
    );
    if (!client) return [];

    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const result = await client.query({
      query: `
        WITH
          this_window AS (
            SELECT
              Actor,
              sum(CostUSD) AS spend,
              count() AS requests,
              max(EventTimestamp) AS last_activity,
              argMax(Target, EventTimestamp) AS last_target
            FROM gateway_activity_events
            WHERE OrganizationId = {organizationId:String}
              AND EventTimestamp >= toDateTime64({windowStart:String}, 3)
              AND Actor != ''
            GROUP BY Actor
          ),
          prev_window AS (
            SELECT
              Actor,
              sum(CostUSD) AS prev_spend
            FROM gateway_activity_events
            WHERE OrganizationId = {organizationId:String}
              AND EventTimestamp >= toDateTime64({prevStart:String}, 3)
              AND EventTimestamp <  toDateTime64({windowStart:String}, 3)
              AND Actor != ''
            GROUP BY Actor
          )
        SELECT
          tw.Actor AS actor,
          tw.spend AS spend,
          tw.requests AS requests,
          tw.last_activity AS last_activity,
          tw.last_target AS last_target,
          coalesce(pw.prev_spend, 0) AS prev_spend
        FROM this_window AS tw
        LEFT JOIN prev_window AS pw ON tw.Actor = pw.Actor
        ORDER BY tw.spend DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        organizationId: input.organizationId,
        windowStart: msToClickhouseTime(now - windowMs),
        prevStart: msToClickhouseTime(now - 2 * windowMs),
        limit: input.limit ?? 50,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      actor: string;
      spend: string | number;
      requests: string | number;
      last_activity: string;
      last_target: string;
      prev_spend: string | number;
    }>;
    return rows.map((r) => {
      const spend = Number(r.spend) || 0;
      const prev = Number(r.prev_spend) || 0;
      const trend = prev > 0 ? Math.round(((spend - prev) / prev) * 100) : 0;
      return {
        actor: r.actor,
        spendUsd: roundCurrency(spend),
        requests: Number(r.requests) || 0,
        lastActivityIso: clickhouseTimeToIso(r.last_activity),
        trendVsPreviousPct: trend,
        mostUsedTarget: r.last_target || null,
      };
    });
  }

  /**
   * Per-source health: status + last-event + 24h event count. Joins
   * Prisma IngestionSource (org-scoped, source of truth for status +
   * lastEventAt) with a CH count for the rolling 24h volume.
   */
  async ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]> {
    const sources = await this.prisma.ingestionSource.findMany({
      where: { organizationId: input.organizationId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    if (sources.length === 0) return [];

    let countsBySourceId: Record<string, number> = {};
    if (isClickHouseEnabled()) {
      const client = await getClickHouseClientForOrganization(
        input.organizationId,
      );
      if (client) {
        const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
        const result = await client.query({
          query: `
            SELECT TenantId AS tenant_id, count() AS event_count
            FROM gateway_activity_events
            WHERE OrganizationId = {organizationId:String}
              AND EventTimestamp >= toDateTime64({since:String}, 3)
              AND TenantId IN ({tenantIds:Array(String)})
            GROUP BY TenantId
          `,
          query_params: {
            organizationId: input.organizationId,
            since: msToClickhouseTime(sinceMs),
            tenantIds: sources.map((s) => s.id),
          },
          format: "JSONEachRow",
        });
        const rows = (await result.json()) as Array<{
          tenant_id: string;
          event_count: string | number;
        }>;
        countsBySourceId = Object.fromEntries(
          rows.map((r) => [r.tenant_id, Number(r.event_count) || 0]),
        );
      }
    }

    return sources.map((src) => ({
      id: src.id,
      name: src.name,
      sourceType: src.sourceType,
      status: src.status,
      lastEventIso: src.lastEventAt?.toISOString() ?? null,
      eventsLast24h: countsBySourceId[src.id] ?? 0,
    }));
  }

  /**
   * Recent events for a single IngestionSource — powers the per-source
   * detail page's "raw vs normalised" preview. Cursor-paginated by
   * eventTimestamp (DESC). Caller authorises that the source belongs
   * to the org BEFORE calling this — service returns empty when the
   * source-id doesn't match the org (defensive).
   */
  async eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    /** ISO timestamp — return events strictly older than this. */
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]> {
    if (!isClickHouseEnabled()) return [];
    const client = await getClickHouseClientForOrganization(
      input.organizationId,
    );
    if (!client) return [];

    const limit = input.limit ?? 50;
    const beforeFilter = input.beforeIso
      ? "AND EventTimestamp < toDateTime64({beforeIso:String}, 3)"
      : "";
    const result = await client.query({
      query: `
        SELECT
          EventId AS event_id,
          EventType AS event_type,
          Actor AS actor,
          Action AS action,
          Target AS target,
          CostUSD AS cost_usd,
          TokensInput AS tokens_input,
          TokensOutput AS tokens_output,
          EventTimestamp AS event_timestamp,
          IngestedAt AS ingested_at,
          RawPayload AS raw_payload
        FROM gateway_activity_events
        WHERE OrganizationId = {organizationId:String}
          AND TenantId = {sourceId:String}
          ${beforeFilter}
        ORDER BY EventTimestamp DESC, EventId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        limit,
        ...(input.beforeIso
          ? { beforeIso: isoToClickhouseTime(input.beforeIso) }
          : {}),
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      event_id: string;
      event_type: string;
      actor: string;
      action: string;
      target: string;
      cost_usd: string | number;
      tokens_input: string | number;
      tokens_output: string | number;
      event_timestamp: string;
      ingested_at: string;
      raw_payload: string;
    }>;
    return rows.map((r) => ({
      eventId: r.event_id,
      eventType: r.event_type,
      actor: r.actor,
      action: r.action,
      target: r.target,
      costUsd: roundCurrency(Number(r.cost_usd) || 0),
      tokensInput: Number(r.tokens_input) || 0,
      tokensOutput: Number(r.tokens_output) || 0,
      eventTimestampIso: clickhouseTimeToIso(r.event_timestamp),
      ingestedAtIso: clickhouseTimeToIso(r.ingested_at),
      rawPayload: r.raw_payload,
    }));
  }

  /**
   * Volume metrics for a single IngestionSource over rolling windows.
   * Powers the per-source detail page's "events ingested" health
   * section. Single CH query with conditional aggregation.
   */
  async sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics> {
    const empty: SourceHealthMetrics = {
      events24h: 0,
      events7d: 0,
      events30d: 0,
      lastSuccessIso: null,
    };
    if (!isClickHouseEnabled()) return empty;
    const client = await getClickHouseClientForOrganization(
      input.organizationId,
    );
    if (!client) return empty;

    const now = Date.now();
    const result = await client.query({
      query: `
        SELECT
          countIf(EventTimestamp >= toDateTime64({since24h:String}, 3)) AS events_24h,
          countIf(EventTimestamp >= toDateTime64({since7d:String}, 3)) AS events_7d,
          count() AS events_30d,
          max(EventTimestamp) AS last_success
        FROM gateway_activity_events
        WHERE OrganizationId = {organizationId:String}
          AND TenantId = {sourceId:String}
          AND EventTimestamp >= toDateTime64({since30d:String}, 3)
      `,
      query_params: {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        since24h: msToClickhouseTime(now - 24 * 60 * 60 * 1000),
        since7d: msToClickhouseTime(now - 7 * 24 * 60 * 60 * 1000),
        since30d: msToClickhouseTime(now - 30 * 24 * 60 * 60 * 1000),
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      events_24h: string | number;
      events_7d: string | number;
      events_30d: string | number;
      last_success: string;
    }>;
    const row = rows[0];
    if (!row) return empty;
    const lastRaw = row.last_success;
    return {
      events24h: Number(row.events_24h) || 0,
      events7d: Number(row.events_7d) || 0,
      events30d: Number(row.events_30d) || 0,
      lastSuccessIso:
        lastRaw && !lastRaw.startsWith("1970")
          ? clickhouseTimeToIso(lastRaw)
          : null,
    };
  }
}

function isoToClickhouseTime(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}

function msToClickhouseTime(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.replace("T", " ").replace("Z", "");
}

function clickhouseTimeToIso(s: string | undefined): string {
  if (!s) return new Date().toISOString();
  // CH returns "2026-04-27 06:15:03.361" — convert back to ISO.
  return new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z")).toISOString();
}
