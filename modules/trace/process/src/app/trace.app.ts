import { on } from "node:events";

/**
 * Trace feature application: one typed contract replacing five previous bags.
 * Rules: attribution (caller stamped), full resolution on consuming reads,
 * partition-pruning hints, visibility verdicts, sample draw. See ADR for details.
 */
import type { CodingAgentApi, CodingAgentTranscript } from "@langwatch/coding-agent-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  type EvaluationApi,
  reportEvaluationCommandDataSchema,
  type EvaluationRunData,
  type EvaluationRunsByTraceQuery,
} from "@langwatch/evaluation-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type {
  InstantEvalApi,
  InstantEvalEstimateWire,
  InstantEvalRunProgress,
  InstantEvalRunReference,
} from "@langwatch/instant-eval-contract";
import type { EventingParticipation, FeatureSetup } from "@langwatch/kernel";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { PresenceApi } from "@langwatch/presence-contract";
import { type MembersRead, type RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareViewer, ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";
import type { TopicApi } from "@langwatch/topic-contract";
import {
  TraceCapabilityUnavailableError,
  type ExportProgressEvent,
  type Protections,
  type TraceEditOverlayPatch,
  TraceIngestionUnavailableError,
  recordCapturedSpanInputSchema,
  type RecordCapturedSpanInput,
  type CustomersAndLabelsResult,
  type DerivedTraceEvent,
  type DiscoverResult,
  type ElasticSearchEvent,
  type Evaluation,
  type DistinctFieldNamesResult,
  type FacetDescriptor,
  type FacetValuesResult,
  type PromptStudioSpanResult,
  type SessionGroupsResult,
  type SharedTraceDto,
  type Span,
  type SpanDetail,
  type SpanLangwatchSignals,
  type SpanResourceInfo,
  type SpanSummaryRow,
  type ModelUsageStatsRow,
  type ModelSpanSampleRow,
  type SpanTreeDeltaInput,
  type SpanTreeInput,
  type SpanTreeNode,
  type SpanTreePage,
  type TopicCountsResult,
  type Trace,
  type TraceIngestWaitInput,
  type TraceCanonicalisationService,
  type TraceExportDownload,
  type TraceExportDownloadInput,
  type TraceMessagesSide,
  type TraceRenderedSpanMessages,
  type TraceEditOverlayDto,
  type TraceEventRollup,
  type TraceLegacyFilterInput,
  type TraceListPage,
  type TraceContentReadService,
  type TraceViewerService,
  type TraceApi,
  type TraceOtlpIngestApi,
  type TraceAnnotationCommands,
  type TraceAnnotationMarker,
  type TraceSuggestionTarget,
  type TraceSummaryData,
  type TraceByIdInput,
  type TraceRecord,
  type TraceFullReadInput,
  type TraceFullRecord,
  type TraceFullThreadReadInput,
  type TraceDerivedEventsInput,
  type TraceQueryFieldCatalogueInput,
  type TraceQueryClassification,
  type TraceQueryClassificationInput,
  type TraceSummaryLookupInput,
  predefinedEventsSchemas,
  predefinedEventTypes,
  TRACK_EVENT_SPAN_NAME,
  type TrackEventRESTParamsValidator,
  type OtlpIngestCredential,
  type OtlpIngestCredentialInput,
  type OtlpIngestProject,
  type OtlpLogCollectionOutcome,
  type OtlpMetricCollectionOutcome,
  type OtlpTraceCollectionResult,
  TraceApi as TraceApiToken,
  DEFAULT_PII_REDACTION_LEVEL,
  type ExplorerInstantEvalRunInput,
  explorerHiddenOrigins,
  FilterParseError,
  type LangWatchQLTraceFilter,
  type ResolvedInstantEvalRun,
  type TraceDateField,
  type TraceUsageCount,
  type EvaluationTraceEvent,
  type EvaluationTraceSpan,
  type TracesForProjectResult,
  type AssignTopicCommandData,
  type ClassifyClaudeCallInput,
  type ClassifyClaudeCallResult,
  type DeriveClaudeResponseContentInput,
  type DeriveClaudeResponseContentResult,
  type ScenarioRoleMetrics,
  type ScenarioRoleMetricsInput,
  type TraceQueryEvaluationRun,
  type TraceTopicAssignment,
  type TraceTopicClusteringCounts,
  type TraceTopicClusteringPage,
  type TraceTopicClusteringPageInput,
  type TraceServerConfig,
  traceConfig,
  TraceIdAmbiguousError,
  TraceNotFoundError,
  type TraceMetadataUpdate,
  type TracePreconditionSampleInput,
} from "@langwatch/trace-contract";
import {
  buildParsedTurns,
  renderConversationMarkdown,
} from "@langwatch/trace-contract/conversation";
import type { z } from "zod";

import { tokenCounterChannels } from "../channels/token-counter-channels.registry.ts";
import { ClickhouseTraceQueryEvaluationRepository } from "../repositories/clickhouse/clickhouse.trace-query-evaluation.repository.ts";
import { ClickHouseTraceQueryLangWatchQLRepository } from "../repositories/clickhouse/clickhouse.trace-query-langwatch-ql.repository.ts";
import { ClickHouseTraceQueryRepository } from "../repositories/clickhouse/clickhouse.trace-query.repository.ts";
import { RedisTraceSpanDedupRepository } from "../repositories/redis/redis.trace-span-dedup.repository.ts";
import type { TraceExistenceRepository } from "../repositories/trace-existence.repository.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import {
  createFacetFilterResolver,
  type FacetFilterResolver,
} from "../rules/trace-facet-filter.rules.ts";
import {
  andFilterConditions,
  explorerOriginExclusion,
  findHiddenOriginConditions,
} from "../rules/trace-filter-hidden-origins.rules.ts";
import {
  describeTraceLegacyValidationError,
  traceLegacySearchBodySchema,
} from "../rules/trace-legacy-search-body.rules.ts";
import {
  extractLlmMessagesForSpan,
  extractLlmMessagesForTrace,
} from "../rules/trace-llm-messages.rules.ts";
import { tracePlatformUrl } from "../rules/trace-platform-url.rules.ts";
import { formatSpansDigest, formatSpansDigestBounded } from "../rules/trace-readable-span.rules.ts";
import { traceToConversationTurn } from "../rules/trace-thread-conversation.rules.ts";
import { buildTrackedEventSpan } from "../rules/tracked-event-span.rules.ts";
import { ClaudeCodeLogEnrichmentService } from "../services/claude-code-log-enrichment.service.ts";
import { LegacyFilterMatchingService } from "../services/legacy-filter-matching.service.ts";
import { PreconditionTraceDataService } from "../services/precondition-trace-data.service.ts";
import type { ScenarioRoleMetricsDerivationService } from "../services/scenario-role-metrics-derivation.service.ts";
import { TraceCollectorSpanService } from "../services/trace-collector-span.service.ts";
import { TraceContentReadService as ConcreteTraceContentReadService } from "../services/trace-content-read.service.ts";
import type { TraceEditRemoval } from "../services/trace-edit-overlay.service.ts";
import {
  TraceExportBoundsService,
  type TraceExportBounds,
} from "../services/trace-export-bounds.service.ts";
import { TraceExportDownloadService } from "../services/trace-export-download.service.ts";
import { TraceExportService } from "../services/trace-export.service.ts";
import type { TraceIngestCredentialService } from "../services/trace-ingest-credential.service.ts";
import type { TraceIngestionService } from "../services/trace-ingestion.service.ts";
import { TraceInstantEvalRunService } from "../services/trace-instant-eval-run.service.ts";
import type { TraceLegacyCredentialService } from "../services/trace-legacy-credential.service.ts";
import { TraceMetadataWriteService } from "../services/trace-metadata-write.service.ts";
import { TracePreconditionSampleService } from "../services/trace-precondition-sample.service.ts";
import { TraceProcessingCommandsService } from "../services/trace-processing-commands.service.ts";
import { TraceProcessingPipelineService } from "../services/trace-processing-pipeline.service.ts";
import { TraceReadBoundsService } from "../services/trace-read-bounds.service.ts";
import { TraceScenarioEventMediaService } from "../services/trace-scenario-event-media.service.ts";
import type { TraceTopicClusteringReadService } from "../services/trace-topic-clustering-read.service.ts";
import { TraceUsageCountService } from "../services/trace-usage-count.service.ts";
import type { TraceViewerProtectionService } from "../services/trace-viewer-protection.service.ts";
import type { TraceService as TraceTreeService } from "../services/trace.service.ts";
import type {
  CollectorApp,
  CollectorCredential,
  CollectorProject,
} from "../transport/collector.rest.ts";
import { buildTraceCollaborators } from "./trace-composition.build.ts";
import { traceDependencies } from "./trace-composition.types.ts";
import { composeTraceAppDependencies } from "./trace-read.composition.ts";
import {
  type TraceProcessingPipelineDefinition,
  type TraceSpanIngest,
  type TraceLegacyRead,
} from "./trace.members.ts";

/**
 * The app's KSUID resource for a tracked event (`KSUID_RESOURCES.TRACKED_EVENT`).
 * The literal lives here because that table is a web-package module and no
 * server file may import one.
 */
const TRACKED_EVENT_KSUID_RESOURCE = "trackedevent";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import type * as traceContractModule from "@langwatch/trace-contract";

import type {
  CollectorEvaluationReport,
  CollectorSpanIngest,
} from "../services/trace-collector-dispatch.service.ts";
import { TraceExportProgressService } from "../services/trace-export-progress.service.ts";
import { AmbiguousTraceIdPrefixError } from "../services/trace-legacy-read.service.ts";
import { TraceSharedReadService } from "../services/trace-shared-read.service.ts";
import { TraceTranscriptReadService } from "../services/trace-transcript-read.service.ts";
import {
  traceDerivedAttrPrefixes,
  traceReadMapperPorts,
} from "../transport/api-trpc/trace-read-mapper-ports.ts";
import type {
  TraceLegacyCredential,
  TraceLegacyReads,
  TraceLegacySearchFields,
  TraceLegacyShare,
} from "../transport/trace-legacy.rest.ts";

