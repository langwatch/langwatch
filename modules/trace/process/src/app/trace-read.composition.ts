import type { ClickHouseClient } from "@clickhouse/client";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import type { LogApi } from "@langwatch/log-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import {
  type RecordSpanCommandData,
  traceRecordValueSchema,
  traceRecordSchema,
  TraceNotFoundError,
  type NormalizedSpan,
  type TraceSummaryData,
  type TraceCanonicalisationService,
} from "@langwatch/trace-contract";

import { type TraceAppDependencies } from "../app/trace.app.ts";
import { TraceLegacyReadClickHouseRepository } from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import type * as traceLegacyReadRepositoryModule from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import {
  TraceQueryFieldValuesRepository,
  type TraceQueryFieldValuesInput,
  type TraceQueryFieldValuesResult,
} from "../repositories/query-field-values.repository.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import { type TraceBlobStoreService } from "../services/trace-blob-store.service.ts";
import { TraceEditOverlayService } from "../services/trace-edit-overlay.service.ts";
import { TraceEventDerivationService } from "../services/trace-event-derivation.service.ts";
import { TraceIngestCredentialService } from "../services/trace-ingest-credential.service.ts";
import {
  TraceIngestionService,
  TraceIngressCommand,
  type CodingAgentIngestFilter,
  type TraceSpanDedup,
} from "../services/trace-ingestion.service.ts";
import { TraceIOExtractionService } from "../services/trace-io-extraction.service.ts";
import { TraceLegacyCredentialService } from "../services/trace-legacy-credential.service.ts";
import { TraceLegacyReadService } from "../services/trace-legacy-read.service.ts";
import { TraceListService } from "../services/trace-list-read.service.ts";
import { LogRecordStorageService } from "../services/trace-log-record-read.service.ts";
import { TraceProcessingSpanIngestAdapter } from "../services/trace-processing-span-ingest.service.ts";
import { TraceQueryClassificationAdapter } from "../services/trace-query-classification.service.ts";
import { SessionGroupsService } from "../services/trace-session-groups.service.ts";
import { SpanStorageService } from "../services/trace-span-storage-read.service.ts";
import { TraceSummaryService } from "../services/trace-summary-read.service.ts";
import {
  TraceViewerProtectionService,
  type TraceViewerProtectionOptions,
} from "../services/trace-viewer-protection.service.ts";
import { TraceViewerReadService } from "../services/trace-viewer.service.ts";
import type { TraceService as TraceTreeService } from "../services/trace.service.ts";
import { traceRefusalProxy } from "./trace-composition.build.ts";
import { TraceTreeComposition } from "./trace-tree.composition.ts";
import { type TraceFullIo, type TraceProcessingCommands } from "./trace.members.ts";

export type TraceReaderCompositionOptions = {
  /** The rows the registry chose for this process, one tier over both stores. */
  repositories: TraceRepositories;
  /** Absent on a process that composed no ClickHouse: every read refuses by name. */
  resolveClickHouseClient?: ((tenantId: string) => Promise<ClickHouseClient>) | undefined;
  defaultRetentionDays?: number | undefined;
  canonicalisation: TraceCanonicalisationService;
  blobStore: TraceBlobStoreService;
  /** Absent when no trace projections are folded; summary read has no fold to query. */
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
  dedup: TraceSpanDedup;
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
  /** Analytics's filter translator; absent, a FILTERED legacy list refuses. */
  filterConditions?: traceLegacyReadRepositoryModule.TraceLegacyFilterConditions | undefined;
  evaluations: TraceAppDependencies["evaluations"];
  /** The Instant Eval peer the Explorer's judged searches run through. */
  instantEvals?: TraceAppDependencies["instantEvals"];
  codingAgents: TraceAppDependencies["codingAgents"];
  storedObjects: TraceAppDependencies["storedObjects"];
  presence?: TraceAppDependencies["presence"];
  share: TraceAppDependencies["share"];
  broadcast: TraceAppDependencies["broadcast"];
  commands: TraceProcessingCommands;
  /**
   * The tier-effective request bounds the read graph clamps and refuses by.
   * The entitlement peer resolves the caller's plan; the transport schemas
   * only carry the registry's enterprise ceiling.
   */
  requestBounds: TraceAppDependencies["requestBounds"];
  /** The export door's rate window and in-flight slots, built by the app from process members. */
  exportBounds: TraceAppDependencies["exportBounds"];
  /** The deployment's public origin, for `platformUrl`. Optional: not every install serves REST. */
  publicBaseUrl?: string;
};

