import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { type FoldProjectionStore, createTenantId } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { LogApi } from "@langwatch/log-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import {
  TraceCapabilityUnavailableError,
  type TraceSummaryData,
  type RecordSpanCommandData,
  traceRecordValueSchema,
  traceRecordSchema,
  TraceNotFoundError,
  type NormalizedSpan,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
} from "@langwatch/trace-contract";

import { traceLegacySpoolChannels } from "../channels/trace-legacy-spool-channels.registry.ts";
import { TraceSummaryStore } from "../eventing/trace-summary.store.ts";
import { EventingTraceTopicAssignment } from "../eventing/trace-topic-assignment.commands.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import {
  TraceClickHouse,
  type TraceClickHouseClient,
  type TraceClickHouseResolver,
} from "../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { ClickHouseTraceFullRecordRepository } from "../repositories/clickhouse/trace-full-record.repository.ts";
import {
  TraceLegacyReadClickHouseRepository,
  type ClickHouseTraceLegacyReadOptions,
} from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import { ClickHouseTraceSpanRepository } from "../repositories/clickhouse/trace-span.repository.ts";
import {
  TraceQueryFieldValuesRepository,
  type TraceQueryFieldValuesInput,
  type TraceQueryFieldValuesResult,
} from "../repositories/query-field-values.repository.ts";
import type { TracePayloadReaderRepository } from "../repositories/trace-payload-reader.repository.ts";
import { TraceRecordRepository } from "../repositories/trace-record.repository.ts";
import type { TraceSpanDedupRepository } from "../repositories/trace-span-dedup.repository.ts";
import { TraceSummaryReaderRepository } from "../repositories/trace-summary-reader.repository.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import { ScenarioRoleMetricsDerivationService } from "../services/scenario-role-metrics-derivation.service.ts";
import { SpanCostService } from "../services/span-cost.service.ts";
import { TraceBlobStoreService } from "../services/trace-blob-store.service.ts";
import { TraceCanonicalisationService } from "../services/trace-canonicalisation.service.ts";
import { TraceEdgeMediaPayloadService } from "../services/trace-edge-media-payload.service.ts";
import { TraceEdgeMediaTelemetryService } from "../services/trace-edge-media-telemetry.service.ts";
import { TraceEdgeSpoolService } from "../services/trace-edge-spool.service.ts";
import { TraceEditOverlayService } from "../services/trace-edit-overlay.service.ts";
import { TraceEventDerivationService } from "../services/trace-event-derivation.service.ts";
import { TraceIngestCredentialService } from "../services/trace-ingest-credential.service.ts";
import {
  TraceIngestionService,
  TraceIngressCommand,
  type CodingAgentIngestFilter,
} from "../services/trace-ingestion.service.ts";
import { TraceIOExtractionService } from "../services/trace-io-extraction.service.ts";
import {
  TraceLegacyReadService,
  type BlobResolutionDeps,
} from "../services/trace-legacy-read.service.ts";
import { TraceListService } from "../services/trace-list-read.service.ts";
import { LogRecordStorageService } from "../services/trace-log-record-read.service.ts";
import { TraceModelCostService } from "../services/trace-model-cost.service.ts";
import { TraceOffloadResolutionBatchService } from "../services/trace-offload-resolution-batch.service.ts";
import { TraceOffloadResolutionService } from "../services/trace-offload-resolution.service.ts";
import { TraceQueryClassificationService } from "../services/trace-query-classification.service.ts";
import { TraceRetentionFloorService } from "../services/trace-retention-floor.service.ts";
import { SessionGroupsService } from "../services/trace-session-groups.service.ts";
import { SpanStorageService } from "../services/trace-span-storage-read.service.ts";
import { TraceStoredMediaStoreService } from "../services/trace-stored-media-store.service.ts";
import { TraceSummaryService } from "../services/trace-summary-read.service.ts";
import { TraceTopicClusteringReadService } from "../services/trace-topic-clustering-read.service.ts";
import {
  TraceViewerProtectionService,
  type TraceViewerProtectionOptions,
} from "../services/trace-viewer-protection.service.ts";
import { TraceViewerReadService } from "../services/trace-viewer.service.ts";
import { TraceService } from "../services/trace.service.ts";
import type { TraceAppDependencies } from "./trace.app.ts";
import type {
  TraceProcessingCommands,
  TraceFullIo,
  TraceFullIoRecord,
  TraceQueryClassifier,
  TraceEventDerivation,
} from "./trace.members.ts";

