import type { Readable } from "node:stream";

import { type ExecuteEvaluationCommandData, EvaluationApi } from "@langwatch/evaluation-contract";
import type { TenantId, FoldProjectionStore } from "@langwatch/eventing";
import { type ModelCost, ModelProviderApi } from "@langwatch/model-provider-contract";
import { type MonitorSummary, MonitorApi } from "@langwatch/monitor-contract";
import {
  type OrgAdminResolution,
  type Project,
  type UpdateProjectMetadataInput,
  ProjectApi,
} from "@langwatch/project-contract";
import {
  type StoredObjectStorageDestination,
  StoredObjectApi,
} from "@langwatch/stored-object-contract";
import type {
  AnnotationAddedEventData,
  AnnotationRemovedEventData,
  AssignTopicCommandData,
  CustomersAndLabelsResult,
  DerivedTraceEvent,
  DistinctFieldNamesResult,
  Evaluation,
  NormalizedAttributes,
  NormalizedSpan,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
  PIIRedactionLevel,
  PromptStudioSpanResult,
  RecordSpanCommandData,
  TopicCountsResult,
  Trace,
  TraceDerivedEventsInput,
  TraceLegacyFilterInput,
  TraceLegacyListInput,
  TraceNameChangedEventData,
  TraceQueryClassification,
  TraceRecordValue,
  TracesForProjectResult,
  TraceCanonicalisationService,
  TraceSummaryData,
  TraceSummaryListOptions,
  TraceSummaryListQuery,
  TraceSummaryPage,
} from "@langwatch/trace-contract";

export type { TraceProcessingPipelineDefinition } from "../eventing/trace-processing-projections.pipeline.ts";
import { AnnotationApi } from "@langwatch/annotation-contract";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { LogApi } from "@langwatch/log-contract";
import { PresenceApi } from "@langwatch/presence-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { ShareApi } from "@langwatch/share-contract";
import { TopicApi } from "@langwatch/topic-contract";

import type { TraceClickHouseResolver } from "../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import type { TraceBlobStoreService } from "../services/trace-blob-store.service.ts";
import type { TracesTrpcEmitters } from "./trace.app.ts";

/** Queues an online-evaluator run for an ingested trace; Evaluation owns its delay and dedup. */
export interface TraceEvaluationDispatch {
  send(data: ExecuteEvaluationCommandData): Promise<void>;
}

/**
 * Why an online-evaluator dispatch was refused: `depth_direct` reads the
 * incoming span, `depth_fold` reads the same check off the folded trace state
 * on the deferred-origin path, `parent_in_subtree` is an already-covered parent.
 */
export type TraceEvaluationLoopBlockReason = "depth_direct" | "depth_fold" | "parent_in_subtree";

/** What an operator can see about evaluations the loop guards refused. A port
 * because different processes export differently: app uses prom-client, packages
 * push over OTLP. Both write the same series to keep the dashboard consistent. */
export interface TraceEvaluationLoopMetrics {
  loopBlocked(reason: TraceEvaluationLoopBlockReason): void;
}

/** The monitors an ingested trace should be evaluated against. Narrowing
 * this port (not the whole MonitorService) makes the read composable. */
export interface TraceEvaluationMonitor {
  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
}

export interface TraceEventDerivation {
  derive(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]>;
}

export type TraceFullIoRecord = {
  input: { type: string; value: TraceRecordValue } | null;
  output: { type: string; value: TraceRecordValue } | null;
};

export interface TraceFullIo {
  recompute(spans: NormalizedSpan[]): TraceFullIoRecord;
}

export type TraceIoSide = "input" | "output";

export type TraceIoValue = {
  raw: unknown;
  text: string;
  source: "gen_ai" | "langwatch";
};

export interface TraceIoExtraction {
  extractRichIOFromSpan(span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null;

  extractFallbackIOFromSpan(span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null;
}

/** The legacy trace read, as tRPC transports use it. Declared here to let
 * surfaces be package-owned before the implementation. `protections` is
 * deliberately unknown; transports never inspect them. */
export interface TraceLegacyRead {
  /** One trace with its spans, or undefined when the project holds no such trace. */
  findById(params: {
    projectId: string;
    traceId: string;
    protections: unknown;
    opts?: { full?: boolean; withEditOverlay?: boolean };
  }): Promise<Trace | undefined>;

  /** The project's list/search read, keyset-paged by `scrollId`. */
  getAllTracesForProject(
    input: TraceLegacyListInput,
    protections: unknown,
    options?: {
      downloadMode?: boolean;
      includeSpans?: boolean;
      resolveBlobs?: boolean;
      scrollId?: string | null;
      /** The v1 REST search's compiled query-language filter, ANDed into the read. */
      filterWhere?: { sql: string; params: Record<string, unknown> };
    },
  ): Promise<TracesForProjectResult>;

  /** The list read's keyset page as bare summaries, for a system reader. */
  listTraceSummaries(
    query: TraceSummaryListQuery,
    options?: TraceSummaryListOptions,
  ): Promise<TraceSummaryPage>;

  /**
   * Named traces with their spans. `occurredAt` is the partition-pruning hint:
   * dropping it turns a bounded read into a scan of every partition, cold
   * storage included.
   */
  getTracesWithSpans(params: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    occurredAt?: { from: number; to: number };
    opts?: { full?: boolean; withEditOverlay?: boolean };
  }): Promise<Trace[]>;

  /** Every trace in one conversation. */
  getTracesByThreadId(params: {
    projectId: string;
    threadId: string;
    protections: unknown;
    opts?: { full?: boolean };
  }): Promise<Trace[]>;

  /** Every trace in each of several conversations. */
  getTracesWithSpansByThreadIds(params: {
    projectId: string;
    threadIds: string[];
    protections: unknown;
    opts?: { full?: boolean; withEditOverlay?: boolean; maxTraces?: number };
  }): Promise<Trace[]>;

  /** The evaluator verdicts on a page of traces, keyed by trace id. */
  getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: unknown,
  ): Promise<Record<string, Evaluation[]>>;