const logger = createLogger("langwatch:trace:app");

/** Who a write is attributed to. */
export interface TraceCaller {
  readonly id: string;
}

/** One trace-correlated log record as the storage read answers it. */
export type TraceLogRecordReadRow = Readonly<{
  spanId: string;
  timeUnixMs: number;
  body: string;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  scopeName: string;
  scopeVersion: string | null;
}>;

/** The list, facet and discover reads behind the grid and its sidebar. */
export type TracesListReader = Readonly<{
  getList(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    sort: { columnId: string; direction: "asc" | "desc" };
    page?: number;
    pageSize: number;
    cursor?: { sortValue: number; traceId: string };
    filterWhere?: { sql: string; params: Record<string, unknown> };
    visibilityCutoffMs?: number | null;
  }): Promise<TraceListPage>;
  getFacets(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    filterFor: FacetFilterResolver;
  }): Promise<FacetDescriptor[]>;
  getNewCount(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    since: number;
    filterWhere?: { sql: string; params: Record<string, unknown> };
  }): Promise<number>;
  getTraceIds(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    filterWhere?: { sql: string; params: Record<string, unknown> };
    limit: number;
  }): Promise<string[]>;
  getSuggestions(params: {
    tenantId: string;
    field: string;
    prefix: string;
    limit?: number;
  }): Promise<string[]>;
  getDiscover(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
  }): Promise<DiscoverResult>;
  getFacetValues(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    facetKey: string;
    prefix?: string;
    limit: number;
    offset: number;
  }): Promise<FacetValuesResult>;
}>;

/** The Sessions lens read. */
export type TracesSessionGroupsReader = Readonly<{
  getSessionGroups(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    sort?: { columnId: string; direction: "asc" | "desc" };
    pageSize: number;
    cursor?: string;
    filterWhere?: { sql: string; params: Record<string, unknown> };
    contentTerms?: string[];
    visibilityCutoffMs?: number | null;
  }): Promise<SessionGroupsResult>;
}>;

type ByTrace = { tenantId: string; traceId: string; occurredAtMs?: number };