/**
 * Trace's own collaborators, built from its registry and config; pipeline-owned features
 * (folds, rename, spool) refuse by name when absent.
 */

/**
 * The collaborators one process composes Trace's read graph over. Every
 * optional field is one the producer role does not compose; each has a named
 * refusal rather than a silent empty answer.
 */
type TraceCollaborators = Readonly<{
  resolveClickHouseClient?: TraceClickHouseResolver;
  canonicalisation: TraceCanonicalisationService;
  blobStore: TraceBlobStoreService;
  summaryStore?: FoldProjectionStore<TraceSummaryData>;
  commands: TraceProcessingCommands;
  fallbackVisibilityDays: number;
  publicBaseUrl?: string;
  /** The ingestion doors' duplicate claim, so an SDK's retry is not a second span. */
  dedup: TraceSpanDedupRepository;
}>;

/** The config slice the deployment states for this module, and the role it runs in. */
type TraceBuildConfig = Readonly<{
  role: string;
  fallbackVisibilityDays: number;
  publicBaseUrl?: string | undefined;
}>;

/** Builds this process's Trace collaborators from its registry's clients and its config. */
export function buildTraceCollaborators(input: {
  resolveClickHouseClient: TraceClickHouseResolver;
  config: TraceBuildConfig;
  dedup: TraceSpanDedupRepository;
  /** trace_processing's senders, bound when the process connects the pipeline. */
  commands: TraceProcessingCommands;
}): TraceCollaborators {
  const { resolveClickHouseClient, config } = input;
  const refuse = refusalFactory(config.role);

  return {
    resolveClickHouseClient,
    canonicalisation: TraceCanonicalisationService.create(),
    blobStore: TraceBlobStoreService.create({
      // The v1 spool predates this deployment: a ref written before the
      // stored-object registry existed reads back through S3 directly, and
      // this process composes no such client. `resolveOffloadedTraces`
      // swallows the refusal per field, so such a value keeps its preview
      // rather than failing the whole read.
      legacySpool: traceLegacySpoolChannels.live.create({
        resolveS3Client: () => Promise.reject(refuse("a v1 spool object read")),
      }),
      resolveClickHouseClient,
      logger: createLogger("langwatch:trace:blob-store"),
    }),
    commands: input.commands,
    dedup: input.dedup,
    fallbackVisibilityDays: config.fallbackVisibilityDays,
    ...(config.publicBaseUrl === undefined ? {} : { publicBaseUrl: config.publicBaseUrl }),
  };
}

function refusalFactory(role: string): (capability: string) => TraceCapabilityUnavailableError {
  return (capability: string) => new TraceCapabilityUnavailableError(role, capability);
}

