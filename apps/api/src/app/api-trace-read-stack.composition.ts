import type { Protections } from "@langwatch/trace-contract";
/**
 * The ClickHouse trace READ stack, composed from this process's own graph.
 */
import {
  TraceReadRedactionService,
  ClaudeCodeLogEnrichmentService,
  TraceReadableSpanService,
  TraceEditOverlayRedactionService,
  TraceEditOverlayRestoreService,
  TraceMetadataWriteService,
} from "@langwatch/trace-server";
import type { ClickHouseClient } from "@clickhouse/client";
import type { AuthzService } from "@langwatch/authz-contract";
import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import {
  CONTENT_KEY_CATALOG,
  isContentVisible,
  isContentVisibleToPublic,
  describeAudience,
  PRIVACY_DROPPED_MARKER_ATTR,
  PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
  type ContentCategory,
  type ResolvedCategory,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { sharedFiltersInputSchema } from "@langwatch/analytics-server";
import {
  ContentDropPolicyService,
  PrismaDataPrivacyResolutionAdapter,
} from "@langwatch/data-privacy-server";
import { EvaluationPreconditionService } from "@langwatch/evaluation-server";
import { evaluatorTypesSchema, getEvaluatorDefinitions } from "@langwatch/evaluator-contract";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import { FREE_VISIBILITY_DAYS } from "@langwatch/enterprise-licensing-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { ModelProviderExecutionHandleService } from "@langwatch/model-provider-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { TopicService } from "@langwatch/topic-contract";
import {
  buildDisplayInput,
  stringifySpanIO,
  type Span,
  type Trace,
  type TraceService as TraceTreeService,
} from "@langwatch/trace-contract";
import { TraceBlobStoreService, ClickHouseTraceAdapter, DERIVED_INPUT_ATTR_PREFIX, DERIVED_OUTPUT_ATTR_PREFIX, TraceAiQueryService, LogRecordStorageClickHouseRepository, LogRecordStorageService, NullLogRecordStorageRepository, NullSessionGroupsRepository, NullSpanStorageRepository, NullTraceListAdapter, NullTraceSummaryRepository, SessionGroupsClickHouseRepository, SessionGroupsService, SpanStorageClickHouseRepository, SpanStorageService, TraceCanonicalisationService, ClickHouseTraceLegacyReadAdapter, PrismaTraceEditOverlayRepository, TraceEditOverlayService, TraceIOExtractionService, TraceListClickHouseRepository, TraceListService, TraceLegacyReadService, TraceNotFoundError, TraceFullIoPort, TracePayloadReaderPort, TraceQueryClassificationAdapter, TraceSpanIngestPort, TraceSummaryClickHouseRepository, TraceSummaryService, traceMetadataUpdateSchema, VisibilityWindowService, type ClaudeSpanRef, type TraceLegacyFilterConditions, type TracesV2TrpcPorts, type TraceAppDependencies } from "@langwatch/trace-server";
import type { TracesTrpcPorts } from "@langwatch/trace-server";
import {
  findPromptReferenceInAncestors,
  flattenParamsToPromptAttributes,
  type PromptLookupSpan,
  type TraceLegacyFilterInput,
  type TraceLegacyListInput,
} from "@langwatch/trace-contract";
import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";
import { ApiTraceReadStackPort } from "../features/trace/trace.composition";

/** Everything the read stack is composed from. */
export type ApiTraceReadStackOptions = Readonly<{
  /** The one guarded connection the overlay, project and topic rows are read on. */
  prisma: PrismaClient;
  /** The process's tenant-keyed ClickHouse, or none where it composed one. */
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  /** Decides whether this caller may see spend. */
  authz: AuthzService;
  /** Resolves a project's team and organization, for the window and the policy. */
  projects: ProjectService;
  /**
   * The project's resolved data-privacy policy — the one every read redacts by. Composed from
   * `prisma` and `projects` when the process does not hand one in, so a caller cannot compose
   * the stack without a policy resolver and quietly serve unredacted content.
   */
  dataPrivacy?: ApiTraceDataPrivacyResolver | undefined;
  /** The plan the visibility window comes from. */
  plans: PlanProvider;
  /** The retention cascade the span read's floor is widened to. */
  dataRetention: DataRetentionService;
  /** The topic tree the grid labels its rows with. */
  topics: TopicService;
  /** The gateway the AI composer resolves its model through. */
  modelProviders: ModelProviderService | undefined;
  /** Where a resolved model executes: nlpgo's OpenAI-compatible proxy. */
  executionProxyBaseUrl: string;
  /** The evaluation summaries the grid labels its rows with, if composed. */
  evaluations?: EvaluationService | undefined;
  /** The coding-agent sessions the Sessions lens joins, if composed. */
  codingAgents?: CodingAgentService | undefined;
  /** Where a reserved-metadata amendment is recorded, if a queue was composed. */
  ingest?: TraceSpanIngestPort | undefined;
  /** Analytics's filter translator; absent, a FILTERED list refuses. */
  filterConditions?: TraceLegacyFilterConditions | undefined;
  /** Names a refusal, so a stand-in says which process reached it. */
  processName: string;
}>;

/**
 * The legacy trace grid's ports, minus the per-request redactions. Named here rather than
 * written out, because it is the trace package's own declaration: a second copy in the process
 * is what goes stale when the transport grows a port.
 */
export type ApiTraceLegacyPorts = Omit<
  TracesTrpcPorts<TraceLegacyListInput, unknown, TraceLegacyFilterInput, unknown, unknown>,
  "getViewerProtections"
>;

/**
 * Offset pagination was dropped when trace search moved to ClickHouse: deep OFFSET degrades
 * badly, and keyset (`scrollId`) replaced it.
 */
const pageOffsetInput = z
  .number()
  .optional()
  .describe(
    "Removed. Offset pagination is no longer supported and any value other " +
      "than 0 is rejected. Page with the scrollId returned by the previous " +
      "response instead. The field remains on the schema so that sending it " +
      "produces an explanatory error rather than being silently discarded.",
  )
  .refine((value) => value === undefined || value === 0, {
    message:
      "pageOffset is no longer supported — offset pagination was removed. Use the scrollId returned by the previous response to fetch the next page.",
  });

/**
 * What a legacy trace read may be scoped by, and what a caller may send.
 */
export const API_TRACE_FILTER_INPUT = sharedFiltersInputSchema.extend({
  pageOffset: pageOffsetInput,
  // Non-negative integers only (#2163): a fractional or negative page size
  // reaches ClickHouse as a LIMIT and fails there instead of at the boundary.
  pageSize: z.number().int().positive().optional(),
});

/** The same, plus the paging and ordering the list/search read understands. */
export const API_TRACE_LIST_INPUT = API_TRACE_FILTER_INPUT.extend({
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  updatedAt: z.number().optional(),
  scrollId: z.string().optional().nullable(),
});

/**
 * One configured precondition rule on the evaluator wizard's sample step.
 */
const apiPreconditionSchema = z.object({
  field: z.string().min(1),
  rule: z.enum(["contains", "not_contains", "matches_regex", "is"]),
  value: z.string().min(1).max(500),
  key: z.string().optional(),
  subkey: z.string().optional(),
});

/** The trace and its spans, reduced to the facts a precondition rule reads. */
type ApiPreconditionTraceData = Readonly<{
  data: Parameters<EvaluationPreconditionService["areMet"]>[0]["data"];
  spans: Parameters<EvaluationPreconditionService["areMet"]>[0]["spans"];
}>;

/** A captured span, as Evaluation's precondition vocabulary reads it. */
function evaluationSpanOf(span: Span): ApiPreconditionTraceData["spans"][number] {
  return {
    type: span.type,
    model: "model" in span && typeof span.model === "string" ? span.model : null,
    ragContextTexts:
      "contexts" in span && Array.isArray(span.contexts)
        ? span.contexts
            .map((context) => {
              const content =
                typeof context === "object" && context !== null && "content" in context
                  ? (context as { content: unknown }).content
                  : context;
              return typeof content === "string" ? content : JSON.stringify(content ?? "");
            })
            .filter(Boolean)
        : [],
  };
}

/** The trace, reduced to the facts a precondition rule reads. */
function preconditionTraceData(
  input: Readonly<{ trace: Trace; spans: Span[] }>,
): ApiPreconditionTraceData {
  const metadata = input.trace.metadata;
  const reserved = new Set([
    "thread_id",
    "user_id",
    "customer_id",
    "labels",
    "topic_id",
    "subtopic_id",
    "sdk_name",
    "sdk_version",
    "sdk_language",
    "telemetry_sdk_language",
    "telemetry_sdk_name",
    "telemetry_sdk_version",
    "prompt_ids",
    "prompt_version_ids",
  ]);
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (reserved.has(key)) continue;
    if (typeof value === "string") custom[key] = value;
  }
  return {
    data: {
      projectId: input.trace.project_id,
      traceId: input.trace.trace_id,
      computedInput: input.trace.input?.value ?? null,
      computedOutput: input.trace.output?.value ?? null,
      hasError: Boolean(input.trace.error),
      userId: metadata.user_id ?? null,
      threadId: metadata.thread_id ?? null,
      customerId: metadata.customer_id ?? null,
      labels: metadata.labels ?? null,
      promptIds: metadata.prompt_ids ?? null,
      topicId: metadata.topic_id ?? null,
      subTopicId: metadata.subtopic_id ?? null,
      customMetadata: custom,
    } as unknown as ApiPreconditionTraceData["data"],
    spans: input.spans.map(evaluationSpanOf),
  };
}

