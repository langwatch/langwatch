import type {
  GovernanceIngestionSource,
  NormalizedPullEvent,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND } from "@langwatch/project-contract";
import { Temporal, toEpochMs } from "@langwatch/time";

import type {
  GovernanceOcsfEventInput,
  GovernanceOcsfEventSink,
} from "../repositories/governance.repositories.ts";
import type { IngestionSourceRepository } from "../repositories/ingestion-source.repository.ts";
import { azureBillSourceId } from "../rules/azure-bill-identity.rules.ts";
import type { IngestionPullDiagnosticsSink } from "./ingestion-pull-log.service.ts";
import type {
  GovernanceProjectDirectory,
  PulledUsageDispatcher,
  PulledUsageEntitlements,
} from "./ingestion-pull-worker.service.ts";
import type { PulledUsageRecordService } from "./pulled-usage-record.service.ts";

const OCSF_CLASS_API_ACTIVITY = 6003;
const OCSF_CATEGORY_APPLICATION_ACTIVITY = 6;
const OCSF_ACTIVITY_INVOKE = 6;
const OCSF_SEVERITY_INFO = 1;

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
    for (const event of input.events) {
      await this.sink.insertEvent(
        this.toOcsfRow({
          event,
          tenantId: project.id,
          ingestionSourceId: input.source.id,
          sourceType: input.source.sourceType,
        }),
      );
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
      const since = Math.min(...droppedPeriodsMs);
      const through = Math.max(...droppedPeriodsMs);
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
    if (Math.min(...recordedPeriodsMs) > gapStart.epochMilliseconds) return;
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

  private toOcsfRow(input: {
    event: NormalizedPullEvent;
    tenantId: string;
    ingestionSourceId: string;
    sourceType: string;
  }): GovernanceOcsfEventInput {
    const parsedMs = toEpochMs(input.event.event_timestamp);
    const eventTime = Temporal.Instant.fromEpochMilliseconds(
      Number.isFinite(parsedMs) ? parsedMs : this.now(),
    );
    const eventId = `${input.sourceType}:${input.ingestionSourceId}:${input.event.source_event_id}`;
    const rawOcsfJson = JSON.stringify({
      class_uid: OCSF_CLASS_API_ACTIVITY,
      category_uid: OCSF_CATEGORY_APPLICATION_ACTIVITY,
      activity_id: OCSF_ACTIVITY_INVOKE,
      type_uid: OCSF_CLASS_API_ACTIVITY * 100 + OCSF_ACTIVITY_INVOKE,
      severity_id: OCSF_SEVERITY_INFO,
      time: eventTime.epochMilliseconds,
      actor: {
        user: { uid: "", email_addr: input.event.actor },
        enduser: { uid: "" },
      },
      api: { operation: input.event.action },
      dst_endpoint: { name: input.event.target },
      metadata: {
        product: { name: "LangWatch", vendor_name: "LangWatch" },
        extension: {
          uid: "langwatch.governance",
          source_type: input.sourceType,
          source_id: input.ingestionSourceId,
          ingest_mode: "pull",
          cost_usd: input.event.cost_usd,
          tokens_input: input.event.tokens_input,
          tokens_output: input.event.tokens_output,
          raw_event: input.event.raw_payload,
          ...input.event.extra,
        },
      },
    });

    return {
      tenantId: input.tenantId,
      eventId,
      traceId: `pull:${eventId}`,
      sourceId: input.ingestionSourceId,
      sourceType: input.sourceType,
      activityId: OCSF_ACTIVITY_INVOKE,
      severityId: OCSF_SEVERITY_INFO,
      eventTime,
      actorUserId: "",
      actorEmail: input.event.actor,
      actorEnduserId: "",
      actionName: input.event.action,
      targetName: input.event.target,
      anomalyAlertId: "",
      rawOcsfJson,
    };
  }
}
