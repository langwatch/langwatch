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
import type { PrismaClient } from "~/generated/prisma/client";

import type {
  GovernanceOcsfEventsClickHouseRepository,
  GovernanceOcsfExportRow,
} from "./governanceOcsfEvents.clickhouse.repository";
import { PROJECT_KIND } from "./governanceProject.service";

export interface GovernanceOcsfExportPage {
  events: GovernanceOcsfExportRow[];
  /**
   * Pass back as `sinceMs` on the next request. null when the page is empty.
   * Kept for callers that only track the millisecond watermark.
   */
  nextCursor: number | null;
  /**
   * Compound watermark of the last row: pass `eventTimeMs` back as `sinceMs`
   * and `eventId` back as `sinceEventId`. This is the cursor SIEM consumers
   * should persist: it disambiguates rows that share a millisecond, so a page
   * boundary inside a same-ms batch neither skips nor (with a stale ms-only
   * cursor) re-delivers the rest of that millisecond.
   */
  nextCursorCompound: { eventTimeMs: number; eventId: string } | null;
}

export class GovernanceOcsfExportService {
  private readonly prisma: PrismaClient;
  /**
   * The OCSF SIEM-export sink, from the App. `undefined` on a deployment
   * without ClickHouse, in which case {@link list} throws the same class
   * of error the direct client lookup always did — the export has no
   * fallback store to read from.
   */
  private readonly ocsfRepository:
    | GovernanceOcsfEventsClickHouseRepository
    | undefined;

  constructor({
    prisma,
    ocsfRepository,
  }: {
    prisma: PrismaClient;
    ocsfRepository: GovernanceOcsfEventsClickHouseRepository | undefined;
  }) {
    this.prisma = prisma;
    this.ocsfRepository = ocsfRepository;
  }

  static create(deps: {
    prisma: PrismaClient;
    ocsfRepository: GovernanceOcsfEventsClickHouseRepository | undefined;
  }): GovernanceOcsfExportService {
    return new GovernanceOcsfExportService(deps);
  }

  async list(input: {
    organizationId: string;
    sinceMs: number;
    /**
     * EventId watermark paired with sinceMs. Defaults to "" so a fresh pull
     * (or a legacy ms-only caller) still works; supplying it makes the cursor
     * exact across rows that share a millisecond.
     */
    sinceEventId?: string;
    limit: number;
  }): Promise<GovernanceOcsfExportPage> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) {
      return { events: [], nextCursor: null, nextCursorCompound: null };
    }

    if (!this.ocsfRepository) {
      throw new Error(
        "ClickHouse client is not available — check ClickHouse connection configuration",
      );
    }

    const events = await this.ocsfRepository.findAll({
      tenantId: govProjectId,
      sinceMs: input.sinceMs,
      sinceEventId: input.sinceEventId ?? "",
      limit: input.limit,
    });

    const lastEvent = events[events.length - 1];
    return {
      events,
      nextCursor: lastEvent ? lastEvent.eventTimeMs : null,
      nextCursorCompound: lastEvent
        ? { eventTimeMs: lastEvent.eventTimeMs, eventId: lastEvent.eventId }
        : null,
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
}