/** Every per-span read the drawer, the waterfall and the share page issue. */
export type TracesSpanReader = Readonly<{
  getSpansByTraceId(
    params: ByTrace & { limit?: number; visibilityCutoffMs?: number | null },
  ): Promise<Span[]>;
  findSpanById(
    params: ByTrace & { spanId: string; visibilityCutoffMs?: number | null },
  ): Promise<Span | null>;
  getSpanEvents(params: ByTrace & { spanId: string }): Promise<ElasticSearchEvent[]>;
  getSpansPaginated(
    params: ByTrace & { limit: number; offset: number; visibilityCutoffMs?: number | null },
  ): Promise<{ spans: Span[]; total: number }>;
  getSpansSince(
    params: ByTrace & { sinceStartTimeMs: number; visibilityCutoffMs?: number | null },
  ): Promise<Span[]>;
  getSpanSummaryByTraceId(params: ByTrace): Promise<SpanSummaryRow[]>;
  getLangwatchSignalsByTraceId(
    params: ByTrace,
  ): Promise<{ spanId: string; signals: SpanLangwatchSignals["signals"] }[]>;
  getSpanResourcesByTraceId(params: ByTrace): Promise<SpanResourceInfo[]>;
  getTraceEventsByTraceId(params: ByTrace): Promise<DerivedTraceEvent[]>;
  getTraceEventRollupsByTraceIds(params: {
    tenantId: string;
    traceIds: string[];
    timeRange: { from: number; to: number };
  }): Promise<Record<string, TraceEventRollup>>;
  getModelUsageStats(params: {
    tenantId: string;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]>;
  getRecentSpansByModels(params: {
    tenantId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]>;
}>;

/**
 * The trace's own summary read: occurredAtMs prunes partitions, visibilityCutoffMs applies the
 * plan's window, full resolves offloaded values.
 */
export type TraceSummaryReader = Readonly<{
  getByTraceId(
    tenantId: string,
    traceId: string,
    options?: Readonly<{
      occurredAtMs?: number;
      visibilityCutoffMs?: number | null;
      full?: boolean;
    }>,
  ): Promise<TraceSummaryData>;
}>;

/** The trace's log records, as the storage read answers them. */
export type TraceLogRecordReader = Readonly<{
  getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<TraceLogRecordReadRow[]>;
}>;

/** The stored reviewer corrections, as this feature reads and writes them. */
export type TraceEditOverlayStore = Readonly<{
  findByTraceId(
    input: Readonly<{ projectId: string; traceId: string }>,
  ): Promise<TraceEditOverlayDto | null>;
  upsert(
    input: Readonly<{
      projectId: string;
      traceId: string;
      patch: unknown;
      userId: string | null;
    }>,
  ): Promise<TraceEditOverlayDto>;
  delete(input: Readonly<{ projectId: string; traceId: string }>): Promise<void>;
  mergeTraceIOEdit(
    input: Readonly<{
      projectId: string;
      traceId: string;
      field: "input" | "output";
      value: string;
      userId: string | null;
    }>,
  ): Promise<TraceEditOverlayDto>;
  removeTraceIOEdit(
    input: Readonly<{
      projectId: string;
      traceId: string;
      field: "input" | "output";
      userId: string | null;
    }>,
  ): Promise<TraceEditRemoval>;
  mergeSpanFieldEdit(
    input: Readonly<{
      projectId: string;
      traceId: string;
      spanId: string;
      field: "input" | "output";
      text: string;
      userId: string | null;
    }>,
  ): Promise<TraceEditOverlayDto>;
  removeSpanFieldEdit(
    input: Readonly<{
      projectId: string;
      traceId: string;
      spanId: string;
      field: "input" | "output";
      userId: string | null;
    }>,
  ): Promise<TraceEditRemoval>;
}>;

/**
 * The project's topic tree, as the topic-count read names its buckets. Only
 * the three fields the grid renders are declared: which topics exist is the
 * Topic feature's, and this application only labels counts with them.
 */
export type TracesTopicReader = Readonly<{
  getAll(
    input: Readonly<{ projectId: string }>,
  ): Promise<readonly Readonly<{ id: string; name: string; parentId: string | null }>[]>;
}>;

/** The read side of the process's broadcast fabric. */
export type TracesTrpcEmitters = Readonly<{
  getTenantEmitter(tenantId: string): NodeJS.EventEmitter;
  cleanupTenantEmitter(tenantId: string): void;
}>;

/** The resolved share, as far as the anonymous trace read needs to know it. */
export type ResolvedShare = Readonly<{
  resourceType: string;
  projectId: string;
  resourceId: string;
}>;

/** Redeeming a share token, and the payload cache keyed by its redactions. */
export type TraceShareReader = Readonly<{
  resolveForViewer(input: {
    token: string;
    viewer: ShareViewer;
    viewerKey?: string;
  }): Promise<ResolvedShare>;
  findCachedPayload(input: { token: string; protections: Protections }): Promise<unknown>;
  cachePayload(input: {
    token: string;
    protections: Protections;
    payload: SharedTraceDto;
  }): Promise<void>;
}>;

/** The project card the share page prints above the trace. */
export type TraceProjectReader = Readonly<{
  findById(projectId: string): Promise<{
    name: string | null;
    slug: string | null;
    language: string | null;
    framework: string | null;
  } | null>;
}>;

/** What the process composes this feature's application from. */
export interface TraceAppDependencies {
  storedObjects: StoredObjectApi;
  spanIngest?: TraceSpanIngest;
  viewer?: TraceViewerService;
  protections?: TraceViewerProtectionService;
  annotationCommands?: TraceAnnotationCommands;
  traces: Readonly<{
    existence: TraceExistenceRepository;
    /** The legacy trace read the `traces.*` and `spans.*` surfaces call. */
    read: TraceLegacyRead;
    list: TracesListReader;
    sessionGroups: TracesSessionGroupsReader;
    spans: TracesSpanReader;
    summary: TraceSummaryReader;
    tree: TraceTreeService;
    logRecords: TraceLogRecordReader;
    canonicalisation: TraceCanonicalisationService;
    /** Reviewer corrections applied over a captured trace at read time. */
    editOverlay: TraceEditOverlayStore;
    changeTraceName(input: {
      tenantId: string;
      traceId: string;
      newName: string;
      changedByUserId: string;
      occurredAt: number;
    }): Promise<unknown>;
  }>;
  topics: TopicApi;
  broadcast: TracesTrpcEmitters;
  evaluations: EvaluationApi;
  /**
   * The Instant Eval peer the Explorer's judged searches run through. Absent
   * on a process that composed Trace without it, and then the four Explorer
   * operations refuse by name rather than answering an empty run.
   */
  instantEvals?: InstantEvalApi;
  codingAgents: CodingAgentApi;
  presence?: PresenceApi;
  share: ShareApi;
  projects: ProjectApi;
  /**
   * The tier-effective request bounds these reads clamp and refuse by. The
   * entitlement peer resolves the caller's plan; the transport schemas only
   * carry the registry's enterprise ceiling.
   */
  requestBounds: Pick<EntitlementApi, "requestBound">;
  /**
   * The export download door's tier-effective rate window and in-flight
   * slots. Absent on a process that serves no export door; the door then
   * refuses by name rather than exporting unbudgeted.
   */
  exportBounds: TraceExportBounds | null;
  /**
   * The door the deprecated `/api/trace/*` family resolves its project
   * credential through. Optional because a REST-less process never reaches
   * it; `credential` raises by name rather than admitting an absent caller.
   */
  legacyCredential?: TraceLegacyCredentialService;
  /**
   * The door `POST /api/collector` and the OTLP receiver resolve their
   * project credential through — optional for the same reason as
   * `legacyCredential`: absent members raise by name, never admit a caller.
   */
  ingestCredential?: TraceIngestCredentialService;
  /**
   * Where an ingested span goes. Absent on a process that composed no receiver,
   * and then the ingestion doors refuse by name rather than answering 200 to
   * data they drop.
   */
  ingestion?: TraceIngestionService;
  /**
   * Where an exported OTLP LOG batch goes. Absent on every deployment today
   * — the Log module owns the collection and this module may not import it.
   * Absent, the door refuses permanently rather than retrying forever.
   */
  logCollection?: TraceOtlpIngestApi["otlpLogs"];
  /** The metric signal's twin of {@link logCollection}, absent for the same reason. */
  metricCollection?: TraceOtlpIngestApi["otlpMetrics"];
  /** The deployment's public origin, for `platformUrl`. Optional: not every install serves REST. */
  publicBaseUrl?: string;
  /** Counts the anonymous share read per token and per IP; absent, the share read refuses. */
  shareReadLimiter?: RateLimiter | undefined;
  /** Per-role scenario cost and latency over stored spans; absent, the derivation refuses. */
  scenarioRoleMetrics?: ScenarioRoleMetricsDerivationService | undefined;
  /** Topic clustering's reads of trace summaries; absent, both reads refuse. */
  topicClustering?: TraceTopicClusteringReadService | undefined;
  /** trace_processing's assignTopic sender; absent, a topic assignment refuses. */
  topicAssignment?: TraceTopicAssignment | undefined;
}

/**
 * The partition-pruning hint: present or absent, never undefined. Omitting the value scans every
 * weekly partition, turning 100ms reads into multi-second ones.
 */
function occurredAtHint(occurredAtMs?: number): { occurredAtMs: number } | Record<string, never> {
  return occurredAtMs !== undefined ? { occurredAtMs } : {};
}

/**
 * The free plan's 14 days. A constant, not config: both processes must read
 * the same number, no deployment ever stated it, and a core module may not
 * import the licensing contract.
 */
const TRACE_FALLBACK_VISIBILITY_DAYS = 14;

/**
 * The query-language translator behind `translateTraceFilter`/`extractTraceFreeTextTerms`.
 * Stateless (no store, no client), so one instance serves every request.
 */
const traceQueryTranslator = ClickHouseTraceQueryRepository.create();
/** The same language compiled against the LangWatchQL trace view; stateless too. */
const langWatchQLTraceFilter = ClickHouseTraceQueryLangWatchQLRepository.create();

/**
 * The store members this process opens, plus the two facts the process itself
 * knows: its public origin and its own name. Neither is a deployment fact.
 */
type TraceMembers = MembersRead<readonly ["clickhouse", "logger", "redis", "rateLimiter"]> &
  Readonly<{
    publicBaseUrl: string | undefined;
    processName: string;
  }>;

type TraceSetup = FeatureSetup<
  typeof traceDependencies,
  TraceMembers,
  TraceServerConfig,
  TraceRepositories
>;

/** Trace implements its public API and the collector's internal transport seam. */
export class TraceApp implements TraceApi, CollectorApp {
  static readonly contract = TraceApiToken;
  static readonly dependencies = traceDependencies;
  static readonly config = traceConfig;
  /**
   * Every name is from the process's vocabulary; boot refuses by name. ClickHouse holds every span,
   * `eventing` stages commands, and the logger names the process in a blob read's refusal.
   */
  static readonly reads = [
    "clickhouse",
    "logger",
    "redis",
    "rateLimiter",
    "publicBaseUrl",
    "processName",
  ] as const;

  static create(input: TraceAppDependencies | TraceSetup): TraceApp {
    if (!("members" in input)) return new TraceApp(input);

    const commands = TraceProcessingCommandsService.create({
      processName: input.members.processName,
    });
    const collaborators = buildTraceCollaborators({
      members: input.members,
      config: {
        processName: input.members.processName,
        fallbackVisibilityDays: TRACE_FALLBACK_VISIBILITY_DAYS,
        publicBaseUrl: input.members.publicBaseUrl,
      },
      commands,
      dedup: RedisTraceSpanDedupRepository.create({
        connection: input.members.redis,
        logger: input.members.logger,
      }),
    });
    const app = new TraceApp(
      composeTraceAppDependencies({
        ...collaborators,
        ...input.dependencies,
        repositories: input.repositories,
        requestBounds: input.dependencies.plans,
        exportBounds: TraceExportBoundsService.createOverRedis({
          entitlement: input.dependencies.plans,
          projects: input.dependencies.projects,
          rateLimiter: input.members.rateLimiter,
          redis: input.members.redis,
        }),
        presence: input.dependencies.presence,
        shareReadLimiter: input.members.rateLimiter,
        protections: {
          authz: input.dependencies.authz,
          projects: input.dependencies.projects,
          plans: input.dependencies.plans,
          dataPrivacy: input.dependencies.dataPrivacy,
          fallbackVisibilityDays: collaborators.fallbackVisibilityDays,
          processName: collaborators.processName,
        },
      }),
    );
    app.#processingCommands = commands;
    app.#usageCounts = TraceUsageCountService.create({
      projects: input.dependencies.projects,
      usageCount: input.repositories.usageCount,
    });
    app.#preconditionSamples = TracePreconditionSampleService.create({
      traces: app,
      evaluators: input.dependencies.evaluators,
    });
    const tokenizer = tokenCounterChannels.live.create(input.config.tokenizer);
    input.resources.own("Trace tokenizer", () => tokenizer.close());
    app.#processing = TraceProcessingPipelineService.create({
      processName: input.members.processName,
      tokenizer,
      peers: input.dependencies,
      repositories: input.repositories,
      canonicalisation: collaborators.canonicalisation,
      commands,
      findSummary: (lookup) => app.findSummary(lookup),
      recordTrackedEvent: ({ tenantId, body, eventId }) =>
        app.recordTrackedEvent({ project: { id: tenantId }, body, eventId }),
    });
    return app;
  }

  #processing: TraceProcessingPipelineService | null = null;
  #processingCommands: TraceProcessingCommandsService | null = null;
  #usageCounts: TraceUsageCountService | null = null;
  #preconditionSamples: TracePreconditionSampleService | null = null;

  readPreconditionSampleTraces(
    input: TracePreconditionSampleInput,
  ): Promise<(Trace & { passesPreconditions: boolean })[]> {
    if (!this.#preconditionSamples) {
      throw new TraceCapabilityUnavailableError("this process", "the precondition sample");
    }
    return this.#preconditionSamples.readSample(input);
  }

  async countTracesByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<{ projectId: string; count: number }[]> {
    if (!this.#usageCounts) {
      throw new TraceCapabilityUnavailableError("this process", "the trace usage count");
    }
    return this.#usageCounts.countByProjects(input);
  }

  /** trace_processing for this process's role: producers send, consumers fold and react. */
  traceProcessingPipeline(setup: {
    participation: EventingParticipation;
  }): TraceProcessingPipelineDefinition {
    if (!this.#processing) {
      throw new TraceCapabilityUnavailableError("this process", "the trace_processing pipeline");
    }
    return this.#processing.build(setup);
  }

  /** Binds trace_processing's own senders; every trace write goes through them. */
  connectTraceProcessingCommands(
    commands: EventingCommands<TraceProcessingPipelineDefinition>,
  ): void {
    this.#processingCommands?.connect(commands);
  }

  #contentReader: TraceContentReadService;
  #readBounds: TraceReadBoundsService;
  #exportDownload: TraceExportDownloadService | null;
  #scenarioEventMedia: TraceScenarioEventMediaService;
  #legacyFilterMatching: LegacyFilterMatchingService;
  #dependencies: TraceAppDependencies;
  #explorerEvals: TraceInstantEvalRunService | null;
  #sharedRead: TraceSharedReadService | null;
  #transcriptRead: TraceTranscriptReadService;
  #exportProgress: TraceExportProgressService;
  private constructor(dependencies: TraceAppDependencies) {
    this.#dependencies = dependencies;
    this.#transcriptRead = TraceTranscriptReadService.create();
    this.#exportProgress = TraceExportProgressService.create({
      broadcast: dependencies.broadcast,
    });
    this.#sharedRead =
      dependencies.protections && dependencies.shareReadLimiter
        ? TraceSharedReadService.create({
            reads: this,
            share: dependencies.share,
            projects: dependencies.projects,
            protections: dependencies.protections,
            rateLimiter: dependencies.shareReadLimiter,
            mappers: traceReadMapperPorts,
          })
        : null;
    this.#explorerEvals = dependencies.instantEvals
      ? TraceInstantEvalRunService.create({ instantEvals: dependencies.instantEvals })
      : null;
    this.#contentReader = ConcreteTraceContentReadService.create(dependencies.traces.read);
    this.#scenarioEventMedia = TraceScenarioEventMediaService.create(dependencies.storedObjects);
    this.#legacyFilterMatching = LegacyFilterMatchingService.create({
      preconditionTraceData: PreconditionTraceDataService.create(),
    });
    this.#readBounds = TraceReadBoundsService.create({
      entitlement: dependencies.requestBounds,
      projects: dependencies.projects,
    });
    this.#exportDownload =
      dependencies.protections && dependencies.exportBounds && dependencies.presence
        ? TraceExportDownloadService.create({
            exports: TraceExportService.create({ traceService: dependencies.traces.read }),
            protections: dependencies.protections,
            bounds: dependencies.exportBounds,
            presence: dependencies.presence,
          })
        : null;
  }

  estimateExplorerEvalRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<InstantEvalEstimateWire> {
    return this.#instantEvals().estimateRun(input);
  }

  startExplorerEvalRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<InstantEvalRunProgress> {
    return this.#instantEvals().startRun(input);
  }

  cancelExplorerEvalRun(input: {
    projectId: string;
    runId: string;
    requestedByUserId?: string;
  }): Promise<InstantEvalRunProgress> {
    return this.#instantEvals().cancelRun(input);
  }

  getExplorerEvalRun(input: { projectId: string; runId: string }): Promise<InstantEvalRunProgress> {
    return this.#instantEvals().getRun(input);
  }

  /**
   * The runs a query's `eval` chips claim, checked against the project. A
   * process composed without the Instant Eval peer can check none, so every
   * chip stays pending and the read answers what the rest of the query selects.
   */
  async findExplorerEvalRuns(input: {
    projectId: string;
    evalRuns?: Readonly<Record<string, InstantEvalRunReference>>;
  }): Promise<readonly ResolvedInstantEvalRun[]> {
    const references = Object.values(input.evalRuns ?? {});
    if (references.length === 0 || !this.#explorerEvals) return [];

    return this.#explorerEvals.findRegisteredRuns({
      projectId: input.projectId,
      references,
    });
  }

  #instantEvals(): TraceInstantEvalRunService {
    if (!this.#explorerEvals) {
      throw new Error(
        "An Explorer Instant Eval asked for the Instant Eval peer, but this process composed Trace without it",
      );
    }

    return this.#explorerEvals;
  }

  extractInlineMediaFromEvent(input: {
    event: unknown;
    projectId: string;
    ownerKind: "scenario_run";
    ownerId: string;
    purpose: "scenario_event";
  }): Promise<{ rewrittenEvent: unknown; refs: readonly { id: string }[] }> {
    return this.#scenarioEventMedia.extractInlineMediaFromEvent(input);
  }

  downloadTraceExport(input: TraceExportDownloadInput): Promise<TraceExportDownload> {
    if (!this.#exportDownload) {
      throw new Error(
        "The trace export download asked for its reader, protections, budget, and Presence progress peer, but this process composed Trace without all of them",
      );
    }

    return this.#exportDownload.download(input);
  }

  resolveIngestWaitTimeout(input: TraceIngestWaitInput): Promise<number> {
    return this.#dependencies.traces.tree.resolveIngestWaitTimeout(input);
  }

  formatSpansDigest(input: { spans: Span[] }): Promise<string> {
    return formatSpansDigest(input.spans);
  }

  async renderReadableTrace(input: { trace: Trace; maxTokens: number }): Promise<string> {
    return formatSpansDigestBounded({
      spans: input.trace.spans,
      maxTokens: input.maxTokens,
    }).text;
  }

  async renderThreadTranscript(input: {
    threadKey: string;
    traces: readonly Trace[];
    maxTokens?: number;
  }): Promise<string> {
    // The text alone: the renderer writes its own omitted-turn marker into the
    // transcript, so a cut leaves no second signal for a caller to read.
    return renderConversationMarkdown({
      conversationId: input.threadKey,
      turns: buildParsedTurns({
        turns: input.traces.map((trace) => traceToConversationTurn({ trace })),
      }),
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    }).text;
  }

  async renderTraceMessages(input: {
    trace: Trace;
    side: TraceMessagesSide;
  }): Promise<string | null> {
    const messages = extractLlmMessagesForTrace({
      trace: input.trace,
      spans: input.trace.spans ?? [],
    });
    if (!messages) return null;
    if (input.side === "input") return JSON.stringify(messages.input);
    if (input.side === "output") return JSON.stringify(messages.output);
    return JSON.stringify(messages);
  }

  async renderSpanMessages(input: {
    trace: Trace;
    spanId: string;
  }): Promise<TraceRenderedSpanMessages> {
    const span = (input.trace.spans ?? []).find((candidate) => candidate.span_id === input.spanId);
    if (!span) return { isSpanPresent: false, json: null };
    const messages = extractLlmMessagesForSpan({ span });
    const isEmpty = messages.input.length === 0 && messages.output.length === 0;
    return { isSpanPresent: true, json: isEmpty ? null : JSON.stringify(messages) };
  }

  async renderTraceJson(input: { trace: Trace }): Promise<string> {
    return JSON.stringify(input.trace);
  }

  async recordCapturedSpan(input: RecordCapturedSpanInput): Promise<void> {
    const parsed = recordCapturedSpanInputSchema.parse(input);
    const ingest = this.#dependencies.spanIngest;
    if (!ingest) {
      throw new TraceIngestionUnavailableError();
    }
    await ingest.recordSpan({
      tenantId: parsed.projectId,
      span: TraceCollectorSpanService.convertSpanToOtlp(parsed.span),
      resource: TraceCollectorSpanService.buildResource({
        reservedTraceMetadata: { user_id: parsed.userId },
        customMetadata: parsed.customMetadata,
      }),
      instrumentationScope: null,
      occurredAt: parsed.occurredAt,
    });
  }

  getEvaluationSpans(
    input: traceContractModule.EvaluationTraceReadInput,
  ): Promise<EvaluationTraceSpan[]> {
    return this.#dependencies.traces.tree.getEvaluationSpans(input);
  }

  getEvaluationEvents(
    input: traceContractModule.EvaluationTraceReadInput,
  ): Promise<EvaluationTraceEvent[]> {
    return this.#dependencies.traces.tree.getEvaluationEvents(input);
  }

  async listTraces(
    input: Parameters<TraceContentReadService["listTraces"]>[0],
  ): Promise<TracesForProjectResult> {
    const pageSize =
      input.query.pageSize === undefined
        ? undefined
        : await this.#readBounds.clampPageSize(input.query.projectId, input.query.pageSize);

    return this.#contentReader.listTraces({
      ...input,
      query: {
        ...input.query,
        ...(pageSize === undefined ? {} : { pageSize }),
      },
    });
  }
  findTrace(
    input: Parameters<TraceContentReadService["findTrace"]>[0],
  ): Promise<Trace | undefined> {
    return this.#contentReader.findTrace(input);
  }
  async readTracesWithSpans(
    input: Parameters<TraceContentReadService["readTracesWithSpans"]>[0],
  ): Promise<Trace[]> {
    await this.#readBounds.assertIdsWithinBound(input.projectId, input.traceIds);

    return this.#contentReader.readTracesWithSpans(input);
  }

  async readTracesWithSpansPreview(
    input: Parameters<TraceContentReadService["readTracesWithSpansPreview"]>[0],
  ): Promise<Trace[]> {
    await this.#readBounds.assertIdsWithinBound(input.projectId, input.traceIds);

    return this.#contentReader.readTracesWithSpansPreview(input);
  }
  readOrderedSpansForTrace(
    input: Parameters<TraceContentReadService["readOrderedSpansForTrace"]>[0],
  ): Promise<Span[]> {
    return this.#contentReader.readOrderedSpansForTrace(input);
  }
  readThreadTraces(
    input: Parameters<TraceContentReadService["readThreadTraces"]>[0],
  ): Promise<Trace[]> {
    return this.#contentReader.readThreadTraces(input);
  }
  async readThreadsTraces(
    input: Parameters<TraceContentReadService["readThreadsTraces"]>[0],
  ): Promise<Trace[]> {
    await this.#readBounds.assertIdsWithinBound(input.projectId, input.threadIds);

    return this.#contentReader.readThreadsTraces(input);
  }
  async readSampleTraces(
    input: Parameters<TraceContentReadService["readSampleTraces"]>[0],
  ): Promise<Trace[]> {
    const pageSize = await this.#readBounds.clampPageSize(input.query.projectId, input.pageSize);

    return this.#contentReader.readSampleTraces({ ...input, pageSize });
  }
  readForViewer(input: Parameters<TraceViewerService["readForViewer"]>[0]): Promise<Trace[]> {
    if (!this.#dependencies.viewer) throw new Error("Trace viewer service is unavailable");
    return this.#dependencies.viewer.readForViewer(input);
  }

  resolveViewerProtections(input: {
    projectId: string;
    userId: string | null;
  }): Promise<Protections> {
    if (!this.#dependencies.protections)
      throw new Error("Trace protections service is unavailable");
    return this.#dependencies.protections.resolve({
      projectId: input.projectId,
      userId: input.userId ?? void 0,
      publiclyShared: false,
    });
  }

  resolveApiKeyProtections(input: {
    projectId: string;
    apiKeyId: string | null;
    userId: string | null;
  }): Promise<Protections> {
    if (!this.#dependencies.protections)
      throw new Error("Trace protections service is unavailable");
    return this.#dependencies.protections.resolveForApiKey(input);
  }

  /**
   * The export download door's budget. Raises rather than exporting
   * unbudgeted when this process composed no export bounds, and a method
   * because the door reads it through the operations-only proxy.
   */
  exportBounds(): TraceExportBounds {
    const bounds = this.#dependencies.exportBounds;
    if (!bounds) {
      throw new Error(
        "The trace export download asked for its budget, and this process composed Trace without the export bounds it is counted through",
      );
    }

    return bounds;
  }

  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<TraceUsageCount> {
    return this.#dependencies.traces.existence.countUsage(input);
  }

  classifyClaudeCall(input: ClassifyClaudeCallInput): ClassifyClaudeCallResult {
    return this.#dependencies.traces.canonicalisation.classifyClaudeCall(input);
  }

  deriveClaudeResponseContent(
    input: DeriveClaudeResponseContentInput,
  ): DeriveClaudeResponseContentResult {
    return this.#dependencies.traces.canonicalisation.deriveClaudeResponseContent(input);
  }

  async assignTopic(input: AssignTopicCommandData): Promise<void> {
    return this.#composed("topicAssignment", "A topic assignment").assignTopic(input);
  }

  async deriveScenarioRoleMetrics(input: ScenarioRoleMetricsInput): Promise<ScenarioRoleMetrics> {
    return this.#composed("scenarioRoleMetrics", "A scenario role metrics derivation").derive(
      input,
    );
  }

  matchesFilterQuery(input: {
    query: string;
    foldState: TraceSummaryData;
    evaluations: TraceQueryEvaluationRun[] | null;
    events: DerivedTraceEvent[] | null;
  }): boolean {
    return ClickhouseTraceQueryEvaluationRepository.matches(input.query, {
      summary: input.foldState,
      evaluations: input.evaluations,
      events: input.events,
      spans: null,
    });
  }

  matchesTraceFilters(input: {
    filters: Readonly<Record<string, unknown>>;
    foldState: TraceSummaryData;
    events: DerivedTraceEvent[] | null;
  }): boolean {
    return this.#legacyFilterMatching.matchesTraceFilters(input);
  }

  async readTopicClusteringCounts(input: {
    projectId: string;
  }): Promise<TraceTopicClusteringCounts> {
    return this.#composed("topicClustering", "A topic clustering read").readCounts(input);
  }

  async readTopicClusteringPage(
    input: TraceTopicClusteringPageInput,
  ): Promise<TraceTopicClusteringPage> {
    return this.#composed("topicClustering", "A topic clustering read").readPage(input);
  }

  #composed<K extends "scenarioRoleMetrics" | "topicClustering" | "topicAssignment">(
    key: K,
    capability: string,
  ): NonNullable<TraceAppDependencies[K]> {
    const composed = this.#dependencies[key];
    if (!composed) {
      throw new Error(`${capability} reached Trace, but this process composed Trace without it`);
    }

    return composed;
  }

  findExistingTraceIds(input: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]> {
    return this.#dependencies.traces.existence.findExistingTraceIds(input);
  }

  loadTraces(input: {
    userId: string;
    projectId: string;
    traceIds: readonly string[];
  }): Promise<readonly Trace[]> {
    return this.readForViewer(input);
  }

  async writeSuggestion(input: {
    projectId: string;
    traceId: string;
    target: TraceSuggestionTarget;
    text: string;
    userId: string;
  }): Promise<void> {
    const { projectId, traceId, target, text, userId } = input;
    const withdrawn = text.length === 0;
    if (target.kind === "span") {
      const span = { projectId, traceId, spanId: target.spanId, userId };
      if (withdrawn) {
        await this.#dependencies.traces.editOverlay.removeSpanFieldEdit({
          ...span,
          field: target.field,
        });
      } else {
        await this.#dependencies.traces.editOverlay.mergeSpanFieldEdit({
          ...span,
          field: target.field,
          text,
        });
      }
      return;
    }

    const trace = { projectId, traceId, field: target.field, userId };
    if (withdrawn) {
      await this.#dependencies.traces.editOverlay.removeTraceIOEdit(trace);
    } else {
      await this.#dependencies.traces.editOverlay.mergeTraceIOEdit({
        ...trace,
        value: text,
      });
    }
  }

  recordAnnotation(input: TraceAnnotationMarker): Promise<void> {
    if (!this.#dependencies.annotationCommands) {
      return Promise.reject(new Error("Trace annotation commands are unavailable"));
    }
    return this.#dependencies.annotationCommands.add(input);
  }

  removeAnnotation(input: TraceAnnotationMarker): Promise<void> {
    if (!this.#dependencies.annotationCommands) {
      return Promise.reject(new Error("Trace annotation commands are unavailable"));
    }
    return this.#dependencies.annotationCommands.remove(input);
  }

  // Collaborators handed to a process port as VALUES: the coding-agent log
  // join reads the trace's logs itself and canonicalises per span, so it
  // takes these three as objects, not call results. Exposed rather than
  // wrapped since the join's port type is declared by the transport, and
  // an application importing its own transport would invert the layout.

  /** The trace-log read the coding-agent join issues for itself. */
  getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<TraceLogRecordReadRow[]> {
    return this.readTraceLogRecords({
      projectId: tenantId,
      traceId,
      occurredAtMs,
      limit,
    });
  }

  /** The canonicaliser the coding-agent join runs over joined span content. */
  isCodingAgentShapedSpan(span: Span): boolean {
    return ClaudeCodeLogEnrichmentService.isCodingAgentShapedSpan(span);
  }

  enrichSpansFromCodingAgentLogs(input: {
    projectId: string;
    traceId: string;
    spans: Span[];
    occurredAtMs?: number;
  }): Promise<Span[]> {
    return ClaudeCodeLogEnrichmentService.enrichCodingAgentSpansFromLogs({
      logRecords: this,
      tenantId: input.projectId,
      traceId: input.traceId,
      spans: input.spans,
      ...(input.occurredAtMs !== undefined ? { occurredAtMs: input.occurredAtMs } : {}),
      logger,
      traceCanonicalisation: this.#dependencies.traces.canonicalisation,
      codingAgents: this.#dependencies.codingAgents,
    });
  }

  enrichSpanFromCodingAgentLogs(input: {
    span: Span;
    modelCallRefs: unknown;
    logRows: TraceLogRecordReadRow[];
  }): Span {
    return ClaudeCodeLogEnrichmentService.enrichSingleSpanWithClaudeLogContent({
      span: input.span,
      modelCallRefs: input.modelCallRefs as Parameters<
        typeof ClaudeCodeLogEnrichmentService.enrichSingleSpanWithClaudeLogContent
      >[0]["modelCallRefs"],
      logRows: input.logRows,
      traceCanonicalisation: this.#dependencies.traces.canonicalisation,
      codingAgents: this.#dependencies.codingAgents,
    });
  }

  mapCodingAgentSummaryRows(rows: SpanSummaryRow[]): unknown {
    return ClaudeCodeLogEnrichmentService.mapSummaryRowsToClaudeRefs(rows);
  }

  codingAgentLogContentKeys(eventName: string): readonly {
    key: string;
    category: "input" | "output" | "both";
  }[] {
    return this.#dependencies.codingAgents.logContentKeys(eventName);
  }

  buildCodingAgentTranscript(input: {
    spans: SpanDetail[];
    logs: TraceLogRecordReadRow[];
  }): unknown {
    return this.#dependencies.codingAgents.buildTranscript({
      spans: input.spans,
      logs: input.logs.map((row) => ({
        timestampMs: row.timeUnixMs,
        attributes: row.attributes,
        serviceName: row.resourceAttributes["service.name"] ?? null,
      })),
    });
  }

  // Legacy content reads live on the cohesive content service.

  /** The evaluator verdicts on a page of traces, keyed by trace id. */
  async readEvaluations(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
  }): Promise<Record<string, Evaluation[]>> {
    await this.#readBounds.assertIdsWithinBound(input.projectId, input.traceIds);

    return this.#dependencies.traces.read.getEvaluationsMultiple(
      input.projectId,
      input.traceIds,
      input.protections,
    );
  }

  /** One evaluation's inputs, resolved lazily when its card is expanded. */
  findEvaluationInputs(input: {
    projectId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null> {
    return this.#dependencies.traces.read.findEvaluationInputs(input);
  }

  /** Topic and subtopic counts for the filtered window. */
  readTopicCounts(input: TraceLegacyFilterInput): Promise<TopicCountsResult> {
    return this.#dependencies.traces.read.getTopicCounts(input);
  }

  /** The distinct customer ids and labels in the filtered window. */
  readCustomersAndLabels(input: TraceLegacyFilterInput): Promise<CustomersAndLabelsResult> {
    return this.#dependencies.traces.read.getCustomersAndLabels(input);
  }

  /** Span names, metadata keys and evaluator names the project has produced. */
  readFieldNames(input: {
    projectId: string;
    startDate: number;
    endDate: number;
  }): Promise<DistinctFieldNamesResult> {
    return this.#dependencies.traces.read.getDistinctFieldNames(
      input.projectId,
      input.startDate,
      input.endDate,
    );
  }

  /** The trace query language's free-text filter, compiled to a ClickHouse WHERE fragment. */
  translateTraceFilter(input: {
    query: string;
    tenantId: string;
    timeRange: { from: number; to: number };
    evalRuns?: readonly ResolvedInstantEvalRun[];
  }): { sql: string; params: Record<string, unknown> } | null {
    return traceQueryTranslator.translateFilter({
      queryText: input.query,
      tenantId: input.tenantId,
      timeRange: input.timeRange,
      ...(input.evalRuns ? { evalRuns: input.evalRuns } : {}),
    });
  }

  /** The filter compiled against the LangWatchQL trace view, for a statement a caller runs. */
  compileLangWatchQLTraceFilter(input: { filter: string }): LangWatchQLTraceFilter {
    return langWatchQLTraceFilter.compile(input);
  }

  /**
   * The Explorer's own filter: the query compiled, hidden origins left out
   * unless the query (or `originNamed`) names one. `dateField` refuses a
   * span/event clause on the `updated` axis rather than dropping rows silently.
   */
  compileExplorerTraceFilter(input: {
    query: string;
    tenantId: string;
    timeRange: { from: number; to: number };
    evalRuns?: readonly ResolvedInstantEvalRun[];
    originNamed?: boolean;
    dateField?: TraceDateField;
  }): { sql: string; params: Record<string, unknown> } {
    const compiled = this.translateTraceFilter(input);

    if (input.dateField === "updated" && compiled?.sql.includes("stored_spans")) {
      throw new FilterParseError(
        "A span, event or free-text clause matches spans by when they started, and dateField " +
          '"updated" selects traces by when they were last modified — the two together would ' +
          "drop traces silently. Filter on trace-level fields instead, or pull on the occurred axis.",
      );
    }

    const hiddenOrigins = input.originNamed ? [] : explorerHiddenOrigins(input.query);

    return andFilterConditions([
      ...(compiled ? [compiled] : []),
      ...findHiddenOriginConditions({ hiddenOrigins }),
    ]);
  }

  /** The trace ids a filter selects, newest first and capped. */
  findTraceIdsForFilter(input: {
    projectId: string;
    filter: string;
    window: { from: number; to: number };
    limit: number;
  }): Promise<readonly string[]> {
    return this.#dependencies.traces.list.getTraceIds({
      tenantId: input.projectId,
      timeRange: input.window,
      filterWhere: this.compileExplorerTraceFilter({
        query: input.filter,
        tenantId: input.projectId,
        timeRange: input.window,
      }),
      limit: input.limit,
    });
  }

  /** The query's positive bare-word terms, for a content (log-body) search. */
  extractTraceFreeTextTerms(query: string): string[] {
    return traceQueryTranslator.extractFreeTextTerms(query);
  }

  /** One LLM span reshaped for the prompt studio, or null when it is not one. */
  findPromptStudioSpan(input: {
    projectId: string;
    spanId: string;
    protections: unknown;
  }): Promise<PromptStudioSpanResult | null> {
    return this.#dependencies.traces.read.findSpanForPromptStudio(input);
  }

  // -------------------------------------------------------------------------
  // The project's topics, as the topic-count read labels its buckets
  // -------------------------------------------------------------------------

  /** The project's topic tree. */
  readTopics(
    input: Readonly<{ projectId: string }>,
  ): Promise<readonly Readonly<{ id: string; name: string; parentId: string | null }>[]> {
    return this.#dependencies.topics.getAll(input);
  }

  // -------------------------------------------------------------------------
  // The process's broadcast fabric
  // -------------------------------------------------------------------------

  /** The tenant's broadcast emitter, for a caller that streams events itself. */
  getTenantEmitter(tenantId: string): NodeJS.EventEmitter {
    return this.#dependencies.broadcast.getTenantEmitter(tenantId);
  }

  /** Releases the tenant's broadcast emitter once a stream ends. */
  cleanupTenantEmitter(tenantId: string): void {
    this.#dependencies.broadcast.cleanupTenantEmitter(tenantId);
  }

  async *streamUpdates(input: {
    projectId: string;
    channel: "trace_updated" | "discover_updated";
    signal?: unknown;
  }): AsyncGenerator<unknown> {
    const emitter = this.#dependencies.broadcast.getTenantEmitter(input.projectId);

    try {
      for await (const eventArgs of on(emitter, input.channel, {
        signal: input.signal as AbortSignal | undefined,
      })) {
        yield eventArgs[0];
      }
    } finally {
      this.#dependencies.broadcast.cleanupTenantEmitter(input.projectId);
    }
  }

  // -------------------------------------------------------------------------
  // The explorer's list, facet and session reads
  // -------------------------------------------------------------------------

  /** One page of the trace grid. */
  readTraceList(params: Parameters<TracesListReader["getList"]>[0]): Promise<TraceListPage> {
    return this.#dependencies.traces.list.getList(params);
  }

  /** One page of the Sessions lens. */
  readSessionGroups(
    params: Parameters<TracesSessionGroupsReader["getSessionGroups"]>[0],
  ): Promise<SessionGroupsResult> {
    return this.#dependencies.traces.sessionGroups.getSessionGroups(params);
  }

  /**
   * The sidebar's facets under the active query: counted in the window the list
   * reads, each exempt from its own terms, the hidden origins out of all but
   * origin's own, uncached so a count answers the table's predicate (ADR-139).
   */
  async readFilteredFacets(input: {
    projectId: string;
    timeRange: { from: number; to: number; live?: boolean };
    query: string;
    evalRuns?: readonly ResolvedInstantEvalRun[];
  }): Promise<DiscoverResult> {
    const filterFor = createFacetFilterResolver({
      queryText: input.query,
      compile: (text) =>
        this.translateTraceFilter({
          query: text,
          tenantId: input.projectId,
          timeRange: input.timeRange,
          ...(input.evalRuns ? { evalRuns: input.evalRuns } : {}),
        }) ?? undefined,
      hide: explorerOriginExclusion({ hiddenOrigins: explorerHiddenOrigins(input.query) }),
    });

    const facets = await this.#dependencies.traces.list.getFacets({
      tenantId: input.projectId,
      timeRange: input.timeRange,
      filterFor,
    });

    return { facets, pending: false };
  }

  /** How many traces have arrived since the grid last painted. */
  readNewCount(params: Parameters<TracesListReader["getNewCount"]>[0]): Promise<number> {
    return this.#dependencies.traces.list.getNewCount(params);
  }

  /** The typeahead's values for one field. */
  readSuggestions(params: Parameters<TracesListReader["getSuggestions"]>[0]): Promise<string[]> {
    return this.#dependencies.traces.list.getSuggestions(params);
  }

  /** The facet payload the sidebar opens with. */
  readDiscover(params: Parameters<TracesListReader["getDiscover"]>[0]): Promise<DiscoverResult> {
    return this.#dependencies.traces.list.getDiscover(params);
  }

  /** One facet's values, paged. */
  readFacetValues(
    params: Parameters<TracesListReader["getFacetValues"]>[0],
  ): Promise<FacetValuesResult> {
    return this.#dependencies.traces.list.getFacetValues(params);
  }

  // -------------------------------------------------------------------------
  // The trace's summary
  // -------------------------------------------------------------------------

  /** One trace's summary fold. */
  readTraceSummary(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
    full?: boolean;
  }): Promise<TraceSummaryData> {
    return this.#dependencies.traces.summary.getByTraceId(input.projectId, input.traceId, {
      ...occurredAtHint(input.occurredAtMs),
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...(input.full !== undefined ? { full: input.full } : {}),
    });
  }

  /**
   * Whether the plan's visibility window teases this trace's content. Only free plans have a
   * window; with one, the trace's own summary decides visibility (same read the drawer header
   * makes).
   */
  async isTraceWindowRedacted(input: {
    projectId: string;
    traceId: string;
    visibilityCutoffMs: number | null | undefined;
  }): Promise<boolean> {
    if (input.visibilityCutoffMs === null || input.visibilityCutoffMs === undefined) {
      return false;
    }
    try {
      const summary = await this.readTraceSummary({
        projectId: input.projectId,
        traceId: input.traceId,
        visibilityCutoffMs: input.visibilityCutoffMs,
        full: false,
      });
      return summary.redactedByVisibilityWindow === true;
    } catch (error) {
      logger.warn(
        { error, projectId: input.projectId, traceId: input.traceId },
        "trace summary unreadable; withholding corrected content",
      );
      return true;
    }
  }

  // -------------------------------------------------------------------------
  // The trace's spans
  // -------------------------------------------------------------------------

  /** The light per-span summary rows the waterfall is built from. */
  readSpanSummaries(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<SpanSummaryRow[]> {
    return this.#dependencies.traces.spans.getSpanSummaryByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** Every stored span of one trace. */
  readSpans(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
    limit?: number;
  }): Promise<Span[]> {
    return this.#dependencies.traces.spans.getSpansByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** One page of a trace's spans. */
  readSpansPage(input: {
    projectId: string;
    traceId: string;
    limit: number;
    offset: number;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
  }): Promise<{ spans: Span[]; total: number }> {
    return this.#dependencies.traces.spans.getSpansPaginated({
      tenantId: input.projectId,
      traceId: input.traceId,
      limit: input.limit,
      offset: input.offset,
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The spans of a live trace that have moved since the browser last looked. */
  readSpansSince(input: {
    projectId: string;
    traceId: string;
    sinceStartTimeMs: number;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
  }): Promise<Span[]> {
    return this.#dependencies.traces.spans.getSpansSince({
      tenantId: input.projectId,
      traceId: input.traceId,
      sinceStartTimeMs: input.sinceStartTimeMs,
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** One span, by id. */
  findSpan(input: {
    projectId: string;
    traceId: string;
    spanId: string;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
  }): Promise<Span | null> {
    return this.#dependencies.traces.spans.findSpanById({
      tenantId: input.projectId,
      traceId: input.traceId,
      spanId: input.spanId,
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** One span's events. */
  readSpanEvents(input: {
    projectId: string;
    traceId: string;
    spanId: string;
    occurredAtMs?: number;
  }): Promise<ElasticSearchEvent[]> {
    return this.#dependencies.traces.spans.getSpanEvents({
      tenantId: input.projectId,
      traceId: input.traceId,
      spanId: input.spanId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The per-span LangWatch instrumentation signals the badges render. */
  readLangwatchSignals(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<{ spanId: string; signals: SpanLangwatchSignals["signals"] }[]> {
    return this.#dependencies.traces.spans.getLangwatchSignalsByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The per-span resource and scope rows the resource pane is built from. */
  readSpanResources(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<SpanResourceInfo[]> {
    return this.#dependencies.traces.spans.getSpanResourcesByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The trace-level events the drawer timeline renders. */
  readTraceEvents(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]> {
    return this.#dependencies.traces.spans.getTraceEventsByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The events column's rollups for one page of the grid. */
  readTraceEventRollups(input: {
    projectId: string;
    traceIds: string[];
    timeRange: { from: number; to: number };
  }): Promise<Record<string, TraceEventRollup>> {
    return this.#dependencies.traces.spans.getTraceEventRollupsByTraceIds({
      tenantId: input.projectId,
      traceIds: input.traceIds,
      timeRange: input.timeRange,
    });
  }

  // -------------------------------------------------------------------------
  // The span tree
  // -------------------------------------------------------------------------

  /** One page of the span tree, in `(startTimeMs, spanId)` order. */
  readSpanTreePage(input: SpanTreeInput): Promise<SpanTreePage> {
    return this.#dependencies.traces.tree.getSpanTreePage(input);
  }

  /** The tree nodes of a live trace whose row version is newer than a mark. */
  readSpanTreeDelta(input: SpanTreeDeltaInput): Promise<SpanTreeNode[]> {
    return this.#dependencies.traces.tree.getSpanTreeDelta(input);
  }

  /** The canonical trace record, closed under payload-parity review. */
  getById(input: TraceByIdInput): Promise<TraceRecord> {
    return this.#dependencies.traces.tree.getById(input);
  }

  getFullRecord(input: TraceFullReadInput): Promise<TraceFullRecord> {
    return this.#dependencies.traces.tree.getFullRecord(input);
  }

  getFullThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]> {
    return this.#dependencies.traces.tree.getFullThread(input);
  }

  deriveEvents(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]> {
    return this.#dependencies.traces.tree.deriveEvents(input);
  }

  /** The query-language field catalogue an AI composer's prompt is grounded on. */
  buildQueryFieldCatalogue(input: TraceQueryFieldCatalogueInput): Promise<string> {
    return this.#dependencies.traces.tree.buildQueryFieldCatalogue(input);
  }

  classifyQuery(input: TraceQueryClassificationInput): TraceQueryClassification {
    return this.#dependencies.traces.tree.classifyQuery(input);
  }

  /** A polling read: absent summaries and disabled projections both read as null. */
  findSummary(input: TraceSummaryLookupInput): Promise<TraceSummaryData | null> {
    return this.#dependencies.traces.tree.findSummary(input);
  }

  readModelUsageStats(input: {
    projectId: string;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]> {
    return this.#dependencies.traces.spans.getModelUsageStats({
      tenantId: input.projectId,
      fromMs: input.fromMs,
      limit: input.limit,
    });
  }

  readRecentSpansByModels(input: {
    projectId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]> {
    return this.#dependencies.traces.spans.getRecentSpansByModels({
      tenantId: input.projectId,
      models: input.models,
      fromMs: input.fromMs,
      perModelLimit: input.perModelLimit,
      limit: input.limit,
    });
  }

  // -------------------------------------------------------------------------
  // The trace's log records
  // -------------------------------------------------------------------------

  /** Every log record correlated to one trace. */
  readTraceLogRecords(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<TraceLogRecordReadRow[]> {
    return this.#dependencies.traces.logRecords.getLogsByTraceId(
      input.projectId,
      input.traceId,
      input.occurredAtMs,
      input.limit,
    );
  }

  // -------------------------------------------------------------------------
  // The two things a reader may change about a trace
  // -------------------------------------------------------------------------

  /**
   * Renames a trace, attributed to the caller. Attribution is a property of the act, not the
   * transport. Name is validated by the door.
   */
  changeTraceName(
    input: { projectId: string; traceId: string; newName: string; occurredAt?: number },
    by: TraceCaller,
  ): Promise<unknown> {
    return this.#dependencies.traces.changeTraceName({
      tenantId: input.projectId,
      traceId: input.traceId,
      newName: input.newName,
      changedByUserId: by.id,
      occurredAt: input.occurredAt ?? nowInstant().epochMilliseconds,
    });
  }

  /** The correction stored on a trace, before any reader-specific redaction. */
  findTraceEditOverlay(input: {
    projectId: string;
    traceId: string;
  }): Promise<TraceEditOverlayDto | null> {
    return this.#dependencies.traces.editOverlay.findByTraceId({
      projectId: input.projectId,
      traceId: input.traceId,
    });
  }

  /** Saves the correction, attributed to the caller. */
  saveTraceEditOverlay(
    input: { projectId: string; traceId: string; patch: TraceEditOverlayPatch },
    by: TraceCaller,
  ): Promise<TraceEditOverlayDto> {
    return this.#dependencies.traces.editOverlay.upsert({
      projectId: input.projectId,
      traceId: input.traceId,
      patch: input.patch,
      userId: by.id,
    });
  }

  /** Removes the correction outright. */
  deleteTraceEditOverlay(input: { projectId: string; traceId: string }): Promise<void> {
    return this.#dependencies.traces.editOverlay.delete({
      projectId: input.projectId,
      traceId: input.traceId,
    });
  }

  // -------------------------------------------------------------------------
  // What other verticals answer about a trace
  // -------------------------------------------------------------------------

  /** The evaluation runs recorded against one trace. */
  readEvaluationRuns(input: EvaluationRunsByTraceQuery): Promise<EvaluationRunData[]> {
    return this.#dependencies.evaluations.findRunsByTraceId(input);
  }

  /** The pre-folded coding-agent session rollup for one trace, or null. */
  readCodingAgentSession(
    input: Parameters<CodingAgentApi["findSessionForTrace"]>[0],
  ): ReturnType<CodingAgentApi["findSessionForTrace"]> {
    return this.#dependencies.codingAgents.findSessionForTrace(input);
  }

  /** Port of main's `codingAgentTranscript`: the viewer's protections, then the shared read. */
  async readCodingAgentTranscript(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number | undefined;
    viewerUserId: string;
  }): Promise<CodingAgentTranscript> {
    const protections = await this.resolveViewerProtections({
      projectId: input.projectId,
      userId: input.viewerUserId,
    });

    return this.#readTranscriptWithProtections({ ...input, protections });
  }

  async updateTraceMetadata(input: {
    projectId: string;
    traceId: string;
    metadata: TraceMetadataUpdate;
  }): Promise<void> {
    const ingest = this.#dependencies.spanIngest;
    if (!ingest) {
      throw new TraceIngestionUnavailableError();
    }
    await TraceMetadataWriteService.updateTraceMetadata({ ingest, ...input });
  }

  /** Port of main's REST transcript route: the key's protections, the trace, its transcript. */
  async readTraceTranscript(input: {
    projectId: string;
    traceId: string;
    apiKeyId: string | null;
    userId: string | null;
  }): Promise<CodingAgentTranscript> {
    const protections = await this.resolveApiKeyProtections(input);
    const trace = await this.#getTraceByIdOrPrefix({ ...input, protections });

    return this.#readTranscriptWithProtections({
      projectId: input.projectId,
      traceId: trace.trace_id,
      occurredAtMs: trace.timestamps.started_at,
      protections,
    });
  }

  async #getTraceByIdOrPrefix(input: {
    projectId: string;
    traceId: string;
    protections: Protections;
  }): Promise<Trace> {
    let trace: Trace | undefined;
    try {
      trace = await this.findTrace(input);
    } catch (err) {
      if (err instanceof AmbiguousTraceIdPrefixError) {
        throw new TraceIdAmbiguousError(input.traceId, err.candidateTraceIds);
      }
      throw err;
    }
    if (!trace) throw new TraceNotFoundError(input.traceId);
    return trace;
  }

  #readTranscriptWithProtections(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number | undefined;
    protections: Protections;
  }): Promise<CodingAgentTranscript> {
    const { protections } = input;
    return this.#transcriptRead.readCodingAgentTranscript({
      app: this,
      ports: {
        getVisibilityWindow: async () => ({
          visibilityCutoffMs: protections.visibilityCutoffMs ?? null,
        }),
        mappers: traceReadMapperPorts,
        derivedAttrPrefixes: traceDerivedAttrPrefixes,
      },
      projectId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
      protections,
    });
  }

  /** One export's progress frames, ending at `done` or `error` (main's `export` router). */
  streamExportProgress(input: {
    projectId: string;
    exportId: string;
    signal?: AbortSignal | undefined;
  }): AsyncGenerator<ExportProgressEvent> {
    return this.#exportProgress.stream(input);
  }

  // -------------------------------------------------------------------------
  // The anonymous share read
  // -------------------------------------------------------------------------

  /**
   * Redeems a share token for one viewer. Every resolve consumes one view and
   * enforces expiry, view cap, audience and the sharing kill switch.
   */
  resolveShareForViewer(input: {
    token: string;
    viewer: ShareViewer;
    viewerKey?: string;
  }): Promise<ResolvedShare> {
    return this.#dependencies.share.resolveForViewer(input);
  }

  /** The cached share payload for this token AND these redactions, if any. */
  readCachedSharePayload(input: { token: string; protections: Protections }): Promise<unknown> {
    return this.#dependencies.share.findCachedPayload(input);
  }

  /** Caches the share payload against this token and these redactions. */
  writeCachedSharePayload(input: {
    token: string;
    protections: Protections;
    payload: SharedTraceDto;
  }): Promise<void> {
    return this.#dependencies.share.cachePayload(input);
  }

  getSharedTrace(input: {
    token: string;
    viewerUserId: string | null;
    clientIp: string | null;
    userAgent: string | null;
  }): Promise<SharedTraceDto> {
    if (!this.#sharedRead) {
      throw new Error(
        "The public share read was asked for, and this process composed Trace without protections or a rate limiter",
      );
    }

    return this.#sharedRead.getSharedTrace(input);
  }

  /** The project card the share page prints above the trace. */
  findProject(projectId: string): Promise<{
    name: string | null;
    slug: string | null;
    language: string | null;
    framework: string | null;
  } | null> {
    return this.#dependencies.projects.findById(projectId);
  }

  // -- the platform's own links ------------------------------------------

  /**
   * The platform's own address for one trace resource. A deployment that
   * serves these families but named no public origin refuses by name.
   */
  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#dependencies.publicBaseUrl === undefined) {
      throw new Error(
        "The traces REST family was asked for a platform link, but this deployment named no public base URL",
      );
    }

    return tracePlatformUrl({ publicBaseUrl: this.#dependencies.publicBaseUrl, ...input });
  }

  // -- the deprecated /api/trace family's own members ----------------------
  // `transport/trace-legacy.rest.ts` reads this application through an
  // operations-only proxy — every member below is a METHOD because a
  // property member throws where the proxy reads it.

  /**
   * The project credential that family resolves for itself. Raises rather
   * than refusing when the door was never composed: a mis-wired process
   * should not hide that behind a caller-facing 401.
   */
  credential(input: {
    request: Request;
    permission: "traces:view" | "traces:share";
  }): Promise<TraceLegacyCredential> {
    if (!this.#dependencies.legacyCredential) {
      throw new Error(
        "The deprecated trace family asked for a credential, and this process composed Trace without the API-key directory it resolves through",
      );
    }

    return this.#dependencies.legacyCredential.resolve(input);
  }

  /** The four reads those addresses answer from: the application itself. */
  traces(): TraceLegacyReads {
    return this;
  }

  /** The public-link ledger its share pair writes to. */
  shares(): TraceLegacyShare {
    return this.#dependencies.share;
  }

  /**
   * The API KEY caller's read-time redactions for one project - the same
   * resolution the v1 family uses, so the two answer one caller alike.
   */
  getProtections(
    input: Readonly<{ projectId: string; credential: RestCredentialPrincipal }>,
  ): Promise<Protections> {
    const { credential } = input;
    const scoped = credential.kind === "legacyProjectKey" ? null : credential;

    return this.resolveApiKeyProtections({
      projectId: input.projectId,
      apiKeyId: scoped?.apiKeyId ?? null,
      userId: scoped?.userId ?? null,
    });
  }

  /** The body `POST /api/trace/search` accepts, parsed strictly. */
  searchBodySchema(): z.ZodType<TraceLegacySearchFields, unknown> {
    return traceLegacySearchBodySchema;
  }

  /** Renders a schema failure as the one sentence that family answers with. */
  describeValidationError(error: unknown): string {
    return describeTraceLegacyValidationError(error);
  }

  // -- the SDK collector's own members --------------------------------------
  // `transport/collector.rest.ts` reads this application through the same
  // operations-only proxy — every member below is a METHOD for that reason.

  /**
   * The project credential that door resolves for itself. Raises rather
   * than refusing when uncomposed: hiding a mis-wired process behind a
   * customer's SDK 401 sends them off rotating a credential that's fine.
   */
  collectorCredential(input: { request: Request }): Promise<CollectorCredential> {
    if (!this.#dependencies.ingestCredential) {
      throw new Error(
        "The collector asked for a credential, and this process composed Trace without the API-key directory it resolves through",
      );
    }

    return this.#dependencies.ingestCredential.resolveForCollector(input);
  }

  /**
   * The plan's monthly allowance. Accepts every batch — no module contract
   * yet publishes a usage meter, so this deployment enforces none here. A
   * member rather than an absence because the door reads it by name.
   */
  collectorUsageLimit(_input: { project: CollectorProject }): Promise<void> {
    return Promise.resolve();
  }

  /** Where one already-normalized span goes: the receiver both doors share. */
  ingestSpan(input: Parameters<CollectorSpanIngest>[0]): ReturnType<CollectorSpanIngest> {
    const ingestion = this.#dependencies.ingestion;
    if (!ingestion) {
      throw new TraceIngestionUnavailableError();
    }

    return ingestion.ingestNormalizedSpan(input);
  }

  /**
   * One custom SDK evaluation, on the command the workbench's re-scores
   * also travel. Parsed against its schema rather than cast, so a
   * differently-spelled field is rejected here, not malformed downstream.
   */
  reportEvaluation(
    input: Parameters<CollectorEvaluationReport>[0],
  ): ReturnType<CollectorEvaluationReport> {
    return this.#dependencies.evaluations.reportEvaluation(
      reportEvaluationCommandDataSchema.parse(input),
    );
  }

  /** The evaluator-id slug rule, as EVALUATION's own module spells it. */
  deriveEvaluatorId(name: string): string {
    return this.#dependencies.evaluations.deriveEvaluatorId(name);
  }

  /** A failure the door answered but did not raise, kept off the customer's body. */
  collectorReportError(error: Error, context: Readonly<{ projectId: string }>): void {
    logger.error({ error, projectId: context.projectId }, "the collector answered a failure");
  }

  // -- the tracked-event family's own members --------------------------------
  // `transport/tracked-event.rest.ts` reads this application through the same
  // operations-only proxy - every member below is a METHOD for that reason.

  /**
   * Refuses a payload whose `event_type` is one of the predefined kinds but
   * whose body does not match that kind's schema. A custom event type is left
   * alone: it has already satisfied the base schema and owns no second one.
   */
  assertPredefinedEventPayload(rawBody: Record<string, unknown>): void {
    const eventType = rawBody.event_type;
    if (typeof eventType !== "string") return;
    if (!predefinedEventTypes.some((predefined) => predefined === eventType)) return;
    predefinedEventsSchemas.parse(rawBody);
  }

  /** A fresh tracked-event id, for a caller that did not send one. */
  generateEventId(): string {
    return generate(TRACKED_EVENT_KSUID_RESOURCE).toString();
  }

  /** A rejected payload, kept in the log rather than in the customer's body. */
  reportError(error: unknown): void {
    logger.error({ error }, "the tracked-event route rejected a payload");
  }

  /**
   * Dispatches the event's synthetic span through the same ingress command the
   * collector uses, so a tracked event lands on its trace by exactly the route
   * a span does. Refuses by name when the process registered no recorder.
   */
  async recordTrackedEvent(
    input: Readonly<{
      project: Readonly<{ id: string }>;
      body: TrackEventRESTParamsValidator;
      eventId: string;
    }>,
  ): Promise<void> {
    const ingest = this.#dependencies.spanIngest;
    if (!ingest) {
      throw new TraceIngestionUnavailableError();
    }
    const occurredAtMs = input.body.timestamp ?? nowInstant().epochMilliseconds;
    await ingest.recordSpan({
      tenantId: input.project.id,
      span: buildTrackedEventSpan({
        body: input.body,
        eventId: input.eventId,
        occurredAtMs,
      }),
      resource: null,
      instrumentationScope: { name: TRACK_EVENT_SPAN_NAME },
      piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
      occurredAt: occurredAtMs,
    });
  }

  // -- the OTLP receiver's own members ---------------------------------------
  // `transport/otlp-ingest.rest.ts` reads this application through the same
  // operations-only proxy; all six members are required and each is a METHOD
  // for the same reason.

  /**
   * The project credential the receiver resolves for itself — same
   * raise-rather-than-refuse reasoning as {@link collectorCredential}.
   */
  otlpCredential(input: OtlpIngestCredentialInput): Promise<OtlpIngestCredential> {
    if (!this.#dependencies.ingestCredential) {
      throw new Error(
        "The OTLP receiver asked for a credential, and this process composed Trace without the API-key directory it resolves through",
      );
    }

    return this.#dependencies.ingestCredential.resolveForOtlp(input);
  }

  otlpMarkCredentialUsed(input: { apiKeyId: string }): void {
    if (!this.#dependencies.ingestCredential) {
      throw new Error(
        "The OTLP receiver asked to record credential usage, and this process composed Trace without the API-key directory it resolves through",
      );
    }

    this.#dependencies.ingestCredential.markOtlpCredentialUsed(input);
  }

  /**
   * The plan's monthly allowance — unenforced here, same gap as
   * {@link collectorUsageLimit}. Must close at both doors together, or
   * one becomes the way around the other.
   */
  otlpUsageLimit(_input: {
    project: OtlpIngestProject;
    customerTraceIds: string[];
  }): Promise<void> {
    return Promise.resolve();
  }

  /** The trace signal: the same receiver `POST /api/collector` writes through. */
  otlpTraces(
    input: Parameters<TraceOtlpIngestApi["otlpTraces"]>[0],
  ): Promise<OtlpTraceCollectionResult> {
    const ingestion = this.#dependencies.ingestion;
    if (!ingestion) {
      throw new TraceIngestionUnavailableError();
    }

    return ingestion
      .handleOtlpTraceRequest(input.tenantId, input.traceRequest, DEFAULT_PII_REDACTION_LEVEL)
      .then((result) => result ?? {});
  }

  /**
   * The log signal: every deployment today answers `not-served` — the Log
   * module owns the collection and this module may not import it. Said in
   * the answer, not thrown, so exporters don't retry forever.
   */
  otlpLogs(
    input: Parameters<TraceOtlpIngestApi["otlpLogs"]>[0],
  ): Promise<OtlpLogCollectionOutcome> {
    const collection = this.#dependencies.logCollection;
    if (!collection) {
      return Promise.resolve({
        outcome: "not-served",
        errorMessage: "This deployment does not receive OpenTelemetry logs",
      });
    }

    return collection(input);
  }

  /** The metric signal, absent for the reason {@link otlpLogs} gives. */
  otlpMetrics(
    input: Parameters<TraceOtlpIngestApi["otlpMetrics"]>[0],
  ): Promise<OtlpMetricCollectionOutcome> {
    const collection = this.#dependencies.metricCollection;
    if (!collection) {
      return Promise.resolve({
        outcome: "not-served",
        errorMessage: "This deployment does not receive OpenTelemetry metrics",
      });
    }

    return collection(input);
  }

  /** A failure the receiver answered but did not raise. */
  otlpReportError(
    error: Error,
    context: Readonly<{ projectId: string; customerTraceIds: string[] }>,
  ): void {
    logger.error(
      { error, projectId: context.projectId, customerTraceIds: context.customerTraceIds },
      "the OTLP receiver answered a failure",
    );
  }
}