type TraceReaderCompositionOptions = {
  /** The rows the registry chose for this process, one tier over both stores. */
  repositories: TraceRepositories;
  /** Absent on a process that composed no ClickHouse: every read refuses by name. */
  resolveClickHouseClient?: TraceClickHouseResolver | undefined;
  defaultRetentionDays?: number | undefined;
  canonicalisation: TraceCanonicalisationService;
  blobStore: TraceBlobStoreService;
  /** A test's summary store; absent, the summary is read off the trace_summaries row. */
  summaryStore?: FoldProjectionStore<TraceSummaryData> | undefined;
  projects: ProjectApi;
  topics: TopicApi;
  modelProviders: ModelProviderApi;
  logs: LogApi;
  annotations: AnnotationApi;
  dataRetention: DataRetentionApi;
  protections: TraceViewerProtectionOptions;
  /**
   * The API-key directory the deprecated `/api/trace/*` family's own door
   * resolves a project credential through. Absent, that family's five
   * addresses raise by name rather than admitting an unauthenticated caller.
   */
  apiKeys?: Pick<ApiKeyApi, "findResolvedToken" | "markUsed"> | undefined;
  /**
   * The ingestion doors' duplicate claim. Required: the doors are mounted on
   * every process that composes Trace's REST surface, and a claim that is
   * absent rather than null would be an ingest path deciding silently.
   */
  dedup: TraceSpanDedupRepository;
  /**
   * The ceiling the INGESTION doors ask about, where it is not the viewer
   * protections' own. Narrow because one question is all they ask: whether this
   * key may create traces in its project.
   */
  ingestAuthz?: Pick<AuthzApi, "hasApiKeyPermission"> | undefined;
  /**
   * The one question the INGEST path asks Coding Agent: whether a span is
   * one a coding agent emits about itself, which the receiver drops. Narrow
   * and separate from the whole `codingAgents` peer below.
   */
  ingestCodingAgents?: CodingAgentIngestFilter | undefined;
  evaluations: TraceAppDependencies["evaluations"];
  /** The Instant Eval peer the Explorer's judged searches run through. */
  instantEvals?: TraceAppDependencies["instantEvals"];
  codingAgents: TraceAppDependencies["codingAgents"];
  storedObjects: TraceAppDependencies["storedObjects"];
  /**
   * Gates the edge media hook (`release_trace_media_extraction`). Absent, the
   * ingestion doors externalise nothing, as with the flag off.
   */
  featureFlags?: FeatureFlagApi | undefined;
  presence?: TraceAppDependencies["presence"];
  share: TraceAppDependencies["share"];
  broadcast: TraceAppDependencies["broadcast"];
  /** Where a finished background discover refresh tells the tenant's tabs to refetch. */
  tenantBroadcast: Pick<PresenceApi, "publishProjectEvent">;
  commands: TraceProcessingCommands;
  /**
   * The tier-effective request bounds the read graph clamps and refuses by.
   * The entitlement peer resolves the caller's plan; the transport schemas
   * only carry the registry's enterprise ceiling.
   */
  requestBounds: TraceAppDependencies["requestBounds"];
  /** The export door's rate window and in-flight slots, built by the app from its registry. */
  exportBounds: TraceAppDependencies["exportBounds"];
  shareReadLimiter?: TraceAppDependencies["shareReadLimiter"];
  /** The deployment's public origin, for `platformUrl`. Optional: not every install serves REST. */
  publicBaseUrl?: string;
};

/** What a composition root gives the legacy trace read: the store, and the policies over it. */
export type TraceLegacyReadCompositionOptions = Omit<
  ClickHouseTraceLegacyReadOptions,
  "retentionDays"
> & {
  /** Restores offloaded spans from the blob store (ADR-022) where no resolver is supplied. */
  blobResolutionDeps?: BlobResolutionDeps | undefined;
  /** The tenant's retention policy; absent, the span read floors at the platform default. */
  retentionResolver?: DataRetentionApi | undefined;
};

/** The legacy trace read over ClickHouse, with its offload resolution and retention floor. */
export function composeTraceLegacyRead(
  options: TraceLegacyReadCompositionOptions,
): TraceLegacyReadClickHouseRepository {
  const { blobResolutionDeps, retentionResolver, ...read } = options;

  return TraceLegacyReadClickHouseRepository.create({
    ...read,
    ...(retentionResolver
      ? { retentionDays: TraceRetentionFloorService.create(retentionResolver) }
      : {}),
    resolveTraceSpans:
      read.resolveTraceSpans ??
      (blobResolutionDeps
        ? TraceOffloadResolutionService.create().resolverFor(blobResolutionDeps)
        : undefined),
    resolveTraceSpansBatch:
      read.resolveTraceSpansBatch ??
      (blobResolutionDeps
        ? TraceOffloadResolutionBatchService.create().resolverFor(blobResolutionDeps)
        : undefined),
  });
}

