/**
 * ActivityEventRepository — writes normalised OCSF + AOS events to
 * gateway_activity_events (ClickHouse migration 00019). Reads are
 * intentionally NOT in this slice — admin-oversight tRPC procedures
 * land in slice B (Option B per master_orchestrator's sequence).
 *
 * Tenancy: TenantId = IngestionSource.id. Receivers MUST resolve the
 * source row first (already done by the auth path) and pass its id +
 * organizationId here.
 */
import {
  getClickHouseClientForOrganization,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:activity-monitor:repo");

export interface ActivityEventRow {
  /** TenantId — IngestionSource.id (NOT projectId). */
  tenantId: string;
  /** Denormalised org id for cross-source admin queries. */
  organizationId: string;
  /** SourceType from IngestionSource.sourceType (one of the 7). */
  sourceType: string;
  /** SourceId — same as tenantId for ingest sources; included for
   *  consistency with trace_summaries.SourceId on the gateway side. */
  sourceId: string;
  /** Event identity — generate via crypto.randomUUID() if upstream
   *  doesn't provide one. Idempotent under ReplacingMergeTree. */
  eventId: string;
  /** OCSF event-type tag — see schema doc-comment. */
  eventType: string;
  /** Actor — user email / principal id / agent session id. */
  actor?: string;
  /** Action verb in this domain. */
  action?: string;
  /** Target — model / tool / resource. */
  target?: string;
  /** Optional cost in USD. */
  costUsd?: string;
  tokensInput?: number;
  tokensOutput?: number;
  /** Forensic copy of the upstream payload (truncated to 64KB). */
  rawPayload?: string;
  /** Wall-clock event time per the upstream platform. */
  eventTimestamp: Date;
}

export class ActivityEventRepository {
  /**
   * Insert one or more normalised events. No-op when ClickHouse is
   * disabled (smaller self-hosters) — receivers still ack 202 so the
   * upstream platform doesn't retry forever; reads return zeroes.
   */
  async insert(rows: ActivityEventRow[]): Promise<void> {
    if (rows.length === 0) return;
    if (!isClickHouseEnabled()) {
      logger.debug(
        { count: rows.length },
        "activity event insert skipped — clickhouse not enabled",
      );
      return;
    }
    const tenantId = rows[0]!.tenantId;
    const organizationId = rows[0]!.organizationId;
    if (rows.some((r) => r.tenantId !== tenantId)) {
      throw new Error(
        "ActivityEventRepository.insert: rows span multiple TenantIds (one source per call)",
      );
    }
    const client = await getClickHouseClientForOrganization(organizationId);
    if (!client) {
      logger.warn(
        { organizationId },
        "activity event insert dropped — no clickhouse client for org",
      );
      return;
    }
    await client.insert({
      table: "gateway_activity_events",
      format: "JSONEachRow",
      values: rows.map((r) => ({
        TenantId: r.tenantId,
        OrganizationId: r.organizationId,
        SourceType: r.sourceType,
        SourceId: r.sourceId,
        EventId: r.eventId,
        EventType: r.eventType,
        Actor: r.actor ?? "",
        Action: r.action ?? "",
        Target: r.target ?? "",
        CostUSD: r.costUsd ?? "0",
        TokensInput: r.tokensInput ?? 0,
        TokensOutput: r.tokensOutput ?? 0,
        RawPayload: truncatePayload(r.rawPayload ?? ""),
        EventTimestamp: toClickhouseTime(r.eventTimestamp),
      })),
    });
  }
}

const MAX_PAYLOAD_BYTES = 64 * 1024;
function truncatePayload(payload: string): string {
  if (payload.length <= MAX_PAYLOAD_BYTES) return payload;
  return payload.slice(0, MAX_PAYLOAD_BYTES);
}

/**
 * ClickHouse DateTime64(3) wants `YYYY-MM-DD HH:MM:SS.mmm` format
 * when inserted via JSONEachRow.
 */
function toClickhouseTime(d: Date): string {
  const iso = d.toISOString();
  // 2026-04-27T06:15:03.361Z → 2026-04-27 06:15:03.361
  return iso.replace("T", " ").replace("Z", "");
}
