import { TraceProcessingSpanIngestAdapter } from "../services/trace-processing-span-ingest.service.ts";
import type { ClickHouseClient } from "@clickhouse/client";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import type { LogApi } from "@langwatch/log-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import {
  traceRecordValueSchema,
  traceRecordSchema,
  TraceNotFoundError,
  type NormalizedSpan,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { TraceTreeComposition } from "./trace-tree.composition.ts";
import { TraceLegacyReadClickHouseRepository } from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import { LogRecordStorageService } from "../services/log/trace-log-record-read.service.ts";
import { SessionGroupsService } from "../services/session/trace-session-groups.service.ts";
import { SpanStorageService } from "../services/offload/trace-span-storage-read.service.ts";
import { TraceEditOverlayService } from "../services/edit-overlay/trace-edit-overlay.service.ts";
import { TraceEventDerivationService } from "../services/ingestion/trace-event-derivation.service.ts";
import { TraceFullIo } from "./trace.infrastructure.ts";
import { TraceIOExtractionService } from "../services/content/trace-io-extraction.service.ts";
import { TraceLegacyReadService as TraceLegacyReadService } from "../services/read/trace-legacy-read.service.ts";
import { TraceListService } from "../services/read/trace-list-read.service.ts";
import { TraceQueryClassificationAdapter } from "../services/trace-query-classification.service.ts";
import {
  TraceQueryFieldValuesRepository,
  type TraceQueryFieldValuesInput,
} from "../repositories/read/query-field-values.repository.ts";
import { TraceSummaryService } from "../services/read/trace-summary-read.service.ts";
import {
  TraceViewerProtectionService,
  type TraceViewerProtectionOptions,
} from "../services/viewer/trace-viewer-protection.service.ts";
import { TraceViewerReadService } from "../services/viewer/trace-viewer.service.ts";
import { type TraceAppDependencies } from "../app/trace.app.ts";
import { type TraceBlobStoreService } from "../services/offload/trace-blob-store.service.ts";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { type TraceProcessingCommands } from "./trace.infrastructure.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";

export type TraceReaderCompositionOptions = {
  /** The rows the registry chose for this process, one tier over both stores. */
  repositories: TraceRepositories;
  resolveClickHouseClient: (tenantId: string) => Promise<ClickHouseClient>;
  defaultRetentionDays: number;
  canonicalisation: TraceCanonicalisationService;
  blobStore: TraceBlobStoreService;
  summaryStore: FoldProjectionStore<TraceSummaryData>;
  projects: ProjectApi;
  topics: TopicApi;
  modelProviders: ModelProviderApi;
  logs: LogApi;
  annotations: AnnotationApi;
  dataRetention: DataRetentionApi;
  protections: TraceViewerProtectionOptions;
  filterConditions: import("../repositories/clickhouse/trace-legacy-read.repository.ts").TraceLegacyFilterConditions;
  evaluations: TraceAppDependencies["evaluations"];
  codingAgents: TraceAppDependencies["codingAgents"];
  share: TraceAppDependencies["share"];
  broadcast: TraceAppDependencies["broadcast"];
  commands: TraceProcessingCommands;
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
      resolveClickHouseClient: resolve,
      filterConditions: options.filterConditions,
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
  const tree = TraceTreeComposition.create({
    resolveClient: resolve,
    modelProviders: options.modelProviders,
    queryFieldValues: TraceReadQueryFieldValues.create(list),
    queryClassification: TraceQueryClassificationAdapter.create(),
    summaryReader: {
      tryGetSummary: ({ tenantId, traceId }) =>
        options.summaryStore.tryGet(traceId, {
          aggregateId: traceId,
          tenantId: createTenantId(tenantId),
        }),
    },
    records: {
      getById: async ({ projectId, traceId }) => {
        const resolved = await protections.resolve({
          projectId,
          userId: void 0,
          publiclyShared: false,
        });
        const trace = await read.tryGetById(
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
      changeTraceName: options.commands.changeTraceName,
    },
    spanIngest: TraceProcessingSpanIngestAdapter.create(options.commands),
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
    codingAgents: options.codingAgents,
    share: options.share,
    broadcast: options.broadcast,
    protections,
  };
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

  list(input: TraceQueryFieldValuesInput) {
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
    const input = this.#extraction.tryExtractFirstInput(spans);
    const output = this.#extraction.tryExtractLastOutput(spans);
    return {
      input: input ? { type: "json", value: traceRecordValueSchema.parse(input.raw) } : null,
      output: output ? { type: "json", value: traceRecordValueSchema.parse(output.raw) } : null,
    };
  }
}