/** The project's resolved data-privacy policy, as this stack reads it. */
export type ApiTraceDataPrivacyResolver = Readonly<{
  getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
}>;

/** Composes the trace read stack over this process's own connection. */
export function composeApiTraceReadStack(options: ApiTraceReadStackOptions): ApiTraceReadStackPort {
  return ApiComposedTraceReadStack.create(options);
}

class ApiComposedTraceReadStack extends ApiTraceReadStackPort {
  static create(options: ApiTraceReadStackOptions): ApiComposedTraceReadStack {
    return new ApiComposedTraceReadStack(options);
  }

  private readonly logger: Logger;
  private readonly canonicalisation = TraceCanonicalisationService.create();
  private readonly protections: ApiTraceProtections;
  private readonly composed: TraceAppDependencies["traces"];
  private readonly dropPolicy = ContentDropPolicyService.create();
  private readonly preconditions = EvaluationPreconditionService.create();
  private readonly dataPrivacy: ApiTraceDataPrivacyResolver;

  private constructor(private readonly options: ApiTraceReadStackOptions) {
    super();
    this.logger = createLogger(`${options.processName}:traces`);
    this.dataPrivacy =
      options.dataPrivacy ??
      PrismaDataPrivacyResolutionAdapter.create({
        prisma: options.prisma,
        projects: options.projects,
      });
    this.protections = ApiTraceProtections.create({
      ...options,
      dataPrivacy: this.dataPrivacy,
    });
    this.composed = this.composeReaders();
  }

