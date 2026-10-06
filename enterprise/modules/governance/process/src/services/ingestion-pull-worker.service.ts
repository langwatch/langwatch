import type {
  GovernanceIngestionSource,
  NormalizedPullEvent,
  PullResult,
  PulledUsageObservedEventData,
} from "@langwatch/enterprise-governance-contract";
import {
  type InternalProject,
  type InternalProjectQuery,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";

import type { GovernanceOcsfEventSink } from "../repositories/governance.repositories.ts";
import type { IngestionPullSourceReader } from "../repositories/ingestion-source.repository.ts";
import { partitionSuppressedEvents } from "../rules/erasure-suppression.rules.ts";
import { credentialsOf } from "../rules/ingestion-credentials.rules.ts";
import { pullReadThrough } from "../rules/pull-read-through.rules.ts";
import type { DirectoryDepartmentSyncService } from "./directory-department-sync.service.ts";
import type { ErasureSuppressionService } from "./erasure-suppression.service.ts";
import { IngestionPullConversationRouterService } from "./ingestion-pull-conversation-router.service.ts";
import {
  IngestionPullEventWriterService,
  type UnpricedWindowStore,
} from "./ingestion-pull-event-writer.service.ts";
import type { IngestionPullDiagnosticsSink } from "./ingestion-pull-log.service.ts";
import type { IngestionPullRunResult } from "./ingestion-pull.service.ts";
import type { PersonDiscoveryService } from "./person-discovery.service.ts";
import type { PulledUsageRecordService } from "./pulled-usage-record.service.ts";
import type { PullerRegistryService } from "./puller-registry.service.ts";

/** Main's shape: the mappers build the same OTLP request the trace door takes. */
export type GovernanceTraceRequest = IExportTraceServiceRequest;

export interface GovernanceTraceIngestionClient {
  ingest(input: { projectId: string; request: GovernanceTraceRequest }): Promise<{
    rejectedSpans: number;
    ingestionFailures: number;
    ingestionFailureMessage?: string;
  }>;
}

export interface PulledUsageDispatcher {
  recordPulledUsage(
    input: PulledUsageObservedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

export interface PulledUsageEntitlements {
  isEnabled(organizationId: string): Promise<boolean>;
}

/** ADR-128 §12: the discovery feed's trigger for the identity match engine. */
export interface DiscoveredPeopleMatcher {
  runFor(input: { organizationId: string }): Promise<void>;
}

/**
 * The two project reads Governance makes: the tenant a pull writes under,
 * and the hidden per-organization project every receiver ensures. Stated
 * here rather than taken off the project feature, so composing stays the process's job.
 */
export interface GovernanceProjectDirectory {
  findWithTeam(id: string): Promise<ProjectWithTeam | null>;

  ensureInternal(input: InternalProjectQuery): Promise<InternalProject>;
}

type DepartmentSync = Pick<DirectoryDepartmentSyncService, "applyDirectoryEvents">;

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
  private readonly projects: GovernanceProjectDirectory;
  private readonly suppression: Pick<ErasureSuppressionService, "loadForProvider">;
  private readonly discovery: Pick<PersonDiscoveryService, "recordFromPulledEvents">;
  private readonly identityMatch: DiscoveredPeopleMatcher;
  private readonly departmentSync: DepartmentSync;
  private readonly diagnostics: IngestionPullDiagnosticsSink;
  private readonly configuration: IngestionPullWorkerConfiguration;
  private readonly now: () => number;
  private readonly writer: IngestionPullEventWriterService;
  private readonly conversations: IngestionPullConversationRouterService;

  private constructor({
    sources,
    registry,
    projects,
    suppression,
    discovery,
    identityMatch,
    departmentSync,
    diagnostics,
    configuration,
    now,
    writer,
    conversations,
  }: {
    sources: IngestionPullSourceReader;
    registry: PullerRegistryService;
    projects: GovernanceProjectDirectory;
    suppression: Pick<ErasureSuppressionService, "loadForProvider">;
    discovery: Pick<PersonDiscoveryService, "recordFromPulledEvents">;
    identityMatch: DiscoveredPeopleMatcher;
    departmentSync: DepartmentSync;
    diagnostics: IngestionPullDiagnosticsSink;
    configuration: IngestionPullWorkerConfiguration;
    now: () => number;
    writer: IngestionPullEventWriterService;
    conversations: IngestionPullConversationRouterService;
  }) {
    this.sources = sources;
    this.registry = registry;
    this.projects = projects;
    this.suppression = suppression;
    this.discovery = discovery;
    this.identityMatch = identityMatch;
    this.departmentSync = departmentSync;
    this.diagnostics = diagnostics;
    this.configuration = configuration;
    this.now = now;
    this.writer = writer;
    this.conversations = conversations;
  }

  static create(options: {
    sources: IngestionPullSourceReader;
    registry: PullerRegistryService;
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
    const now = options.now ?? Date.now;
    return new IngestionPullWorkerService({
      sources: options.sources,
      registry: options.registry,
      projects: options.projects,
      suppression: options.suppression,
      discovery: options.discovery,
      identityMatch: options.identityMatch,
      departmentSync: options.departmentSync,
      diagnostics: options.diagnostics,
      configuration: options.configuration ?? IngestionPullWorkerConfiguration.create(),
      now,
      conversations: IngestionPullConversationRouterService.create({
        projects: options.projects,
        traceIngestion: options.traceIngestion,
        diagnostics: options.diagnostics,
      }),
      writer: IngestionPullEventWriterService.create({
        projects: options.projects,
        sink: options.sink,
        usageEntitlement: options.usageEntitlement,
        usageRecords: options.usageRecords,
        unpricedWindows: options.unpricedWindows,
        diagnostics: options.diagnostics,
        now,
      }),
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

    const { adapterId, result } = await this.runAdapter({ source, cursor: input.cursor });

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

  /** The adapter's one run under the deadline; a throw leaves the durable cursor unchanged. */
  private async runAdapter({
    source,
    cursor,
  }: {
    source: GovernanceIngestionSource;
    cursor: string | null;
  }): Promise<{ adapterId: string; result: PullResult }> {
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
            cursor: cursor,
            credentials: credentialsOf(pullConfig.credentials),
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

    return { adapterId, result };
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
    const periods = await this.writer.writeEvents({
      events: kept,
      source,
      pulledUsage: input.pulledUsage,
    });
    await this.writer.recordUnpricedUsageWindow({
      source,
      ...periods,
      completeness: input.completeness,
    });
    if (suppressedCount > 0) {
      this.diagnostics.info("skipped pulled events naming an erased identifier", {
        ingestionSourceId: source.id,
        suppressedCount,
      });
    }
    const { discovered } = await this.syncPeopleFactsFromPull({ source, events: kept });
    await this.conversations.routeConversations({ events: kept, source });
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
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
