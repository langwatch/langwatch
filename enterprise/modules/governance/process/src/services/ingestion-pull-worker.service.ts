import type {
  GovernanceIngestionSource,
  NormalizedPullEvent,
  PullResult,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND } from "@langwatch/project-contract";
import { Temporal, toEpochMs } from "@langwatch/time";

import type {
  DiscoveredPeopleMatcher,
  GovernanceProjectDirectory,
  GovernanceOcsfEventInput,
  GovernanceOcsfEventSink,
  GovernanceTraceIngestionClient,
  GovernanceTraceRequest,
  IngestionPullDiagnosticsSink,
  IngestionPullRunResult,
  IngestionPullSourceReader,
  PulledUsageDispatcher,
  PulledUsageEntitlements,
} from "../app/governance.members.ts";
import type { IngestionSourceRepository } from "../repositories/ingestion-source.repository.ts";
import type {
  ConversationRoutingProfile,
  RoutingOrigin,
} from "../rules/conversation-trace-assembly-service.rules.ts";
import { COPILOT_ROUTING_PROFILE } from "../rules/copilot-studio-trace-mapper-service.rules.ts";
import * as CopilotStudioTraceMapperService from "../rules/copilot-studio-trace-mapper-service.rules.ts";
import { partitionSuppressedEvents } from "../rules/erasure-suppression.rules.ts";
import { GENIE_ROUTING_PROFILE } from "../rules/genie-trace-mapper-service.rules.ts";
import * as GenieTraceMapperService from "../rules/genie-trace-mapper-service.rules.ts";
import { pullReadThrough } from "../rules/pull-read-through.rules.ts";
import type { DirectoryDepartmentSyncService } from "./directory-department-sync.service.ts";
import type { ErasureSuppressionService } from "./erasure-suppression.service.ts";
import type { IngestionCredentialsService } from "./ingestion-credentials.service.ts";
import type { PersonDiscoveryService } from "./person-discovery.service.ts";
import type { PulledUsageRecordService } from "./pulled-usage-record.service.ts";
import type { PullerRegistryService } from "./puller-registry.service.ts";

const OCSF_CLASS_API_ACTIVITY = 6003;
const OCSF_CATEGORY_APPLICATION_ACTIVITY = 6;
const OCSF_ACTIVITY_INVOKE = 6;
const OCSF_SEVERITY_INFO = 1;

type UnpricedWindowStore = Pick<
  IngestionSourceRepository,
  "getUnpricedUsageWindow" | "updateUnpricedUsageWindow"
>;

type DepartmentSync = Pick<DirectoryDepartmentSyncService, "applyDirectoryEvents">;

type ConversationRouting = {
  profile: ConversationRoutingProfile;
  map(input: {
    events: NormalizedPullEvent[];
    origin: RoutingOrigin;
  }): GovernanceTraceRequest | null;
};

const CONVERSATION_ROUTING = new Map<string, ConversationRouting>([
  [
    "databricks_genie",
    { profile: GENIE_ROUTING_PROFILE, map: GenieTraceMapperService.toTraceRequest },
  ],
  [
    "copilot_studio_dataverse",
    { profile: COPILOT_ROUTING_PROFILE, map: CopilotStudioTraceMapperService.toTraceRequest },
  ],
]);

export class IngestionPullDeadlineExceededError extends Error {
  constructor(deadlineMs: number) {
    super(`Ingestion pull exceeded its ${deadlineMs}ms deadline`);
    this.name = "IngestionPullDeadlineExceededError";
  }
}

export class IngestionPullWorkerConfiguration {
  private constructor(readonly deadlineMs: number) {}

  static create(
    input: {
      deadlineMs?: number;
    } = {},
  ): IngestionPullWorkerConfiguration {
    return new IngestionPullWorkerConfiguration(input.deadlineMs ?? 5 * 60 * 1000);
  }
}