  readers(): TraceAppDependencies["traces"] {
    return this.composed;
  }

  getViewerProtections(ctx: unknown, input: Readonly<{ projectId: string }>): Promise<Protections> {
    return this.protections.resolve({
      projectId: input.projectId,
      userId: tryActorId(ctx),
      publiclyShared: false,
    });
  }

  tryGetShareViewerProtections(input: {
    projectId: string;
    session: { user?: { id: string } } | null | undefined;
  }): Promise<Protections | null> {
    return this.protections.tryResolveForShare({
      projectId: input.projectId,
      userId: input.session?.user?.id,
    });
  }

  async getApiKeyProtections(input: Readonly<{ projectId: string }>): Promise<Protections> {
    // The anonymous resolution, then costs put back. `resolve` with no user id
    // takes the public branch of every content category, which is what a key
    // must see; the cost override is what `getProtectionsForProject` did, and
    // it is sound because every project role grants `cost:view` and a project
    // key carries full project access.
    const protections = await this.protections.resolve({
      projectId: input.projectId,
      userId: undefined,
      publiclyShared: false,
    });
    return { ...protections, canSeeCosts: true };
  }

  isTraceNotFound(error: unknown): boolean {
    return error instanceof TraceNotFoundError;
  }

  readPorts(): Pick<
    TracesV2TrpcPorts,
    "getVisibilityCutoffMs" | "mappers" | "derivedAttrPrefixes" | "codingAgentEnrichment"
  > {
    return {
      getVisibilityCutoffMs: (projectId) => this.protections.visibilityCutoffMs(projectId),
      derivedAttrPrefixes: {
        input: DERIVED_INPUT_ATTR_PREFIX,
        output: DERIVED_OUTPUT_ATTR_PREFIX,
      },
      mappers: {
        spanDisplay: { buildDisplayInput, stringifySpanIO },
        spanProtection: {
          applySpanProtections: TraceReadRedactionService.applySpanProtections,
          extractRedactionsFromAllSpanInputs:
            TraceReadRedactionService.extractRedactionsFromAllSpanInputs,
          extractRedactionsFromAllSpanOutputs:
            TraceReadRedactionService.extractRedactionsFromAllSpanOutputs,
          redactObject: TraceReadRedactionService.redactObject,
          applyDerivedTraceEventProtections:
            TraceReadRedactionService.applyDerivedTraceEventProtections,
        },
        contentPrivacy: {
          contentKeyCatalog: CONTENT_KEY_CATALOG,
          droppedMarkerAttribute: PRIVACY_DROPPED_MARKER_ATTR,
          piiIncompleteMarkerAttribute: PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
          stripRolesFromChatArrayJson: (json, roles, stripToolCalls) =>
            this.dropPolicy.tryStripRolesFromChatArrayJson(json, roles, stripToolCalls),
          getResolvedPolicyForProject: (input) => this.dataPrivacy.getResolvedForProject(input),
        },
      },
      codingAgentEnrichment: {
        isCodingAgentShapedSpan: ClaudeCodeLogEnrichmentService.isCodingAgentShapedSpan,
        enrichSpansFromLogs: (input) =>
          ClaudeCodeLogEnrichmentService.enrichCodingAgentSpansFromLogs(input),
        enrichSingleSpanWithLogContent: (input) =>
          ClaudeCodeLogEnrichmentService.enrichSingleSpanWithClaudeLogContent({
            ...input,
            modelCallRefs: input.modelCallRefs as ClaudeSpanRef[],
          }),
        mapSummaryRowsToRefs: ClaudeCodeLogEnrichmentService.mapSummaryRowsToClaudeRefs,
      },
    };
  }

