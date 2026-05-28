// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * GovernanceOcsfExportService — read-side cursor-paginated SIEM
 * forwarding pull. Returns OCSF v1.1 / OWASP AOS rows from
 * `governance_ocsf_events` keyed on (TenantId, EventId), ordered by
 * EventTime ascending so security teams can paginate forward via
 * cursor.
 *
 * Designed for cron-based pulls from Splunk HEC / Datadog Cloud SIEM /
 * Microsoft Sentinel / AWS Security Hub / Elastic Security / Sumo
 * Logic CSE / Google Chronicle. Each consumer keeps a local watermark
 * (last-seen EventTime) and re-issues with sinceMs = watermark.
 *
 * TenantId resolution: queries the org's hidden internal_governance
 * Project ID (the same TenantId every governance write path uses).
 * When the org has no Gov Project yet (no IngestionSource ever
 * minted), returns an empty page — callers don't need to special-case.
 *
 * Spec: specs/ai-gateway/governance/siem-export.feature
 *
 * Pairs with:
 *   - specs/ai-gateway/governance/folds.feature §"governance_ocsf_events"
 *   - GovernanceOcsfEventsSyncReactor (the producer)
 *   - migration 00023_create_governance_ocsf_events.sql
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";

import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";
import { PROJECT_KIND } from "./governanceProject.service";

export interface GovernanceOcsfExportRow {
  eventId: string;
  /**
   * Forward-compat marker stamped by
   * `governanceOcsfEvents.clickhouse.repository.ts:OCSF_SCHEMA_VERSION`
   * at write time. Pre-this-column rows materialize as "1.1.0" via
   * the CH DEFAULT (migration 00028). SIEM consumers can filter or
   * version-gate downstream parsing on this value.
   */
  ocsfSchemaVersion: string;
  traceId: string;
  sourceId: string;
  sourceType: string;
  classUid: number;
  categoryUid: number;
  activityId: number;
  typeUid: number;
  severityId: number;
  eventTimeMs: number;
  actorUserId: string;
  actorEmail: string;
  actorEnduserId: string;
  actionName: string;
  targetName: string;
  anomalyAlertId: string;
  rawOcsfJson: string;
}

export interface GovernanceOcsfExportPage {
  events: GovernanceOcsfExportRow[];
  /** Pass back as `sinceMs` on the next request. null when the page is empty. */
  nextCursor: number | null;
}

interface CHRow {
  EventId: string;
  OcsfSchemaVersion: string;
  TraceId: string;
  SourceId: string;
  SourceType: string;
  ClassUid: number | string;
  CategoryUid: number | string;
  ActivityId: number | string;
  TypeUid: number | string;
  SeverityId: number | string;
  EventTimeMs: string;
  ActorUserId: string;
  ActorEmail: string;
  ActorEnduserId: string;
  ActionName: string;
  TargetName: string;
  AnomalyAlertId: string;
  RawOcsfJson: string;
}

export class GovernanceOcsfExportService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): GovernanceOcsfExportService {
    return new GovernanceOcsfExportService(prisma);
  }

  async list(input: {
    organizationId: string;
    sinceMs: number;
    limit: number;
  }): Promise<GovernanceOcsfExportPage> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) {
      return { events: [], nextCursor: null };
    }

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) {
      return { events: [], nextCursor: null };
    }

    const result = await ch.query({
      query: `
        SELECT
          EventId,
          OcsfSchemaVersion,
          TraceId,
          SourceId,
          SourceType,
          ClassUid,
          CategoryUid,
          ActivityId,
          TypeUid,
          SeverityId,
          toString(toUnixTimestamp64Milli(EventTime)) AS EventTimeMs,
          ActorUserId,
          ActorEmail,
          ActorEnduserId,
          ActionName,
          TargetName,
          AnomalyAlertId,
          RawOcsfJson
        FROM governance_ocsf_events
        WHERE TenantId = {tenantId:String}
          AND EventTime > fromUnixTimestamp64Milli({sinceMs:UInt64})
          AND (TenantId, EventId, LastUpdatedAt) IN (
            SELECT TenantId, EventId, max(LastUpdatedAt)
            FROM governance_ocsf_events
            WHERE TenantId = {tenantId:String}
              AND EventTime > fromUnixTimestamp64Milli({sinceMs:UInt64})
            GROUP BY TenantId, EventId
          )
        ORDER BY EventTime ASC, EventId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: govProjectId,
        sinceMs: input.sinceMs,
        limit: input.limit,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as CHRow[];
    const events: GovernanceOcsfExportRow[] = rows.map((r) => ({
      eventId: r.EventId,
      ocsfSchemaVersion: r.OcsfSchemaVersion,
      traceId: r.TraceId,
      sourceId: r.SourceId,
      sourceType: r.SourceType,
      classUid: Number(r.ClassUid),
      categoryUid: Number(r.CategoryUid),
      activityId: Number(r.ActivityId),
      typeUid: Number(r.TypeUid),
      severityId: Number(r.SeverityId),
      eventTimeMs: Number(r.EventTimeMs),
      actorUserId: r.ActorUserId,
      actorEmail: r.ActorEmail,
      actorEnduserId: r.ActorEnduserId,
      actionName: r.ActionName,
      targetName: r.TargetName,
      anomalyAlertId: r.AnomalyAlertId,
      rawOcsfJson: r.RawOcsfJson,
    }));

    const lastEvent = events[events.length - 1];
    return {
      events,
      nextCursor: lastEvent ? lastEvent.eventTimeMs : null,
    };
  }

  private async resolveGovProjectId(
    organizationId: string,
  ): Promise<string | null> {
    const project = await this.prisma.project.findFirst({
      where: {
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        team: { organizationId },
        archivedAt: null,
      },
      select: { id: true },
    });
    return project?.id ?? null;
  }

  private async getClickhouse(
    organizationId: string,
  ): Promise<ClickHouseClient | null> {
    return await getClickHouseClientForOrganization(organizationId);
  }
}