export class IngestionPullWorkerService {
  private readonly sources: IngestionPullSourceReader;
  private readonly registry: PullerRegistryService;
  private readonly credentials: IngestionCredentialsService;
  private readonly projects: GovernanceProjectDirectory;
  private readonly sink: GovernanceOcsfEventSink;
  private readonly usageEntitlement: PulledUsageEntitlements;
  private readonly usageRecords: PulledUsageRecordService;
  private readonly suppression: Pick<ErasureSuppressionService, "loadForProvider">;
  private readonly discovery: Pick<PersonDiscoveryService, "recordFromPulledEvents">;
  private readonly identityMatch: DiscoveredPeopleMatcher;
  private readonly unpricedWindows: UnpricedWindowStore;
  private readonly departmentSync: DepartmentSync;
  private readonly diagnostics: IngestionPullDiagnosticsSink;
  private readonly traceIngestion: GovernanceTraceIngestionClient | undefined;
  private readonly configuration: IngestionPullWorkerConfiguration;
  private readonly now: () => number;

  private constructor({
    sources,
    registry,
    credentials,
    projects,
    sink,
    usageEntitlement,
    usageRecords,
    suppression,
    discovery,
    identityMatch,
    unpricedWindows,
    departmentSync,
    diagnostics,
    traceIngestion,
    configuration,
    now,
  }: {
    sources: IngestionPullSourceReader;
    registry: PullerRegistryService;
    credentials: IngestionCredentialsService;
    projects: GovernanceProjectDirectory;
    sink: GovernanceOcsfEventSink;
    usageEntitlement: PulledUsageEntitlements;
    usageRecords: PulledUsageRecordService;
    suppression: Pick<ErasureSuppressionService, "loadForProvider">;
    discovery: Pick<PersonDiscoveryService, "recordFromPulledEvents">;
    identityMatch: DiscoveredPeopleMatcher;
    unpricedWindows: UnpricedWindowStore;
    departmentSync: DepartmentSync;
    diagnostics: IngestionPullDiagnosticsSink;
    traceIngestion: GovernanceTraceIngestionClient | undefined;
    configuration: IngestionPullWorkerConfiguration;
    now: () => number;
  }) {
    this.sources = sources;
    this.registry = registry;
    this.credentials = credentials;
    this.projects = projects;
    this.sink = sink;
    this.usageEntitlement = usageEntitlement;
    this.usageRecords = usageRecords;
    this.suppression = suppression;
    this.discovery = discovery;
    this.identityMatch = identityMatch;
    this.unpricedWindows = unpricedWindows;
    this.departmentSync = departmentSync;
    this.diagnostics = diagnostics;
    this.traceIngestion = traceIngestion;
    this.configuration = configuration;
    this.now = now;
  }

  static create(options: {
    sources: IngestionPullSourceReader;
    registry: PullerRegistryService;
    credentials: IngestionCredentialsService;
    projects: GovernanceProjectDirectory;
    sink: GovernanceOcsfEventSink;
    usageEntitlement: PulledUsageEntitlements;
    usageRecords: PulledUsageRecordService;
    suppression: Pick<ErasureSuppressionService, "loadForProvider">;
    discovery: Pick<PersonDiscoveryService, "recordFromPulledEvents">;
    identityMatch: DiscoveredPeopleMatcher;
    unpricedWindows: UnpricedWindowStore;
    departmentSync: DepartmentSync;
    diagnostics: IngestionPullDiagnosticsSink;
    traceIngestion?: GovernanceTraceIngestionClient;
    configuration?: IngestionPullWorkerConfiguration;
    now?: () => number;
  }): IngestionPullWorkerService {
    return new IngestionPullWorkerService({
      sources: options.sources,
      registry: options.registry,
      credentials: options.credentials,
      projects: options.projects,
      sink: options.sink,
      usageEntitlement: options.usageEntitlement,
      usageRecords: options.usageRecords,
      suppression: options.suppression,
      discovery: options.discovery,
      identityMatch: options.identityMatch,
      unpricedWindows: options.unpricedWindows,
      departmentSync: options.departmentSync,
      diagnostics: options.diagnostics,
      traceIngestion: options.traceIngestion,
      configuration: options.configuration ?? IngestionPullWorkerConfiguration.create(),
      now: options.now ?? Date.now,
    });
  }