  explorerPorts(): Omit<
    TracesV2TrpcPorts,
    | "getViewerProtections"
    | "getVisibilityCutoffMs"
    | "mappers"
    | "derivedAttrPrefixes"
    | "codingAgentEnrichment"
    | "queryTranslation"
  > {
    return {
      runAiQuery: (input) =>
        TraceAiQueryService.generateTraceQueryFromPrompt({
          ...input,
          resolveModel: (model) => this.resolveComposerModel(model),
          traces: this.composed.tree,
        }),
      runAiAction: (input) =>
        TraceAiQueryService.generateTraceAction({
          ...input,
          resolveModel: (model) => this.resolveComposerModel(model),
          traces: this.composed.tree,
        }),
      traceMetadataUpdateSchema,
      updateTraceMetadata: (input) =>
        TraceMetadataWriteService.updateTraceMetadata({
          ...input,
          metadata: input.metadata as Parameters<
            typeof TraceMetadataWriteService.updateTraceMetadata
          >[0]["metadata"],
          ingest: this.requireIngest(),
        }),
      // The unmapped-cost hint is the MODEL PROVIDER feature's reading, and it
      // reaches this process's gateway rather than the trace store. It is
      // filled in by the trace-group composition, which holds both.
      deriveUnmappedCostSuggestion: () => Promise.resolve(null),
      resolveAncestorPromptParams: (input) => this.resolveAncestorPromptParams(input),
      hasOwnPromptAttrs,
      traceNotFound: (id) => new TraceNotFoundError(id),
    } as Omit<
      TracesV2TrpcPorts,
      | "getViewerProtections"
      | "getVisibilityCutoffMs"
      | "mappers"
      | "derivedAttrPrefixes"
      | "codingAgentEnrichment"
      | "queryTranslation"
    >;
  }

  legacyPorts(): ApiTraceLegacyPorts {
    return {
      filterInputSchema: API_TRACE_FILTER_INPUT,
      listInputSchema: API_TRACE_LIST_INPUT,
      evaluatorTypeSchema: evaluatorTypesSchema,
      preconditionSchema: apiPreconditionSchema,
      formatSpansDigest: (spans) => TraceReadableSpanService.formatSpansDigest(spans),
      checkEvaluatorRequiredFields: (input) => this.evaluatorRequiredFieldsMet(input),
      buildPreconditionTraceData: (input) => preconditionTraceData(input),
      evaluatePreconditions: (input) => this.preconditionsHold(input),
    };
  }

  /**
   * Whether the evaluator's own required inputs are present on this trace. Two rules, from two
   * owners.
   */
  private evaluatorRequiredFieldsMet(
    input: Readonly<{
      evaluatorType: string;
      spans: Span[];
      expectedOutput?: { value: string } | null;
    }>,
  ): boolean {
    const definition = getEvaluatorDefinitions(input.evaluatorType);
    if (definition?.requiredFields.includes("expected_output") && !input.expectedOutput?.value) {
      return false;
    }
    return this.preconditions.requiredFieldsArePresent({
      evaluatorType: input.evaluatorType,
      spans: input.spans.map(evaluationSpanOf),
    });
  }