/** Constructs one Trace read graph from process storage and complete feature peers. */
export function composeTraceAppDependencies(
  options: TraceReaderCompositionOptions,
): TraceAppDependencies {
  const resolve = options.resolveClickHouseClient;
  const ioExtractionService = TraceIOExtractionService.create(options.canonicalisation);
  const blobResolutionDeps = { blobStore: options.blobStore, ioExtractionService };
  const spanStorageRepository = options.repositories.spanStorage;
  const editOverlay = TraceEditOverlayService.create(options.repositories.editOverlay);
  // ADR-022: media extraction first, then the whole-payload spool over 256 KB, as main ordered.
  const edgeSpool = TraceEdgeSpoolService.create({
    spool: options.blobStore,
    logger: createLogger("langwatch:traces:edge-spool"),
    featureFlags: options.featureFlags,
  });
  const payloads = options.featureFlags
    ? TraceEdgeMediaPayloadService.create({
        deps: {
          featureFlags: options.featureFlags,
          hasContentDropRules: (projectId) =>
            options.protections.dataPrivacy.dropsAnyContent({ projectId }),
          telemetry: TraceEdgeMediaTelemetryService.create(),
          service: TraceStoredMediaStoreService.create(options.storedObjects),
        },
        logger: createLogger("langwatch:traces:edge-media-extraction"),
        next: edgeSpool,
      })
    : edgeSpool;
  const logRecords = LogRecordStorageService.create({
    repository: options.repositories.logRecords,
    canonical: options.logs,
  });
  const read = TraceLegacyReadService.create({
    traceCanonicalisation: options.canonicalisation,
    traceRead: composeTraceLegacyRead({
      traceCanonicalisation: options.canonicalisation,
      ...(resolve ? { resolveClickHouseClient: resolve } : {}),
      retentionResolver: options.dataRetention,
      annotations: options.annotations,
      blobResolutionDeps,
    }),
    editOverlay,
    logRecordStorage: logRecords,
    evaluationService: options.evaluations,
  });
  const list = TraceListService.create({
    repository: options.repositories.list,
    evaluations: options.evaluations,
    topicService: options.topics,
    facets: CLICKHOUSE_FACET_CATALOG,
    discoverUpdates: options.tenantBroadcast,
  });
  const protections = TraceViewerProtectionService.create(options.protections);
  // Every role reads the summary off the trace_summaries row the worker's fold writes, as main's
  // traceSummaryStore did; a test may hand in its own store.
  const summaryStore =
    options.summaryStore ??
    TraceSummaryStore.create({
      storage: options.repositories.summaryProjection,
      defaultRetentionDays: () => options.dataRetention.getPlatformDefaultRetentionDays(),
    });
  const tree = !resolve
    ? undefined
    : TraceTreeComposition.create({
        resolveClient: resolve,
        modelProviders: options.modelProviders,
        queryFieldValues: TraceReadQueryFieldValues.create(list),
        queryClassification: TraceQueryClassificationService.create(),
        summaryReader: FoldedTraceSummaryReader.create(summaryStore),
        records: {
          getById: async ({ projectId, traceId }) => {
            const resolved = await protections.resolve({
              projectId,
              userId: void 0,
              publiclyShared: false,
            });
            const trace = await read.findById({
              projectId,
              traceId,
              protections: { ...resolved, canSeeCosts: true },
              opts: { full: true },
            });
            if (!trace) {
              throw new TraceNotFoundError(traceId);
            }
            return traceRecordSchema.parse(trace);
          },
        },
        eventDerivation: TraceEventDerivationService.create({
          spans: options.repositories.derivationSpans,
        }),
        payloads: options.repositories.eventPayloads,
        fullIo: TraceReadFullIo.create(ioExtractionService),
      }).build();

  return {
    traces: {
      existence: options.repositories.existence,
      read,
      list,
      sessionGroups: SessionGroupsService.create({
        repository: options.repositories.sessionGroups,
        codingAgentSessions: options.codingAgents,
        resolveOrganizationId: (projectId) => options.projects.getOrganizationId(projectId),
      }),
      spans: SpanStorageService.create({ repository: spanStorageRepository, blobResolutionDeps }),
      summary: TraceSummaryService.create({
        repository: options.repositories.summary,
        fullResolutionDeps: { spanStorageRepository, ...blobResolutionDeps },
      }),
      tree,
      logRecords,
      canonicalisation: options.canonicalisation,
      editOverlay,
      changeTraceName: (data) => options.commands.changeTraceName(data),
    },
    spanIngest: options.commands,
    // The receiver the two ingestion doors share. ONE dedup claim and ONE
    // command sender across both, so a span posted to `/api/collector` and the
    // same span exported over OTLP are one record, not two.
    ingestion: TraceIngestionService.create({
      codingAgents: options.ingestCodingAgents ?? options.codingAgents,
      codingAgentSpanFilterEnabled: CODING_AGENT_SPAN_FILTER_ENABLED,
      dedup: options.dedup,
      commands: TraceComposedIngressCommand.create(options.commands),
      payloads,
    }),
    viewer: TraceViewerReadService.create({
      read,
      protections,
    }),
    annotationCommands: {
      add: async (input) => {
        await options.commands.addAnnotation(input);
      },
      remove: async (input) => {
        await options.commands.removeAnnotation(input);
      },
    },
    topics: options.topics,
    projects: options.projects,
    evaluations: options.evaluations,
    ...(options.instantEvals ? { instantEvals: options.instantEvals } : {}),
    codingAgents: options.codingAgents,
    storedObjects: options.storedObjects,
    ...(options.presence ? { presence: options.presence } : {}),
    share: options.share,
    broadcast: options.broadcast,
    protections,
    requestBounds: options.requestBounds,
    exportBounds: options.exportBounds,
    shareReadLimiter: options.shareReadLimiter,
    ...(options.apiKeys
      ? {
          ingestCredential: TraceIngestCredentialService.create({
            apiKeys: options.apiKeys,
            authz: options.ingestAuthz ?? options.protections.authz,
          }),
        }
      : {}),
    publicBaseUrl: options.publicBaseUrl,
    scenarioRoleMetrics: ScenarioRoleMetricsDerivationService.create({
      spans: options.repositories.derivationSpans,
      spanCosts: SpanCostService.create({ modelCosts: TraceModelCostService.create() }),
    }),
    topicClustering: TraceTopicClusteringReadService.create({
      repository: options.repositories.clusteringSample,
    }),
    topicAssignment: EventingTraceTopicAssignment.create({
      sendAssignTopic: async (input) => {
        await options.commands.assignTopic(input);
      },
    }),
  };
}