  async run(input: {
    sourceId: string;
    cursor: string | null;
    pulledUsage?: PulledUsageDispatcher;
  }): Promise<IngestionPullRunResult> {
    const source = await this.sources.findById(input.sourceId);
    if (!source) {
      throw new Error(`IngestionSource ${input.sourceId} not found`);
    }

    if (source.status !== "active" && source.status !== "awaiting_first_event") {
      this.diagnostics.info("IngestionSource not active, skipping", {
        ingestionSourceId: source.id,
        status: source.status,
      });

      // A run that never started: nothing read, nothing half-read, no claim to have read up to now.
      return {
        nextCursor: input.cursor,
        eventCount: 0,
        errorCount: 0,
        completeness: "complete",
        readThroughAt: null,
      };
    }

    const pullConfig = source.parserConfig;
    const adapterId = pullConfig.adapter;
    if (typeof adapterId !== "string") {
      throw new Error("IngestionSource has no pullConfig.adapter");
    }

    const adapter = this.registry.getById(adapterId);

    const validatedConfig = adapter.validateConfig(pullConfig);

    let result: PullResult;
    try {
      result = await this.withDeadline((signal, deadlineAt) =>
        adapter.runOnce(
          {
            cursor: input.cursor,
            credentials: this.credentials.decrypt(pullConfig.credentials),
            context: {
              organizationId: source.organizationId,
              ingestionSourceId: source.id,
            },
            deadlineMs: deadlineAt,
            signal,
          },
          validatedConfig,
        ),
      );
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.diagnostics.error("adapter.runOnce threw — leaving the durable cursor unchanged", {
        ingestionSourceId: source.id,
        adapterId,
        error: normalized.message,
      });
      this.diagnostics.capture(normalized, {
        worker: "ingestionPuller",
        ingestionSourceId: source.id,
      });

      throw error;
    }

    if (result.errorCount > 0) {
      const cursorAdvanced = result.cursor !== null && result.cursor !== input.cursor;
      if (!cursorAdvanced) {
        throw new Error(`Ingestion pull adapter reported ${result.errorCount} error(s)`);
      }
      this.diagnostics.warn(
        "adapter advanced past input it could not read — keeping the events it did collect and persisting the advance",
        {
          ingestionSourceId: source.id,
          adapterId,
          errorCount: result.errorCount,
          eventCount: result.events.length,
          fromCursor: input.cursor,
          toCursor: result.cursor,
        },
      );
    }

    if (result.events.length > 0) {
      await this.writePulledEvents({
        events: result.events,
        source,
        pulledUsage: input.pulledUsage,
        completeness: result.completeness ?? "complete",
      });
    }

    const readThrough = pullReadThrough({ result, nowMs: this.now() });
    return {
      nextCursor: result.cursor,
      eventCount: result.events.length,
      errorCount: result.errorCount,
      completeness: result.completeness ?? "complete",
      ...(result.unreadPage === true ? { unreadPage: true as const } : {}),
      readThroughAt: readThrough.outcome === "read-through" ? readThrough.at : null,
    };
  }

