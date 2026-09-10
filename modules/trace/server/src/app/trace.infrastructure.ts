import type { EventingTracePipelineAdapter } from "../services/eventing.trace-pipeline.service.ts";
import type { EventSourcing, QueueSendOptions, TenantId } from "@langwatch/eventing";
import type { ModelCost } from "@langwatch/model-provider-contract";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import type { OrgAdminResolution, Project, UpdateProjectMetadataInput } from "@langwatch/project-contract";
import type { AssignTopicCommandData, CustomersAndLabelsResult, DerivedTraceEvent, DistinctFieldNamesResult, Evaluation, NormalizedAttributes, NormalizedSpan, OtlpInstrumentationScope, OtlpResource, OtlpSpan, PromptStudioSpanResult, TopicCountsResult, Trace, TraceDerivedEventsInput, TraceLegacyFilterInput, TraceLegacyListInput, TraceQueryClassification, TraceRecordValue, TracesForProjectResult } from "@langwatch/trace-contract";
import type { Readable } from "node:stream";
export interface TraceInfrastructure {  traceEdgeMediaTelemetry: TraceEdgeMediaTelemetry;
  traceEvaluationDispatch: TraceEvaluationDispatch;
  traceEvaluationLoopMetrics: TraceEvaluationLoopMetrics;
  traceEvaluationMonitor: TraceEvaluationMonitor;
  traceEventDerivation: TraceEventDerivation;
  traceFullIo: TraceFullIo;
  traceIoExtraction: TraceIoExtraction;
  traceLegacyRead: TraceLegacyRead;
  traceMediaReferenceResolver: TraceMediaReferenceResolver;
  traceMediaStore: TraceMediaStore;
  traceModelCost: TraceModelCost;
  traceModelCostCatalog: TraceModelCostCatalog;
  traceProcessingInstaller: TraceProcessingInstaller;
  traceProcessingPipeline: TraceProcessingPipeline;
  traceProductAnalytics: TraceProductAnalytics;
  traceProjectMetadata: TraceProjectMetadata;
  traceQueryClassifier: TraceQueryClassifier;
  traceSpanContentDrop: TraceSpanContentDrop;
  traceSpanCostEnrichment: TraceSpanCostEnrichment;
  traceSpanIngest: TraceSpanIngest;
  traceSpanNormalization: TraceSpanNormalization;
  traceSpanPiiRedaction: TraceSpanPiiRedaction;
  traceSpanSpool: TraceSpanSpool;
  traceSpanTokenEstimation: TraceSpanTokenEstimation;
  traceSpoolLegacyObject: TraceSpoolLegacyObject;
  traceSpoolStorage: TraceSpoolStorage;
  traceTenantBroadcast: TraceTenantBroadcast;
  traceTokenCounter: TraceTokenCounter;
  traceTopicAssignmentCommand: TraceTopicAssignmentCommand;
  traceWindowedReadMetrics: TraceWindowedReadMetrics;
}

/**
 * Sending one online-evaluator run for an ingested trace.
 *
 * Two methods, because the dispatch is two decisions that belong to different
 * features. The PAYLOAD is Trace's: the fold state, the monitor, the delay and
 * the TTL are all read off a trace. The DEDUPLICATION KEY is Evaluation's:
 * `ExecuteEvaluationCommand.makeJobId` is the identity of an evaluation run,
 * and the queue squashes against it. Trace asks for that key rather than
 * spelling it, because a second spelling would not collide with the first and
 * the same evaluation would run twice.
 *
 * This is a port and not an import for a reason the linter enforces: a feature
 * server cannot depend on another feature's server package (`cross-feature` in
 * `architecture-lint`), and `ExecuteEvaluationCommand` lives in
 * `@langwatch/evaluation-server`. The composition root holds both and wires
 * them together, which is also what lets a process dispatch evaluations
 * without building the evaluator engine behind them.
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
 * Why an online-evaluator dispatch was refused by the loop guards.
 *
 * The two values are the guard's own vocabulary: `depth_direct` is a trace whose
 * evaluation would evaluate an evaluation, and `parent_in_subtree` is a trace
 * whose parent is already inside the subtree being evaluated. An operator reads
 * the two apart to tell a customer's recursive pipeline from our own fan-out.
 */