/**
 * The coding-agent span filter is on by default, exactly as the retired
 * platform application had it: its kill switch was an environment variable read
 * at that process's boot, and no process carries one now.
 */
const CODING_AGENT_SPAN_FILTER_ENABLED = true;

/** The pipeline handoff, as the receiver's own abstract command. */
class TraceComposedIngressCommand extends TraceIngressCommand {
  static create(commands: TraceProcessingCommands): TraceComposedIngressCommand {
    return new TraceComposedIngressCommand(commands);
  }

  #commands: TraceProcessingCommands;

  private constructor(commands: TraceProcessingCommands) {
    super();
    this.#commands = commands;
  }

  async recordSpan(data: RecordSpanCommandData): Promise<void> {
    await this.#commands.recordSpan(data);
  }
}

/** The trace tree's summary, read from the folded `trace_summaries` projection. */
class FoldedTraceSummaryReader extends TraceSummaryReaderRepository {
  static create(store: FoldProjectionStore<TraceSummaryData>): FoldedTraceSummaryReader {
    return new FoldedTraceSummaryReader(store);
  }

  #store: FoldProjectionStore<TraceSummaryData>;

  private constructor(store: FoldProjectionStore<TraceSummaryData>) {
    super();
    this.#store = store;
  }

  async findSummary({
    tenantId,
    traceId,
  }: {
    tenantId: string;
    traceId: string;
  }): Promise<TraceSummaryData | null> {
    const read = await this.#store.get(traceId, {
      aggregateId: traceId,
      tenantId: createTenantId(tenantId),
    });

    return read.kind === "folded" ? read.state : null;
  }
}