  /** Whether every configured precondition holds for that trace. */
  private preconditionsHold(
    input: Readonly<{ traceData: unknown; preconditions: unknown[] }>,
  ): boolean {
    const traceData = input.traceData as ApiPreconditionTraceData;
    return this.preconditions.areMet({
      data: traceData.data,
      preconditions: input.preconditions,
      spans: traceData.spans,
      // The wizard samples traces, and the sample read carries no tracked
      // events, so an `events.*` precondition is unmet rather than wrongly
      // met — the same answer the read has always given.
      events: null,
    });
  }

  editOverlayRedaction(): {
    redactPatchForViewer: typeof TraceEditOverlayRedactionService.redactPatchForViewer;
    restoreWithheldEdits: typeof TraceEditOverlayRestoreService.restoreWithheldEdits;
  } {
    return {
      redactPatchForViewer: TraceEditOverlayRedactionService.redactPatchForViewer,
      restoreWithheldEdits: TraceEditOverlayRestoreService.restoreWithheldEdits,
    };
  }

  // -------------------------------------------------------------------------
  // The ten readers
  // -------------------------------------------------------------------------

  private composeReaders(): TraceAppDependencies["traces"] {
    const options = this.options;
    const resolve = options.resolveClickHouseClient;
    const enabled = resolve !== null;

    const blobStore = TraceBlobStoreService.create({
      // The v1 spool predates this deployment: a ref written before the
      // stored-object registry existed reads back through S3 directly, and
      // this process composes no such client. `resolveOffloadedTraces`
      // swallows the refusal per field, so such a value keeps its preview
      // rather than failing the whole read.
      resolveS3Client: () => Promise.reject(this.refuse("a v1 spool object read")),
      ...(resolve ? { resolveClickHouseClient: resolve } : {}),
      logger: this.logger,
    });
    const ioExtractionService = TraceIOExtractionService.create(this.canonicalisation);
    const blobResolutionDeps = { blobStore, ioExtractionService };

    const spanStorageRepository = resolve
      ? new SpanStorageClickHouseRepository(resolve as never)
      : new NullSpanStorageRepository();

    const read = TraceLegacyReadService.create({
      traceCanonicalisation: this.canonicalisation,
      traceRead: ClickHouseTraceLegacyReadAdapter.create({
        prisma: options.prisma,
        traceCanonicalisation: this.canonicalisation,
        ...(resolve ? { resolveClickHouseClient: resolve } : {}),
        ...(options.filterConditions ? { filterConditions: options.filterConditions } : {}),
        blobResolutionDeps,
        retentionResolver: options.dataRetention,
      }),
      editOverlay: TraceEditOverlayService.create(
        PrismaTraceEditOverlayRepository.create(options.prisma),
      ),
      logRecordStorage: this.composeLogRecords(),
      // The SAME rule the list beside it follows: a composed capability where
      // the process has one, and a refusal by name where it does not. Left
      // absent, every single-trace read threw a plain Error and answered a 500.
      evaluationService: options.evaluations ?? this.refusingEvaluations(),
    });

    return {
      read: read as unknown as TraceAppDependencies["traces"]["read"],
      list: TraceListService.create({
        repository: enabled
          ? TraceListClickHouseRepository.create(resolve as never)
          : NullTraceListAdapter.create(),
        evaluations: options.evaluations ?? this.refusingEvaluations(),
        topicService: options.topics,
      }) as unknown as TraceAppDependencies["traces"]["list"],
      sessionGroups: SessionGroupsService.create({
        repository: resolve
          ? new SessionGroupsClickHouseRepository(resolve as never)
          : new NullSessionGroupsRepository(),
        codingAgentSessions: options.codingAgents ?? this.refusingCodingAgents(),
        resolveOrganizationId: (projectId) => this.tryResolveOrganizationId(projectId),
      }) as unknown as TraceAppDependencies["traces"]["sessionGroups"],
      spans: SpanStorageService.create({
        repository: spanStorageRepository,
        blobResolutionDeps,
      }) as unknown as TraceAppDependencies["traces"]["spans"],
      summary: TraceSummaryService.create({
        repository: resolve
          ? TraceSummaryClickHouseRepository.create({
              resolveClient: resolve as never,
              defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
            })
          : new NullTraceSummaryRepository(),
        fullResolutionDeps: { spanStorageRepository, ...blobResolutionDeps },
      }) as unknown as TraceAppDependencies["traces"]["summary"],
      tree: this.composeTree(),
      logRecords: this.composeLogRecords(),
      canonicalisation: this.canonicalisation,
      editOverlay: TraceEditOverlayService.create(
        PrismaTraceEditOverlayRepository.create(options.prisma),
      ),
      changeTraceName: () => Promise.reject(this.refuse("the trace rename command")),
    } as TraceAppDependencies["traces"];
  }