/** Constructs one Trace read graph from process storage and complete feature peers. */
export function composeTraceAppDependencies(
  options: TraceReaderCompositionOptions,
): TraceAppDependencies {
  const resolve = options.resolveClickHouseClient;
  const ioExtractionService = TraceIOExtractionService.create(options.canonicalisation);
  const blobResolutionDeps = { blobStore: options.blobStore, ioExtractionService };
  const spanStorageRepository = options.repositories.spanStorage;
  const editOverlay = TraceEditOverlayService.create(options.repositories.editOverlay);
  const logRecords = LogRecordStorageService.create({
    repository: options.repositories.logRecords,
    canonical: options.logs,
  });
  const read = TraceLegacyReadService.create({
    traceCanonicalisation: options.canonicalisation,
    traceRead: TraceLegacyReadClickHouseRepository.create({
      traceCanonicalisation: options.canonicalisation,
      ...(resolve ? { resolveClickHouseClient: resolve } : {}),
      ...(options.filterConditions ? { filterConditions: options.filterConditions } : {}),
      retentionResolver: options.dataRetention,
      annotationService: options.annotations,
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
  });
  const protections = TraceViewerProtectionService.create(options.protections);
  const summaryStore = options.summaryStore;
  const tree = !resolve
    ? traceRefusalProxy<TraceTreeService>(options.protections.processName, "the trace tree read")
    : TraceTreeComposition.create({
        resolveClient: resolve,
        modelProviders: options.modelProviders,
        queryFieldValues: TraceReadQueryFieldValues.create(list),
        queryClassification: TraceQueryClassificationAdapter.create(),
        // A process that folds no trace projections has no fold to ask, so the
        // reader is left out rather than answering an empty summary.
        ...(summaryStore
          ? {
              summaryReader: {
                findSummary: ({ tenantId, traceId }: { tenantId: string; traceId: string }) =>
                  summaryStore.tryGet(traceId, {
                    aggregateId: traceId,
                    tenantId: createTenantId(tenantId),
                  }),
              },
            }
          : {}),
        records: {
          getById: async ({ projectId, traceId }) => {
            const resolved = await protections.resolve({
              projectId,
              userId: void 0,
              publiclyShared: false,
            });
            const trace = await read.findById(
              projectId,
              traceId,
              { ...resolved, canSeeCosts: true },
              { full: true },
            );
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
    spanIngest: TraceProcessingSpanIngestAdapter.create(options.commands),
    // The receiver the two ingestion doors share. ONE dedup claim and ONE
    // command sender across both, so a span posted to `/api/collector` and the
    // same span exported over OTLP are one record, not two.
    ingestion: TraceIngestionService.create({
      codingAgents: options.ingestCodingAgents ?? options.codingAgents,
      codingAgentSpanFilterEnabled: CODING_AGENT_SPAN_FILTER_ENABLED,
      dedup: options.dedup,
      commands: TraceComposedIngressCommand.create(options.commands),
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
    ...(options.apiKeys
      ? {
          legacyCredential: TraceLegacyCredentialService.create({
            apiKeys: options.apiKeys,
            authz: options.protections.authz,
          }),
          ingestCredential: TraceIngestCredentialService.create({
            apiKeys: options.apiKeys,
            authz: options.ingestAuthz ?? options.protections.authz,
          }),
        }
      : {}),
    publicBaseUrl: options.publicBaseUrl,
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

  recompute(spans: NormalizedSpan[]) {
    const input = this.#extraction.extractFirstInput(spans);
    const output = this.#extraction.extractLastOutput(spans);
    return {
      input: input ? { type: "json", value: traceRecordValueSchema.parse(input.raw) } : null,
      output: output ? { type: "json", value: traceRecordValueSchema.parse(output.raw) } : null,
    };
  }
}