class TraceReadQueryFieldValues extends TraceQueryFieldValuesRepository {
  static create(listReader: TraceListService): TraceReadQueryFieldValues {
    return new TraceReadQueryFieldValues(listReader);
  }

  #listReader: TraceListService;

  private constructor(listReader: TraceListService) {
    super();
    this.#listReader = listReader;
  }

  findAll(input: TraceQueryFieldValuesInput): Promise<TraceQueryFieldValuesResult> {
    return this.#listReader.getFacetValues({
      tenantId: input.projectId,
      timeRange: input.timeRange,
      facetKey: input.facetKey,
      limit: input.limit,
      offset: input.offset,
    });
  }
}

export class TraceReadFullIo implements TraceFullIo {
  static create(extraction: TraceIOExtractionService): TraceReadFullIo {
    return new TraceReadFullIo(extraction);
  }

  #extraction: TraceIOExtractionService;

  private constructor(extraction: TraceIOExtractionService) {
    this.#extraction = extraction;
  }

  recompute(spans: NormalizedSpan[]): TraceFullIoRecord {
    const input = this.#extraction.extractFirstInput(spans);
    const output = this.#extraction.extractLastOutput(spans);
    return {
      input: input ? { type: "json", value: traceRecordValueSchema.parse(input.raw) } : null,
      output: output ? { type: "json", value: traceRecordValueSchema.parse(output.raw) } : null,
    };
  }
}

type TraceTreeCompositionOptions = {
  resolveClient: TraceClickHouseResolver;
  modelProviders: ModelProviderApi;
  queryFieldValues: TraceQueryFieldValuesRepository;
  queryClassification?: TraceQueryClassifier;
  summaryReader?: TraceSummaryReaderRepository;
  records?: TraceRecordRepository;
  eventDerivation?: TraceEventDerivation;
  payloads: TracePayloadReaderRepository;
  fullIo: TraceFullIo;
};

/** Where TraceModule builds the trace-tree read from its ClickHouse and query-value boundaries. */
export class TraceTreeComposition {
  private constructor(private readonly options: TraceTreeCompositionOptions) {}

  static create(options: TraceTreeCompositionOptions): TraceTreeComposition {
    return new TraceTreeComposition(options);
  }

  build(): TraceService {
    const clickhouse = ResolverTraceClickHouse.create(this.options.resolveClient);
    return TraceService.create({
      repository: ClickHouseTraceSpanRepository.create(clickhouse),
      modelProviders: this.options.modelProviders,
      queryFieldValues: this.options.queryFieldValues,
      queryClassification:
        this.options.queryClassification ?? NullTraceQueryClassificationAdapter.create(),
      summaryReader: this.options.summaryReader ?? new NullTraceSummaryReader(),
      records: this.options.records ?? new NullTraceRecordRepository(),
      eventDerivation: this.options.eventDerivation ?? new NullTraceEventDerivation(),
      fullRecords: ClickHouseTraceFullRecordRepository.create(
        clickhouse,
        this.options.payloads,
        this.options.fullIo,
      ),
    });
  }
}

class ResolverTraceClickHouse extends TraceClickHouse {
  private constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  static create(resolveClient: TraceClickHouseResolver): ResolverTraceClickHouse {
    return new ResolverTraceClickHouse(resolveClient);
  }

  resolve(tenantId: string): Promise<TraceClickHouseClient> {
    return this.resolveClient(tenantId);
  }
}

class NullTraceSummaryReader extends TraceSummaryReaderRepository {
  async findSummary(): Promise<null> {
    return null;
  }
}

class NullTraceRecordRepository extends TraceRecordRepository {
  async getById(input: TraceByIdInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }
}

class NullTraceEventDerivation implements TraceEventDerivation {
  async derive(_input: TraceDerivedEventsInput): Promise<[]> {
    return [];
  }
}

class NullTraceQueryClassificationAdapter implements TraceQueryClassifier {
  private constructor() {}

  static create(): NullTraceQueryClassificationAdapter {
    return new NullTraceQueryClassificationAdapter();
  }

  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}

/** The trace-tree read a composition root hands around. */
export type TraceTreeService = TraceService;