  /**
   * The trace TREE read, over the stored spans. Composed with no summary projection, no record
   * reader and no event derivation: this process folds no trace projections, so the reads that
   * would come off one answer empty rather than pretending.
   */
  private composeTree(): TraceTreeService {
    const resolve = this.options.resolveClickHouseClient;
    const modelProviders = this.options.modelProviders;
    if (!resolve || !modelProviders) {
      return refuseAll<TraceTreeService>(
        (capability) => this.refuse(capability),
        "the trace tree read",
      );
    }
    return ClickHouseTraceAdapter.create({
      resolveClient: resolve as never,
      modelProviders,
      queryFieldValues: refuseAll(
        (capability) => this.refuse(capability),
        "the trace query field-value read",
      ),
      queryClassification: TraceQueryClassificationAdapter.create(),
      // This process folds no trace projections, so the reads that would come
      // off one answer nothing rather than pretending: an offloaded payload is
      // not resolvable here, and a full-IO recomputation has no spans of its
      // own to recompute from.
      payloads: UnresolvedTracePayloadReader.create(),
      fullIo: UnrecomputedTraceFullIo.create(),
    }).build();
  }

  private composeLogRecords(): TraceAppDependencies["traces"]["logRecords"] {
    const resolve = this.options.resolveClickHouseClient;
    return LogRecordStorageService.create({
      repository: resolve
        ? new LogRecordStorageClickHouseRepository(resolve as never)
        : new NullLogRecordStorageRepository(),
      // The CANONICAL LOG READ — `LogService.getLogsByTraceId` over the `log_records` table —
      // is the log feature's, and this process composes none.
      canonical: refuseAll((capability) => this.refuse(capability), "the canonical log read"),
    }) as unknown as TraceAppDependencies["traces"]["logRecords"];
  }

  // -------------------------------------------------------------------------
  // The passes
  // -------------------------------------------------------------------------

  private resolveComposerModel(input: { projectId: string; featureKey: string }) {
    const modelProviders = this.options.modelProviders;
    if (!modelProviders) {
      return Promise.reject(this.refuse("the AI composer's model"));
    }
    return ModelProviderExecutionHandleService.getVercelAIModel({
      projectId: input.projectId,
      featureKey: input.featureKey,
      modelProviders,
      projects: this.options.projects,
      executionProxyBaseUrl: this.options.executionProxyBaseUrl,
    });
  }

  private requireIngest(): TraceSpanIngestPort {
    const ingest = this.options.ingest;
    if (!ingest) {
      throw this.refuse("the reserved-metadata write");
    }
    return ingest;
  }

