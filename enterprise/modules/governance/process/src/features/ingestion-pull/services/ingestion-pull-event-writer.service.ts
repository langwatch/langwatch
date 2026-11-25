import type {
  GovernanceIngestionSource,
  NormalizedPullEvent,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";

import type {
  GovernanceOcsfEventInput,
  GovernanceOcsfEventSink,
} from "../../../repositories/governance.repositories.ts";
import type { IngestionSourceRepository } from "../../../repositories/ingestion-source.repository.ts";
import { azureBillSourceId } from "../../microsoft/rules/azure-bill-identity.rules.ts";
import { mapToOcsfRow } from "../rules/ocsf-pull-event-mapping.rules.ts";
import { earliestOf, latestOf } from "../rules/page-extremes.rules.ts";
import type { IngestionPullDiagnosticsSink } from "./ingestion-pull-log.service.ts";
import type {
  GovernanceProjectDirectory,
  PulledUsageDispatcher,
  PulledUsageEntitlements,
} from "./ingestion-pull-worker.service.ts";
import type { PulledUsageRecordService } from "./pulled-usage-record.service.ts";

/**
 * One row per event id, the copy the provider sent last. A page's rows share one
 * INSERT and so one `LastUpdatedAt`; two copies would tie, and the read-time
 * dedup would keep both instead of the later one.
 */
function lastCopyOfEachEvent(rows: GovernanceOcsfEventInput[]): GovernanceOcsfEventInput[] {
  return [...new Map(rows.map((row) => [row.eventId, row])).values()];
}

export type UnpricedWindowStore = Pick<
  IngestionSourceRepository,
  "getUnpricedUsageWindow" | "updateUnpricedUsageWindow"
>;

type IngestionPullEventWriterMembers = Readonly<{
  projects: Pick<GovernanceProjectDirectory, "ensureInternal">;
  sink: GovernanceOcsfEventSink;
  usageEntitlement: PulledUsageEntitlements;
  usageRecords: PulledUsageRecordService;
  unpricedWindows: UnpricedWindowStore;
  diagnostics: IngestionPullDiagnosticsSink;
  now: () => number;
}>;

/** One run's kept events written: the OCSF audit row, the priced usage, the unpriced window. */
export class IngestionPullEventWriterService {
  private readonly projects: Pick<GovernanceProjectDirectory, "ensureInternal">;
  private readonly sink: GovernanceOcsfEventSink;
  private readonly usageEntitlement: PulledUsageEntitlements;
  private readonly usageRecords: PulledUsageRecordService;
  private readonly unpricedWindows: UnpricedWindowStore;
  private readonly diagnostics: IngestionPullDiagnosticsSink;
  private readonly now: () => number;

  private constructor(members: IngestionPullEventWriterMembers) {
    this.projects = members.projects;
    this.sink = members.sink;
    this.usageEntitlement = members.usageEntitlement;
    this.usageRecords = members.usageRecords;
    this.unpricedWindows = members.unpricedWindows;
    this.diagnostics = members.diagnostics;
    this.now = members.now;
  }

  static create(members: IngestionPullEventWriterMembers): IngestionPullEventWriterService {
    return new IngestionPullEventWriterService(members);
  }

  async writeEvents(input: {
    events: NormalizedPullEvent[];
    source: GovernanceIngestionSource;
    pulledUsage?: PulledUsageDispatcher;
  }): Promise<{ droppedPeriodsMs: number[]; recordedPeriodsMs: number[] }> {
    const droppedPeriodsMs: number[] = [];
    const recordedPeriodsMs: number[] = [];
    const project = await this.projects.ensureInternal({
      organizationId: input.source.organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    const recordCost = await this.usageEntitlement.isEnabled(input.source.organizationId);
    const observedAt = Temporal.Instant.fromEpochMilliseconds(this.now());
    await this.writeAuditRows({ events: input.events, source: input.source, tenantId: project.id });
    for (const event of input.events) {
      if (!input.pulledUsage) {
        continue;
      }

      let record: ReturnType<PulledUsageRecordService["findBuilt"]>;
      try {
        record = this.usageRecords.findBuilt({
          event,
          source: {
            // Only the subscription bill shares history with a retired source;
            // conversation usage and audit records keep the current source id.
            ingestionSourceId:
              input.source.sourceType === "copilot_studio_dataverse" &&
              event.source_event_id.startsWith("azure_cost:")
                ? azureBillSourceId(input.source)
                : input.source.id,
            sourceType: input.source.sourceType,
            organizationId: input.source.organizationId,
            teamId: input.source.teamId,
            createdAt: input.source.createdAt,
          },
          governanceProjectId: project.id,
          observedAt,
        });
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.diagnostics.error(
          "could not map a pulled item to a usage record; the audit row landed but this item has no price",
          {
            ingestionSourceId: input.source.id,
            sourceEventId: event.source_event_id,
            error: normalized.message,
          },
        );
        this.diagnostics.capture(normalized, {
          worker: "ingestionPuller",
          ingestionSourceId: input.source.id,
        });
        continue;
      }

      if (!record) {
        continue;
      }
      // The price existed either way; only storing it is gated (main `pullerWorker.ts:1082-1085`).
      if (!recordCost) {
        droppedPeriodsMs.push(record.occurredAtMs);
        continue;
      }

      await input.pulledUsage.recordPulledUsage({
        ...record,
        tenantId: project.id,
        occurredAt: record.occurredAtMs,
      });
      recordedPeriodsMs.push(record.occurredAtMs);
    }
    return { droppedPeriodsMs, recordedPeriodsMs };
  }

  /** The page's OCSF audit rows, in one `insertEvents` call (the sink chunks it). */
  private async writeAuditRows({
    events,
    source,
    tenantId,
  }: {
    events: NormalizedPullEvent[];
    source: GovernanceIngestionSource;
    tenantId: string;
  }): Promise<void> {
    const rows = events.map((event) =>
      mapToOcsfRow({
        event,
        tenantId,
        ingestionSourceId: source.id,
        sourceType: source.sourceType,
      }),
    );
    await this.sink.insertEvents(lastCopyOfEachEvent(rows));
  }

  /**
   * ADR-088: a dropped price widens the source's unpriced window; a complete re-read
   * reaching back across its start clears it. A truncated one never does.
   */
  async recordUnpricedUsageWindow({
    source,
    droppedPeriodsMs,
    recordedPeriodsMs,
    completeness,
  }: {
    source: GovernanceIngestionSource;
    droppedPeriodsMs: number[];
    recordedPeriodsMs: number[];
    completeness: "complete" | "truncated";
  }): Promise<void> {
    if (droppedPeriodsMs.length === 0 && recordedPeriodsMs.length === 0) return;
    const window = await this.unpricedWindows.getUnpricedUsageWindow(source.id);
    if (droppedPeriodsMs.length > 0) {
      const since = earliestOf(droppedPeriodsMs);
      const through = latestOf(droppedPeriodsMs);
      const widened = {
        since: Temporal.Instant.fromEpochMilliseconds(
          window.since ? Math.min(window.since.epochMilliseconds, since) : since,
        ),
        through: Temporal.Instant.fromEpochMilliseconds(
          window.through ? Math.max(window.through.epochMilliseconds, through) : through,
        ),
      };
      this.diagnostics.warn(
        "pulled cost recording is off for this organization — audit rows landed but this run's spend was not priced",
        {
          ingestionSourceId: source.id,
          organizationId: source.organizationId,
          droppedCount: droppedPeriodsMs.length,
          unpricedSince: widened.since.toString(),
          unpricedThrough: widened.through.toString(),
        },
      );
      await this.unpricedWindows.updateUnpricedUsageWindow(source.id, widened);
      return;
    }

    const gapStart = window.since;
    if (!gapStart || recordedPeriodsMs.length === 0) return;
    if (earliestOf(recordedPeriodsMs) > gapStart.epochMilliseconds) return;
    if (completeness === "truncated") {
      this.diagnostics.info(
        "a re-read reached back across the unpriced window but stopped short of its end; the window is kept",
        { ingestionSourceId: source.id },
      );
      return;
    }

    this.diagnostics.info(
      "a re-read reached back across the unpriced window; its spend is priced again",
      { ingestionSourceId: source.id },
    );
    await this.unpricedWindows.updateUnpricedUsageWindow(source.id, { since: null, through: null });
  }
}