  /** One evaluation's inputs, resolved lazily when its card is expanded. */
  findEvaluationInputs(input: {
    projectId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null>;

  /** Topic and subtopic counts for the filtered window. */
  getTopicCounts(input: TraceLegacyFilterInput): Promise<TopicCountsResult>;

  /** The distinct customer ids and labels in the filtered window. */
  getCustomersAndLabels(input: TraceLegacyFilterInput): Promise<CustomersAndLabelsResult>;

  /** Span names, metadata keys and evaluator names the project has produced. */
  getDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult>;

  /** One LLM span reshaped for the prompt studio, or null when it is not one. */
  findSpanForPromptStudio(input: {
    projectId: string;
    spanId: string;
    protections: unknown;
  }): Promise<PromptStudioSpanResult | null>;
}

export type TraceMediaReference = {
  kind: "audio" | "file" | "image" | "video";
  url: string;
  filename?: string;
  mimeType?: string;
  role?: string;
};

export const TRACE_INPUT_MEDIA_REFERENCE_ATTRIBUTE = "langwatch.reserved.media_refs.input";
export const TRACE_OUTPUT_MEDIA_REFERENCE_ATTRIBUTE = "langwatch.reserved.media_refs.output";

export interface TraceMediaReferenceResolver {
  collect(value: unknown): TraceMediaReference[];

  parse(serialized: string | null): TraceMediaReference[];

  merge(input: {
    existing: TraceMediaReference[];
    incoming: TraceMediaReference[];
    precedence: "append" | "prepend";
  }): TraceMediaReference[];

  serialize(references: TraceMediaReference[]): string | null;
}

/** Where media lifted out of a span's content is put. Reused by the extraction
 * path to store bytes and get back the id to rewrite span attributes to. */
export interface TraceMediaStore {
  storeFromBytes: (input: {
    projectId: string;
    purpose: string;
    ownerKind: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }) => Promise<{ id: string; mediaType: string; isDuplicate: boolean }>;
}

/** The fail-open reasons the edge extraction reports. First three: hook
 * standing down (flag store, privacy probe, store refusal). Last three: budget
 * outcomes (per-span cap, deadline, part store). */
export type TraceEdgeMediaFailOpenReason =
  | "flag_store"
  | "privacy_probe"
  | "storage"
  | "part_cap"
  | "deadline"
  | "part_store";

/** The one series the edge extraction reports. Absent means unreported. */
export interface TraceEdgeMediaTelemetry {
  failOpen(reason: TraceEdgeMediaFailOpenReason, count?: number): void;
}

/** The project's own model-cost rules, as record-time cost enrichment reads
 * them. Deliberately not the coding-agent estimator shape: this reads per-project
 * overrides matched by regex against model names. */
export interface TraceModelCostCatalog {
  listCosts(input: { projectId: string }): Promise<ModelCost[]>;
}

export interface TraceModelCost {
  estimate(input: {
    attributes: NormalizedAttributes;
    model: string | undefined;
    promptTokens: number | null;
    completionTokens: number | null;
  }): number;
}

/** Commands shared by receiver, reviewer, and background callers of Trace. */
export interface TraceProcessingCommands {
  recordSpan(data: RecordSpanCommandData): Promise<unknown>;
  changeTraceName(data: TraceNameChangedEventData): Promise<unknown>;
  addAnnotation(data: AnnotationAddedEventData): Promise<unknown>;
  removeAnnotation(data: AnnotationRemovedEventData): Promise<unknown>;
  assignTopic(data: AssignTopicCommandData): Promise<unknown>;
}

/** One product-usage event, as the ingest path emits it. Keyed by userId,
 * not traced to observability. */
export type TraceProductEvent = {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
  projectId?: string;
};

/** Where the ingest path's product-usage events go. Fire-and-forget (void
 * return): runs inside a projection subscriber and must not fail a trace. */
export interface TraceProductAnalytics {
  record(event: TraceProductEvent): void;
}

/** The three things the projectMetadata subscriber does to a project. Narrowed
 * from the full ProjectApi so background processes can compose just this. */
export interface TraceProjectMetadata {
  findById(id: string): Promise<Project | null>;
  updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
  /**
   * The org admin's user id, which is also the distinct_id posthog-js
   * identifies the same person with in the browser.
   */
  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
}

/** Composition port for the canonical Trace query grammar during its migration. */
export interface TraceQueryClassifier {
  classify(query: string): TraceQueryClassification;
}

export interface TraceSpanIngest {
  recordSpan(data: RecordSpanCommandData): Promise<unknown>;
}

export interface TraceSpanNormalization {
  normalizeSpanReceived(params: {
    tenantId: string;
    span: OtlpSpan;
    resource: OtlpResource | null;
    instrumentationScope: OtlpInstrumentationScope | null;
  }): NormalizedSpan;

  enrichRagContextIds(span: NormalizedSpan): void;
}

export interface TraceSpanPiiRedaction {
  redact(input: {
    span: OtlpSpan;
    resource: OtlpResource | null;
    piiRedactionLevel: PIIRedactionLevel;
    tenantId: TenantId;
  }): Promise<void>;
}

export interface TraceSpanCostEnrichment {
  enrich(span: OtlpSpan, tenantId: string): Promise<void>;
}

export interface TraceSpanTokenEstimation {
  estimate(span: OtlpSpan, tenantId: string): Promise<void>;
}

export type TraceSpanContentDropResult = {
  droppedCount: number;
  droppedCategories: string[];
};

export interface TraceSpanContentDrop {
  drop(span: OtlpSpan, projectId: string): Promise<TraceSpanContentDropResult>;
}

export type DeferredOriginPayload = {
  id: string;
  tenantId: string;
  traceId: string;
};

export type TraceSpanSpoolIdentity = {
  spoolRef: string;
  projectId: string;
  traceId: string;
  spanId: string;
};

/** Transient oversized-command storage. The event log remains authoritative. */
export interface TraceSpanSpool {
  read(identity: TraceSpanSpoolIdentity): Promise<string>;
  delete(identity: TraceSpanSpoolIdentity): Promise<void>;
}

/** The slice of the stored-objects registry the spool needs. Declared as a
 * shape, not the registry class, so it satisfies structurally. */
export interface TraceSpoolObjectStore {
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(uri: string): Promise<Readable>;
  delete(uri: string): Promise<void>;
}

/** Destination-agnostic storage for the trace spool, injected so the service
 * carries no env coupling and tests run without members. */
export interface TraceSpoolStorage {
  /** Per-project so BYOC tenants resolve their own bucket and credentials. */
  objectStoreFor(projectId: string): TraceSpoolObjectStore;
  resolveDestination(projectId: string): Promise<StoredObjectStorageDestination>;
  /**
   * The operator's assertion that the Azure container has the orphan-reaping
   * lifecycle rule. Injected rather than read from env here so this class keeps
   * its no-env-coupling property; the composition root owns the env read.
   */
  readonly azureRetentionConfirmed: boolean;
}

/** The v1 spool read, where the reference IS the object key. A one-release
 * compatibility window since the v2 format exists to close it. */
export interface TraceSpoolLegacyObject {
  read(input: { projectId: string; key: string }): Promise<Readable>;
  delete(input: { projectId: string; key: string }): Promise<void>;
}

/** Process-composed sender for Trace's registered durable topic command. */
export interface TraceTopicAssignmentCommand {
  sendAssignTopic(input: AssignTopicCommandData): Promise<void>;
}

export const traceDependencies = {
  annotations: AnnotationApi,
  /**
   * The API-key directory the deprecated `/api/trace/*` family resolves its
   * own credential through — it opts out of the framework door because a
   * released SDK parses its pre-framework refusal bodies.
   */
  apiKeys: ApiKeyApi,
  authz: AuthzApi,
  automations: AutomationApi,
  codingAgents: CodingAgentApi,
  dataPrivacy: DataPrivacyApi,
  dataRetention: DataRetentionApi,
  plans: EntitlementApi,
  evaluations: EvaluationApi,
  evaluators: EvaluatorApi,
  experiments: ExperimentApi,
  featureFlags: FeatureFlagApi,
  instantEvals: InstantEvalApi,
  logs: LogApi,
  modelProviders: ModelProviderApi,
  monitors: MonitorApi,
  presence: PresenceApi,
  projects: ProjectApi,
  scenarios: ScenarioApi,
  share: ShareApi,
  storedObjects: StoredObjectApi,
  topics: TopicApi,
};

export type TraceInfrastructure = Readonly<{
  trace: Readonly<{
    resolveClickHouseClient: TraceClickHouseResolver;
    defaultRetentionDays: number;
    canonicalisation: TraceCanonicalisationService;
    blobStore: TraceBlobStoreService;
    summaryStore: FoldProjectionStore<TraceSummaryData>;
    commands: TraceProcessingCommands;
    broadcast: TracesTrpcEmitters;
    fallbackVisibilityDays: number;
    processName: string;
    /** The deployment's public origin, for `platformUrl`. Optional: not every
     * install serves REST. */
    publicBaseUrl?: string;
  }>;
}>;