  /**
   * The closest preceding `langwatch.prompt.*` reference for an llm span, found by walking the
   * trace's ancestor / sibling chain.
   */
  private async resolveAncestorPromptParams(input: {
    tenantId: string;
    traceId: string;
    targetSpanId: string;
    occurredAtMs?: number;
    currentParams: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null> {
    const spans = await this.composed.spans.getSpansByTraceId({
      tenantId: input.tenantId,
      traceId: input.traceId,
      ...(input.occurredAtMs !== undefined ? { occurredAtMs: input.occurredAtMs } : {}),
    });

    const lookupSpans: PromptLookupSpan[] = spans.map((span) => ({
      spanId: span.span_id,
      parentSpanId: span.parent_id ?? null,
      startTime: span.timestamps.started_at,
      attributes: flattenParamsToPromptAttributes(span.params as Record<string, unknown> | null),
    }));

    const reference = findPromptReferenceInAncestors({
      targetSpanId: input.targetSpanId,
      spans: lookupSpans,
    });
    if (!reference?.promptHandle) return null;

    const prompt: Record<string, unknown> = { id: reference.promptHandle };
    if (reference.promptVersionNumber != null) {
      prompt.version = { number: reference.promptVersionNumber };
    }
    if (reference.promptVariables) {
      prompt.variables = reference.promptVariables;
    }

    const next: Record<string, unknown> = { ...input.currentParams };
    const langwatch =
      next.langwatch && typeof next.langwatch === "object"
        ? (next.langwatch as Record<string, unknown>)
        : {};
    next.langwatch = { ...langwatch, prompt };
    return next;
  }

  private async tryResolveOrganizationId(projectId: string): Promise<string | undefined> {
    const project = await this.options.projects.tryGetWithTeam(projectId);
    return project?.team?.organizationId ?? undefined;
  }

  private refusingEvaluations(): EvaluationService {
    return refuseAll<EvaluationService>(
      (capability) => this.refuse(capability),
      "the evaluation summaries a trace row is labelled with",
    );
  }

  private refusingCodingAgents(): CodingAgentService {
    return refuseAll<CodingAgentService>(
      (capability) => this.refuse(capability),
      "the coding-agent session join",
    );
  }

  private refuse(capability: string): Error {
    return new ApiTraceCapabilityUnavailableError(this.options.processName, capability);
  }
}

/** An offloaded payload, on a process that resolves none. */
class UnresolvedTracePayloadReader extends TracePayloadReaderPort {
  static create(): UnresolvedTracePayloadReader {
    return new UnresolvedTracePayloadReader();
  }

  tryRead(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

/** Full-IO recomputation, on a process that folds no trace projections. */
class UnrecomputedTraceFullIo extends TraceFullIoPort {
  static create(): UnrecomputedTraceFullIo {
    return new UnrecomputedTraceFullIo();
  }

  recompute(): { input: null; output: null } {
    return { input: null, output: null };
  }
}

/** The platform application's retention floor, stated rather than imported. */
const PLATFORM_DEFAULT_RETENTION_DAYS = 49;

const PROMPT_ATTR_KEYS = [
  "langwatch.prompt.id",
  "langwatch.prompt.handle",
  "langwatch.prompt.version.number",
  "langwatch.prompt.variables",
] as const;

/** Whether an llm span already carries its own `langwatch.prompt.*`. */
function hasOwnPromptAttrs(params: Record<string, unknown> | null): boolean {
  if (!params) return false;
  const flat = flattenParamsToPromptAttributes(params);
  return PROMPT_ATTR_KEYS.some((key) => flat[key] !== undefined);
}

/** The caller's id, where the request carries one. */
function tryActorId(ctx: unknown): string | undefined {
  const candidate = ctx as
    | { tryActor?: () => { id: string } | null; session?: { user?: { id?: string } } }
    | null
    | undefined;
  const actor = candidate?.tryActor?.();
  return actor?.id ?? candidate?.session?.user?.id ?? undefined;
}

/**
 * What one caller may read of one project's captured content. Three independent sources, and
 * they are independent on purpose. Spend follows the caller's own PERMISSION — `cost:view`, the
 * same question the declared check on a cost-oriented read asks.
 */
type ApiTraceProtectionsOptions = ApiTraceReadStackOptions &
  Readonly<{ dataPrivacy: ApiTraceDataPrivacyResolver }>;

class ApiTraceProtections {
  static create(options: ApiTraceProtectionsOptions): ApiTraceProtections {
    return new ApiTraceProtections(options);
  }

  private readonly logger: Logger;
  private readonly window: VisibilityWindowService;

  private constructor(private readonly options: ApiTraceProtectionsOptions) {
    this.logger = createLogger(`${options.processName}:trace-protections`);
    this.window = VisibilityWindowService.create(options.plans);
  }

  /**
   * The plan's cutoff for one project, failing CLOSED. A leak is irreversible and over-blurring
   * is a refresh away, so an unresolvable organization and a plan-store error both apply the
   * free-tier window rather than answering "unbounded".
   */
  async visibilityCutoffMs(projectId: string): Promise<number | null> {
    const dayMs = 24 * 60 * 60 * 1000;
    try {
      const project = await this.options.projects.tryGetWithTeam(projectId);
      const organizationId = project?.team?.organizationId;
      if (!organizationId) {
        this.logger.error(
          { projectId },
          "visibility window failing closed: project resolves to no organization",
        );
        return Date.now() - FREE_VISIBILITY_DAYS * dayMs;
      }
      return await this.window.getVisibilityCutoffMs({ organizationId });
    } catch (error) {
      this.logger.error(
        { projectId, error },
        "visibility window failing closed: plan resolution failed",
      );
      return Date.now() - FREE_VISIBILITY_DAYS * dayMs;
    }
  }

  async resolve(input: {
    projectId: string;
    userId: string | undefined;
    publiclyShared: boolean;
  }): Promise<Protections> {
    const [canSeeCosts, isMember, isAdmin, visibilityCutoffMs] = await Promise.all([
      this.permitted(input, "cost:view"),
      this.permitted(input, "traces:view"),
      this.permitted(input, "project:update"),
      this.visibilityCutoffMs(input.projectId),
    ]);

    let policy: ResolvedDataPrivacy;
    try {
      policy = await this.options.dataPrivacy.getResolvedForProject({
        projectId: input.projectId,
      });
    } catch (error) {
      this.logger.error(
        { error, projectId: input.projectId },
        "data-privacy policy resolution failed; hiding captured content (fail-closed)",
      );
      return {
        canSeeCosts,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        capturedInputVisibleTo: null,
        capturedOutputVisibleTo: null,
        contentCategories: uniformContentCategories(false),
        hiddenAttributes: [{ pattern: "*", visibleTo: "members of this project" }],
        visibilityCutoffMs,
      };
    }

    const restricted = policy.customAttributes.filter((rule) => rule.disposition === "restrict");

    const anonymous = input.publiclyShared || input.userId === undefined;
    const categories = Object.fromEntries(
      CONTENT_CATEGORIES.map((category) => {
        const resolved = policy.categories[category];
        return [
          category,
          {
            canSee: anonymous
              ? isContentVisibleToPublic(resolved)
              : isContentVisible(resolved, {
                  isAdmin,
                  isMember,
                  isMemberRole: isMember,
                  isViewer: isMember && !isAdmin,
                  // Neither is resolvable from this process's graph, and both
                  // widen rather than narrow, so both stay false.
                  isProjectOwner: false,
                  groupIds: [],
                }),
            restrictVisibleTo: restrictLabelFor(resolved),
          },
        ];
      }),
    ) as Protections["contentCategories"];

    const visibleTo = "members of this project";
    return {
      canSeeCosts,
      canSeeCapturedInput: categories?.input.canSee ?? false,
      canSeeCapturedOutput: categories?.output.canSee ?? false,
      capturedInputVisibleTo: categories?.input.restrictVisibleTo ?? null,
      capturedOutputVisibleTo: categories?.output.restrictVisibleTo ?? null,
      contentCategories: categories,
      // Every `restrict` rule is hidden from this reader: resolving whether a
      // named group contains them needs a membership read this process does
      // not compose, and "I do not know" reads as no.
      hiddenAttributes: restricted.map((rule) => ({ pattern: rule.pattern, visibleTo })),
      restrictedAttributes: restricted.map((rule) => ({
        pattern: rule.pattern,
        visibleTo,
        canSee: false,
      })),
      visibilityCutoffMs,
    };
  }

  /**
   * The same, for a share viewer — null when the project is gone, which the
   * read turns into the same generic not-found a bad token gets.
   */
  async tryResolveForShare(input: {
    projectId: string;
    userId: string | undefined;
  }): Promise<Protections | null> {
    const project = await this.options.projects.tryGetWithTeam(input.projectId);
    if (!project) return null;
    return this.resolve({ ...input, publiclyShared: true });
  }

  private async permitted(
    input: { projectId: string; userId: string | undefined },
    permission: "cost:view" | "traces:view" | "project:update",
  ): Promise<boolean> {
    if (input.userId === undefined) return false;
    return this.options.authz.hasPermission({
      userId: input.userId,
      permission,
      projectId: input.projectId,
    });
  }
}

const CONTENT_CATEGORIES = ["input", "output", "system", "tools"] as const;

/** A per-category map where every category shares one decision. */
function uniformContentCategories(canSee: boolean): Protections["contentCategories"] {
  return Object.fromEntries(
    CONTENT_CATEGORIES.map((category: ContentCategory) => [
      category,
      { canSee, restrictVisibleTo: null },
    ]),
  ) as Protections["contentCategories"];
}

/**
 * The audience label for a `restrict` category, whether or not the viewer can
 * see it: it names the audience on a hidden placeholder AND tells an
 * in-audience viewer the content is restricted rather than ordinary.
 */
function restrictLabelFor(category: ResolvedCategory): string | null {
  return category.disposition === "restrict"
    ? describeAudience(category.audience, { groups: {} })
    : null;
}

/** A capability this process did not compose, refused by name at the call. */
class ApiTraceCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string, capability: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { process: processName, capability },
    });
    this.name = "ApiTraceCapabilityUnavailableError";
  }
}

/**
 * A stand-in whose every member refuses by name.
 */
function refuseAll<T>(refuse: (capability: string) => Error, capability: string): T {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw refuse(capability);
      },
      has: () => true,
    },
  ) as T;
}

/** The platform default retention, kept beside the composition that states it. */
export const API_TRACE_DEFAULT_RETENTION_DAYS = PLATFORM_DEFAULT_RETENTION_DAYS;