export type TraceEvaluationLoopBlockReason = "depth_direct" | "parent_in_subtree";

/**
 * What an operator can see about evaluations the loop guards refused.
 *
 * It is a port because the two processes that dispatch evaluations export
 * differently: the application increments its own `prom-client` registry
 * (`platform/app/src/server/metrics.ts`), and a process composed from packages
 * pushes over OTLP. Both must write the same series under the same name with
 * the same label, because the dashboard that answers "is the loop guard firing"
 * cannot be asked which process made the dispatch.
 *
 * Tenant attribution deliberately stays out of the labels and lives in the
 * structured log line instead — one label per project is unbounded cardinality
 * on a metric that fires per dispatch.
 */
export interface TraceEvaluationLoopMetrics {
  loopBlocked(reason: TraceEvaluationLoopBlockReason): void;
}

/**
 * The monitors an ingested trace should be evaluated against.
 *
 * One method, because `evaluationTrigger` calls exactly one: it lists the
 * project's on-message monitors and dispatches an evaluation command per
 * monitor that survives the loop guards. The application narrows the same
 * capability inline with `Pick<MonitorService, "getEnabledOnMessageMonitors">`,
 * which narrows the type and not the wiring — a process still had to build a
 * whole `MonitorService`, and with it the evaluator service and the Prisma
 * client behind it. Naming the port is what makes the read composable on its
 * own.
 *
 * `MonitorService` satisfies it structurally, and so does
 * `PostgresMonitorAdapter.create(...)`, which returns that contract.
 */
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
  tryExtractRichIOFromSpan(span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null;

  tryExtractFallbackIOFromSpan(
    span: NormalizedSpan,
    side: TraceIoSide,
  ): TraceIoValue | null;
}

/**
 * The legacy trace read, as the tRPC transports over it use it.
 *
 * The implementation is still the application's `TraceService`: it composes
 * ClickHouse reads, blob resolution, coding-agent enrichment and the reviewer
 * correction overlay, and none of that has left `platform/app` yet. This
 * declares only the eleven methods the `traces.*` and `spans.*` surfaces call,
 * so those surfaces can be package-owned before their service is.
 *
 * `protections` is deliberately `unknown`. Every method takes the viewer's
 * read-time redactions and the transports never look inside them — they ask
 * the process for them and hand them straight back — so naming their shape
 * here would only pin a second copy of a type the process owns. The one
 * surface that DOES read a field off them (the correction overlay's
 * visibility window) declares just that field, where it reads it.
 */
export interface TraceLegacyRead {
  /** One trace with its spans, or undefined when the project holds no such trace. */
  tryGetById(
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
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace[]>;

  /** The evaluator verdicts on a page of traces, keyed by trace id. */
  getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: unknown,
  ): Promise<Record<string, Evaluation[]>>;

