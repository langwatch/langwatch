import { TraceProcessingSpanIngestAdapter } from "../adapters/trace-processing-span-ingest.adapter.ts";
import type { ClickHouseClient } from "@clickhouse/client";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import type { LogApi } from "@langwatch/log-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
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
import { TraceDerivationSpanClickHouseRepository } from "../repositories/clickhouse/trace-derivation-span.repository.ts";
import { ClickHouseTraceExistenceRepository } from "../repositories/clickhouse/trace-existence.repository.ts";
import { TraceLegacyReadClickHouseRepository } from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import { ClickHouseTraceEventPayloadRepository } from "../repositories/clickhouse/trace-event-payload.repository.ts";
import { LogRecordStorageClickHouseRepository } from "../repositories/clickhouse/log-record-storage.repository.ts";
import { LogRecordStorageService } from "../services/log/trace-log-record-read.service.ts";
import { SessionGroupsClickHouseRepository } from "../repositories/clickhouse/session-groups.repository.ts";
import { SessionGroupsService } from "../services/session/trace-session-groups.service.ts";
import { SpanStorageClickHouseRepository } from "../repositories/clickhouse/span-storage.repository.ts";
import { SpanStorageService } from "../services/offload/trace-span-storage-read.service.ts";
import { TraceEditOverlayService } from "../services/edit-overlay/trace-edit-overlay.service.ts";
import { TraceEventDerivationService } from "../services/ingestion/trace-event-derivation.service.ts";
import { TraceFullIoPort } from "../ports/trace-full-io.port.ts";
import { TraceIOExtractionService } from "../services/content/trace-io-extraction.service.ts";
import { TraceService as TraceLegacyReadService } from "../services/read/trace-legacy-read.service.ts";
import { TraceListClickHouseRepository } from "../repositories/clickhouse/trace-list.repository.ts";
import { TraceListService } from "../services/read/trace-list-read.service.ts";
import { TraceQueryClassificationAdapter } from "../adapters/trace-query-classification.adapter.ts";
import {
  TraceQueryFieldValuesPort,
  type TraceQueryFieldValuesInput,
} from "../ports/query-field-values.port.ts";
import { TraceSummaryClickHouseRepository } from "../repositories/clickhouse/trace-summary.repository.ts";
import { TraceSummaryService } from "../services/read/trace-summary-read.service.ts";
import {
  TraceViewerProtectionService,
  type TraceViewerProtectionOptions,
} from "../services/viewer/trace-viewer-protection.service.ts";
import { TraceViewerReadService } from "../services/viewer/trace-viewer.service.ts";
import { type TraceAppDependencies } from "../app/trace.app.ts";
import { type TraceBlobStoreService } from "../services/offload/trace-blob-store.service.ts";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { type TraceProcessingCommands } from "../ports/trace-processing-installer.port.ts";
import { PrismaTraceEditOverlayRepository } from "../repositories/prisma/prisma.trace-edit-overlay.repository.ts";

export type TraceReaderCompositionOptions = {
  connection: PrismaConnection;
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
  const spanStorageRepository = new SpanStorageClickHouseRepository(resolve);
  const editOverlay = TraceEditOverlayService.create(
    PrismaTraceEditOverlayRepository.create(options.connection.client),
  );
  const logRecords = LogRecordStorageService.create({
    repository: new LogRecordStorageClickHouseRepository(resolve),
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
    repository: TraceListClickHouseRepository.create(resolve),
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
      spans: TraceDerivationSpanClickHouseRepository.create({ resolveClient: resolve }),
    }),
    payloads: ClickHouseTraceEventPayloadRepository.createResolved({ resolveClient: resolve }),
    fullIo: TraceReadFullIo.create(ioExtractionService),
  }).build();

  return {
    traces: {
      existence: ClickHouseTraceExistenceRepository.create({ resolveClient: resolve }),
      read,
      list,
      sessionGroups: SessionGroupsService.create({
        repository: new SessionGroupsClickHouseRepository(resolve),
        codingAgentSessions: options.codingAgents,
        resolveOrganizationId: (projectId) => options.projects.getOrganizationId(projectId),
      }),
      spans: SpanStorageService.create({ repository: spanStorageRepository, blobResolutionDeps }),
      summary: TraceSummaryService.create({
        repository: TraceSummaryClickHouseRepository.create({
          resolveClient: resolve,
          defaultRetentionDays: options.defaultRetentionDays,
        }),
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

class TraceReadQueryFieldValues extends TraceQueryFieldValuesPort {
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

export class TraceReadFullIo extends TraceFullIoPort {
  static create(extraction: TraceIOExtractionService): TraceReadFullIo {
    return new TraceReadFullIo(extraction);
  }

  #extraction: TraceIOExtractionService;

  private constructor(extraction: TraceIOExtractionService) {
    super();
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
