import type { Readable } from "node:stream";

import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { EventSourcing, QueueSendOptions, TenantId } from "@langwatch/eventing";
import type { ModelCost } from "@langwatch/model-provider-contract";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import type {
  OrgAdminResolution,
  Project,
  UpdateProjectMetadataInput,
} from "@langwatch/project-contract";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
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
  TraceTopicAssignment,
  TracesForProjectResult,
} from "@langwatch/trace-contract";

import type { EventingTracePipelineAdapter } from "../services/eventing.trace-pipeline.service.ts";

/**
 * Dispatch online-evaluator runs for ingested traces. Payload is Trace's
 * (fold state, monitor, delay, TTL); dedup key is Evaluation's (from makeJobId).
 * Ported (not imported) to avoid cross-feature server dependency.
 */
export interface TraceEvaluationDispatch {
  /**
   * The queue deduplication id for this evaluation run. Called by the queue
   * for every send, so it must stay pure and cheap.
   */
  makeDedupId(data: ExecuteEvaluationCommandData): string;

  send(
    data: ExecuteEvaluationCommandData,
    options?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ): Promise<void>;
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

export interface TraceFullIo {
  recompute(spans: NormalizedSpan[]): {
    input: { type: string; value: TraceRecordValue } | null;
    output: { type: string; value: TraceRecordValue } | null;
  };
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
  findById(
    projectId: string,
    traceId: string,
    protections: unknown,
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace | undefined>;

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

  /**
   * Named traces with their spans. `occurredAt` is the partition-pruning hint:
   * dropping it turns a bounded read into a scan of every partition, cold
   * storage included.
   */
  getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: unknown,
    occurredAt?: { from: number; to: number },
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace[]>;

  /** Every trace in one conversation. */
  getTracesByThreadId(
    projectId: string,
    threadId: string,
    protections: unknown,
    opts?: { full?: boolean },
  ): Promise<Trace[]>;

  /** Every trace in each of several conversations. */
  getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: unknown,
    opts?: { full?: boolean; withEditOverlay?: boolean; maxTraces?: number },
  ): Promise<Trace[]>;

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
}

/** Worker-facing installation capability for Trace's complete processing graph. */
export interface TraceProcessingInstaller {
  install(eventSourcing: EventSourcing): {
    traceAssignments: TraceTopicAssignment;
    /** The registered recordSpan command. Available only AFTER registration,
     * so the process that needs it uses a late-bound proxy. */
    commands: TraceProcessingCommands;
  };
}

/** The exact definition Trace's builder produces, commands and projections
 * included. Type-preserves the commands (recordSpan as itself, not as union). */
export type TraceProcessingPipelineDefinition = ReturnType<
  ReturnType<EventingTracePipelineAdapter["build"]>["build"]
>;

/** Process-composed Trace pipeline definition, built before registration. */
export interface TraceProcessingPipeline {
  build(options: {
    deferredOrigins: TraceDeferredOriginScheduler;
  }): TraceProcessingPipelineDefinition;
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
  recordSpan(data: RecordSpanCommandData): Promise<void>;
}

export interface TraceSpanNormalization {
  normalizeSpanReceived(
    tenantId: string,
    span: OtlpSpan,
    resource: OtlpResource | null,
    instrumentationScope: OtlpInstrumentationScope | null,
  ): NormalizedSpan;

  enrichRagContextIds(span: NormalizedSpan): void;
}

export interface TraceSpanPiiRedaction {
  redact(
    span: OtlpSpan,
    resource: OtlpResource | null,
    level: PIIRedactionLevel,
    tenantId: TenantId,
  ): Promise<void>;
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

/** The pipeline builder receives this named scheduler before its queue exists. */
export interface TraceDeferredOriginScheduler {
  schedule(payload: DeferredOriginPayload): Promise<void>;
}

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

/** How many tokens a model would charge for a piece of text. Undefined is the
 * deliberate "cannot count" answer, not an error; spans without usage stay as
 * they arrived, not stamped with a guess. */
export interface TraceTokenCounter {
  computeTokenCount(model: string, text: string | undefined): Promise<number | undefined>;
}

/** Process-composed sender for Trace's registered durable topic command. */
export interface TraceTopicAssignmentCommand {
  sendAssignTopic(input: AssignTopicCommandData): Promise<void>;
}

/** The realtime fan-out the trace ingestion path tells a tenant's tabs through.
 * Wire format (Redis channel) is the contract; the channel is pinned by literal
 * in the composition test, not derived from a constant. */
export interface TraceTenantBroadcast {
  broadcastToTenant(
    tenantId: string,
    /** The already-serialised payload the browser receives verbatim. */
    event: string,
    eventType: "trace_updated",
  ): Promise<void>;
}

/** The one channel the trace path publishes on, as the far side spells it. */
export const TRACE_TENANT_BROADCAST_EVENT_TYPE = "trace_updated" as const;