  /** Main `pullerWorker.ts:562-667`: suppressed actors are never written, discovered or routed. */
  private async writePulledEvents(input: {
    events: NormalizedPullEvent[];
    source: GovernanceIngestionSource;
    pulledUsage?: PulledUsageDispatcher;
    completeness: "complete" | "truncated";
  }): Promise<void> {
    const { source } = input;
    const suppression = await this.suppression.loadForProvider({
      organizationId: source.organizationId,
      provider: source.sourceType,
    });
    const { kept, suppressedCount } = partitionSuppressedEvents({
      events: input.events,
      actorOf: (event) => event.actor,
      suppression,
    });
    const periods = await this.writeEvents({
      events: kept,
      source,
      pulledUsage: input.pulledUsage,
    });
    await this.recordUnpricedUsageWindow({ source, ...periods, completeness: input.completeness });
    if (suppressedCount > 0) {
      this.diagnostics.info("skipped pulled events naming an erased identifier", {
        ingestionSourceId: source.id,
        suppressedCount,
      });
    }
    const { discovered } = await this.syncPeopleFactsFromPull({ source, events: kept });
    await this.routeConversations({ events: kept, source });
    if (discovered > 0) {
      try {
        await this.identityMatch.runFor({ organizationId: source.organizationId });
      } catch (error) {
        this.diagnostics.error(
          "identity match pass failed; the discovered people are kept and the next pull retries",
          { ingestionSourceId: source.id, error: toErrorMessage(error) },
        );
      }
    }
  }

  /** Main `pullerWorker.ts:740-775`; `events` is the post-partition list (ADR-128 §9 step 1). */
  private async syncPeopleFactsFromPull({
    source,
    events,
  }: {
    source: GovernanceIngestionSource;
    events: NormalizedPullEvent[];
  }): Promise<{ discovered: number }> {
    let discovered = 0;
    try {
      ({ discovered } = await this.discovery.recordFromPulledEvents({
        organizationId: source.organizationId,
        provider: source.sourceType,
        events,
      }));
    } catch (error) {
      this.diagnostics.error(
        "could not record discovered people; the pulled events are still delivered",
        { ingestionSourceId: source.id, error: toErrorMessage(error) },
      );
    }
    try {
      await this.departmentSync.applyDirectoryEvents({
        organizationId: source.organizationId,
        provider: source.sourceType,
        events,
      });
    } catch (error) {
      this.diagnostics.error(
        "could not apply directory departments; the pulled events are still delivered",
        { ingestionSourceId: source.id, error: toErrorMessage(error) },
      );
    }
    return { discovered };
  }

  private async routeConversations(input: {
    events: NormalizedPullEvent[];
    source: GovernanceIngestionSource;
  }): Promise<void> {
    const { source } = input;
    if (!source.traceProjectId) {
      return;
    }

    const routing = CONVERSATION_ROUTING.get(source.sourceType);
    if (!routing) {
      return;
    }

    if (!this.traceIngestion) {
      throw new Error("Conversation trace ingestion is not composed");
    }

    const request = routing.map({
      events: input.events,
      origin: {
        ingestionSourceId: source.id,
        organizationId: source.organizationId,
        sourceType: source.sourceType,
        profile: routing.profile,
      },
    });
    if (!request) {
      return;
    }

    const project = await this.projects.findWithTeam(source.traceProjectId);
    const destinationIsLive =
      project !== null &&
      project.archivedAt === null &&
      project.team.organizationId === source.organizationId;
    if (!destinationIsLive) {
      this.diagnostics.warn(
        "trace destination is archived, deleted, or belongs to another organization",
        { ingestionSourceId: source.id, traceProjectId: source.traceProjectId },
      );

      return;
    }

    const result = await this.traceIngestion.ingest({
      projectId: project.id,
      request,
    });
    if (result.ingestionFailures === 0) {
      return;
    }

    const detail = result.ingestionFailureMessage ? `: ${result.ingestionFailureMessage}` : "";

    throw new Error(
      `Trace door failed to dispatch ${result.ingestionFailures} span(s) for ingestion source ${source.id}${detail}`,
    );
  }

  private async withDeadline<T>(
    work: (signal: AbortSignal, deadlineAt: number) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = this.configuration.deadlineMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await Promise.race([
        work(controller.signal, this.now() + timeoutMs),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new IngestionPullDeadlineExceededError(timeoutMs)),
            { once: true },
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async writeEvents(input: {
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
            ingestionSourceId: input.source.id,
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
  private async recordUnpricedUsageWindow({
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