  /** One evaluation's inputs, resolved lazily when its card is expanded. */
  tryGetEvaluationInputs(input: {
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
  tryGetSpanForPromptStudio(input: {
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

  trySerialize(references: TraceMediaReference[]): string | null;
}

/**
 * Where media lifted out of a span's content is put.
 *
 * One method, because that is the whole of what the extraction path asks of
 * the object store: hand it bytes and a purpose, get back the id the span
 * attribute is rewritten to point at. The store itself is
 * `@langwatch/stored-object-server`'s content-addressed `StoredObjectsService`,
 * which satisfies this — a feature server package may not reach into another
 * feature's server package, so the process joins the two.
 *
 * `isDuplicate` matters to the caller rather than being incidental: the same
 * image posted on two spans is stored once, and the extraction hook's counters
 * report a re-reference rather than a second write.
 */
export interface TraceMediaStore {
  storeFromBytes(input: {
    projectId: string;
    purpose: string;
    ownerKind: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<{ id: string; mediaType: string; isDuplicate: boolean }>;
}

/**
 * The fail-open reasons the edge extraction reports, under the names the
 * `edge_media_extract_fail_open` counter already carries.
 *
 * The first three are the hook itself standing down — a flag store it could
 * not read, a privacy probe that failed, a store that refused — and the last
 * three are budget outcomes rather than errors: parts left inline because the
 * per-span cap or the extraction deadline was hit, or because one part's store
 * failed while the rest of the span proceeded.
 */
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

/**
 * The project's own model-cost rules, as record-time cost enrichment reads them.
 *
 * This is deliberately NOT the shape the coding-agent cost estimator uses.
 * `CodingAgentCostEstimator.estimateCost` is pure and synchronous over a
 * static catalog, and Trace already has an equivalent read for fold-time
 * cost. Neither can answer this question: an operator's
 * per-project, per-team and per-organization overrides live in a table, they
 * are matched by regex against the model name, and a span enriched from the
 * static catalog when an override exists is billed at the wrong rate with
 * nothing to show that it happened. So the precedent does not transfer, and
 * this port states the read it really is.
 *
 * `ModelProviderApi` satisfies it structurally; nothing narrower exists
 * upstream, which is the reason for declaring it here rather than importing the
 * fourteen-method service.
 */
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
    /**
     * The registered `recordSpan` command, named because two of Trace's own
     * paths reach the pipeline through the queue rather than through the fold:
     * the REST tracked-event handler and the `trackedEventSync` reactor both
     * mint a synthetic span and have to send it the way an SDK export would.
     *
     * It is available only AFTER registration, which is why the process that
     * needs it hands the subscriber a late-bound proxy rather than the command.
     */
    commands: TraceProcessingCommands;
  };
}

/**
 * The exact definition Trace's own builder produces, commands and projections
 * included. Declaring the port against `RegisteredCommand` instead would erase
 * the union to its constraint, and `eventSourcing.register()` would then hand
 * every caller an index-signature command map — `recordSpan` typed as
 * `MappedCommand<Record<string, unknown>> | undefined` rather than as itself.
 * The process root composes subscribers on top of this builder, and every
 * `with*Subscriber` returns `this`, so the composed definition has this type.
 */
export type TraceProcessingPipelineDefinition = ReturnType<
  ReturnType<EventingTracePipelineAdapter["build"]>["build"]
>;

/** Process-composed Trace pipeline definition, built before registration. */
export interface TraceProcessingPipeline {
  build(options: {
    deferredOrigins: TraceDeferredOriginScheduler;
  }): TraceProcessingPipelineDefinition;
}

/**
 * One product-usage event, as the ingest path emits it.
 *
 * Product analytics, not observability: this is the onboarding funnel's own
 * record that a project started sending traces, and it is keyed by a person.
 */
export type TraceProductEvent = {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
  projectId?: string;
};

/**
 * Where the ingest path's product-usage events go.
 *
 * The trace path emits exactly one, `first_trace_integrated`, at most once per
 * project in that project's lifetime — the terminal step of the onboarding
 * funnel, carrying the SDK language and framework. The application sends it to
 * PostHog through `trackServerEvent`, which no-ops when `POSTHOG_KEY` is unset.
 *
 * Fire-and-forget, and the `void` return says so: this runs inside a projection
 * subscriber on the ingest path, and an analytics sink must never be able to
 * fail a trace.
 */
export interface TraceProductAnalytics {
  record(event: TraceProductEvent): void;
}

/**
 * The three things the `projectMetadata` subscriber does to a project.
 *
 * It named the whole `ProjectApi` before, which is fourteen capabilities
 * wide and reaches organizations, the LWQL ClickHouse key map and stored
 * objects. A background process that wanted to run this one subscriber had to
 * be able to build all of it — which is why this subscriber, and everything
 * queued behind it, could not leave the application.
 *
 * The published `ProjectApi` satisfies this structurally, so the
 * application keeps passing exactly what it passed before and a process that
 * holds only a project row and an org-admin lookup can now answer it too.
 */
export interface TraceProjectMetadata {
  tryGetById(id: string): Promise<Project | null>;
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

/**
 * The slice of the stored-objects registry the spool needs. Declared here
 * rather than imported so this module depends on a shape, not on the registry
 * class — the registry satisfies it structurally.
 */
export interface TraceSpoolObjectStore {
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(uri: string): Promise<Readable>;
  delete(uri: string): Promise<void>;
}

/**
 * Destination-agnostic storage for the trace spool, injected so the spool
 * service carries no env coupling and the tests run without infrastructure.
 *
 * This is the application's `SpoolStorage` interface as an abstract class. The
 * rename is the only difference: `port-modules` requires a runtime boundary in
 * a strict feature package to be a nominal abstract class, and the composition
 * roots that satisfy it are structural either way.
 */
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

/**
 * The v1 spool read, where the reference IS the object key rather than a
 * derived location.
 *
 * The application reaches this path with a raw `S3Client` built from a
 * per-organization resolver. A feature package cannot name a vendor SDK, and
 * this branch is a one-release compatibility window that the v2 format exists
 * to close (langwatch/langwatch-saas#837), so it is an injected port instead:
 * a composition that has no legacy transport omits it, and the legacy branch
 * then refuses by name rather than silently resolving somewhere else.
 */
export interface TraceSpoolLegacyObject {
  read(input: { projectId: string; key: string }): Promise<Readable>;
  delete(input: { projectId: string; key: string }): Promise<void>;
}

/**
 * How many tokens a model would charge for a piece of text.
 *
 * It is a port because the answer comes from a vendor encoding table that a
 * feature package must not carry: the application resolves it with `tiktoken`
 * plus a BPE file that is either on disk or fetched over the network, and a
 * process composed from packages supplies the same capability without this
 * package naming the library, the download or the cache.
 *
 * `undefined` is the deliberate answer for "cannot count", not an error. The
 * estimator's whole contract is that a span without usage attributes is left
 * exactly as it arrived rather than stamped with a guess, so an unknown
 * encoding, a failed encode and an empty text all resolve to the same nothing.
 * The application spells this `countTokens`; the `try` prefix is what
 * `fallible-result-naming` requires of a capability that answers absence.
 */
export interface TraceTokenCounter {
  tryCountTokens(model: string, text: string | undefined): Promise<number | undefined>;
}

/** Process-composed sender for Trace's registered durable topic command. */
export interface TraceTopicAssignmentCommand {
  sendAssignTopic(input: AssignTopicCommandData): Promise<void>;
}

/**
 * The realtime fan-out the trace ingestion path tells a tenant's tabs through.
 *
 * Two subscribers reach it — the trace summary fold advancing and spans landing
 * in storage — and both want one thing: put this already-serialised payload in
 * front of every browser watching this tenant. Neither subscribes, neither
 * emits locally, and neither knows whether the process it is running in is
 * serving a tab at all.
 *
 * The wire format is the contract, not this interface: the subscriber on the
 * far side lives in the application and matches its Redis channel by exact
 * string, so the channel is pinned by literal in the composition test that
 * drives this member, not derived from a constant only one side compiles.
 */
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

export type TraceWindowedReadOutcome =
  | "error"
  | "hit"
  | "unbounded_empty"
  | "unbounded_hit"
  | "unwindowed"
  | "windowed_empty"
  | "widened_empty"
  | "widened_hit";

/** Process-owned observability boundary for partition-pruned ClickHouse reads. */
export interface TraceWindowedReadMetrics {
  record(input: { table: string; outcome: TraceWindowedReadOutcome }): void;
}
