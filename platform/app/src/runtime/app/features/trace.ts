import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type {
  TraceByIdInput,
  TraceDerivedEventsInput,
  RecordSpanCommandData,
  TraceListRepository,
  TraceService,
  TraceSummaryData,
  NormalizedSpan,
} from "@langwatch/trace-contract";
import { TraceNotFoundError, traceRecordSchema } from "@langwatch/trace-contract";
import {
  ClickHouseTraceAdapter,
  NullTraceListAdapter,
  TraceIngestionService,
  TraceIngressCommandPort,
  TraceIngressPayloadPort,
  TraceListClickHouseRepository,
  TraceQueryClassificationAdapter,
  TraceSpanDedupPort,
  TraceSummaryReaderPort,
  TraceEventDerivationPort,
  TraceRecordPort,
  TracePayloadReaderPort,
  TraceFullIoPort,
  type TraceQueryFieldValuesPort,
  type TraceClickHouseResolver,
} from "@langwatch/trace-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { getProtectionsForProject } from "~/server/api/utils";
import { TraceReadDerivationService } from "~/server/app-layer/traces/trace-read-derivation.service";
import type { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import type { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { TraceService as LegacyTraceService } from "~/server/traces/trace.service";
import type {
  Protections,
  SharedTraceTrpcPorts,
  TracesV2ReadPorts,
  TracesV2TrpcPorts,
} from "@langwatch/trace-server";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import { Prisma } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { getUserProtectionsForProject, getVisibilityCutoffMsForProject } from "~/server/api/utils";
import {
  generateTraceAction,
  generateTraceQueryFromPrompt,
} from "~/server/app-layer/traces/ai-query";
import {
  enrichCodingAgentSpansFromLogs,
  enrichSingleSpanWithClaudeLogContent,
  isCodingAgentShapedSpan,
  mapSummaryRowsToClaudeRefs,
} from "~/server/app-layer/traces/claude-code-log-enrichment";
import type { ClaudeSpanRef } from "~/server/app-layer/traces/claude-code-span-enrichment";
import { TraceNotFoundError as AppTraceNotFoundError } from "~/server/app-layer/traces/errors";
import {
  DERIVED_INPUT_ATTR_PREFIX,
  DERIVED_OUTPUT_ATTR_PREFIX,
} from "~/server/app-layer/traces/log-content-derivation";
import { deriveUnmappedCostSuggestion } from "~/server/app-layer/traces/model-cost-span-preview.service";
import {
  traceMetadataUpdateSchema,
  updateTraceMetadata,
  type TraceMetadataUpdate,
} from "~/server/app-layer/traces/trace-metadata.service";
import {
  CONTENT_KEY_CATALOG,
  PRIVACY_DROPPED_MARKER_ATTR,
  PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
  stripRolesFromChatArrayJson,
} from "~/server/data-privacy/dropKeyCatalog";
import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import { prisma } from "~/server/db";
import { rateLimit } from "~/server/rateLimit";
import {
  findPromptReferenceInAncestors,
  flattenParamsToPromptAttributes,
  type PromptLookupSpan,
} from "~/server/traces/findPromptReferenceInAncestors";
import {
  applyDerivedTraceEventProtections,
  applySpanProtections,
  extractRedactionsFromAllSpanInputs,
  extractRedactionsFromAllSpanOutputs,
  redactObject,
} from "~/server/traces/mappers/redaction";
import { buildDisplayInput, stringifySpanIO } from "@langwatch/trace-contract";
import { getClientIp } from "~/utils/getClientIp";

class AppTraceIngressCommandAdapter extends TraceIngressCommandPort {
  private constructor(private readonly dispatch: (data: RecordSpanCommandData) => Promise<void>) {
    super();
  }

  static create(
    dispatch: (data: RecordSpanCommandData) => Promise<void>,
  ): AppTraceIngressCommandAdapter {
    return new AppTraceIngressCommandAdapter(dispatch);
  }

  recordSpan(data: RecordSpanCommandData): Promise<void> {
    return this.dispatch(data);
  }
}

class AppTraceIngressPayloadAdapter extends TraceIngressPayloadPort {
  private constructor(
    private readonly prepareData: (data: RecordSpanCommandData) => Promise<RecordSpanCommandData>,
  ) {
    super();
  }

  static create(
    prepareData: (data: RecordSpanCommandData) => Promise<RecordSpanCommandData>,
  ): AppTraceIngressPayloadAdapter {
    return new AppTraceIngressPayloadAdapter(prepareData);
  }

  prepare(data: RecordSpanCommandData): Promise<RecordSpanCommandData> {
    return this.prepareData(data);
  }
}

export class AppTraceSummaryReaderAdapter extends TraceSummaryReaderPort {
  private constructor(private readonly store: FoldProjectionStore<TraceSummaryData>) {
    super();
  }

  static create(store: FoldProjectionStore<TraceSummaryData>): AppTraceSummaryReaderAdapter {
    return new AppTraceSummaryReaderAdapter(store);
  }

  tryGetSummary(input: { tenantId: string; traceId: string }): Promise<TraceSummaryData | null> {
    return this.store.get(input.traceId, {
      aggregateId: input.traceId,
      tenantId: createTenantId(input.tenantId),
    });
  }
}

class AppTraceRecordAdapter extends TraceRecordPort {
  private readonly protectionsInFlight = new Map<string, Promise<Protections>>();

  private constructor(
    private readonly database: PrismaClient,
    private readonly traces: LegacyTraceService,
  ) {
    super();
  }

  static create(database: PrismaClient, traces: LegacyTraceService): AppTraceRecordAdapter {
    return new AppTraceRecordAdapter(database, traces);
  }

  async getById(input: TraceByIdInput) {
    const protections = await this.protections(input.projectId);
    const trace = await this.traces.getById(input.projectId, input.traceId, protections);
    if (!trace) {
      throw new TraceNotFoundError(input.traceId);
    }

    return traceRecordSchema.parse(trace);
  }

  private protections(projectId: string): Promise<Protections> {
    const inFlight = this.protectionsInFlight.get(projectId);
    if (inFlight) {
      return inFlight;
    }

    const protections = getProtectionsForProject(this.database, { projectId }).finally(() => {
      this.protectionsInFlight.delete(projectId);
    });
    this.protectionsInFlight.set(projectId, protections);

    return protections;
  }
}

class AppTraceEventDerivationAdapter extends TraceEventDerivationPort {
  private constructor(private readonly derivation: TraceReadDerivationService) {
    super();
  }

  static create(spans: SpanStorageService): AppTraceEventDerivationAdapter {
    return new AppTraceEventDerivationAdapter(new TraceReadDerivationService(spans));
  }

  derive(input: TraceDerivedEventsInput) {
    return this.derivation.deriveEvents({
      tenantId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
      foldVersion: input.foldVersion,
    });
  }
}

/** App-owned event_log adapter; the Trace package sees only its named read port. */
class AppTracePayloadReaderAdapter extends TracePayloadReaderPort {
  private constructor(private readonly blobStore: BlobStore) {
    super();
  }

  static create(blobStore: BlobStore): AppTracePayloadReaderAdapter {
    return new AppTracePayloadReaderAdapter(blobStore);
  }

  async tryRead(input: {
    tenantId: string;
    traceId: string;
    eventId: string;
    field: string;
  }): Promise<string | null> {
    try {
      return await this.blobStore.getFromEventLog({
        eventId: input.eventId,
        field: input.field,
        tenantId: input.tenantId,
        aggregateType: "trace",
        aggregateId: input.traceId,
      });
    } catch {
      return null;
    }
  }
}

class AppTraceFullIoAdapter extends TraceFullIoPort {
  private constructor(private readonly extraction: TraceIOExtractionService) {
    super();
  }

  static create(extraction: TraceIOExtractionService): AppTraceFullIoAdapter {
    return new AppTraceFullIoAdapter(extraction);
  }

  recompute(spans: NormalizedSpan[]) {
    const input = this.extraction.extractFirstInput(spans);
    const output = this.extraction.extractLastOutput(spans);
    return {
      input: input ? { type: "text", value: input.text } : null,
      output: output ? { type: "text", value: output.text } : null,
    };
  }
}

export type AppTraceRuntimeOptions = {
  database: PrismaClient;
  records: LegacyTraceService;
  spans: SpanStorageService;
  blobStore: BlobStore;
  fullIo: TraceIOExtractionService;
  resolveClient: TraceClickHouseResolver;
  modelProviders: ModelProviderService;
  queryFieldValues: TraceQueryFieldValuesPort;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
};

/** App composition for the process-owned Trace service. */
export class AppTraceRuntime {
  private constructor(private readonly options: AppTraceRuntimeOptions) {}

  static create(options: AppTraceRuntimeOptions): AppTraceRuntime {
    return new AppTraceRuntime(options);
  }

  static createNull(modelProviders: ModelProviderService): TraceService {
    return ClickHouseTraceAdapter.createNull(modelProviders);
  }

  static createListRepository(resolveClient: TraceClickHouseResolver): TraceListRepository {
    return TraceListClickHouseRepository.create(resolveClient);
  }

  static createNullListRepository(): TraceListRepository {
    return NullTraceListAdapter.create();
  }

  static createIngestion(options: {
    codingAgents: CodingAgentService;
    codingAgentSpanFilterEnabled: boolean;
    dedup: TraceSpanDedupPort;
    recordSpan: (data: RecordSpanCommandData) => Promise<void>;
    payloads?: TraceIngressPayloadPort;
  }): TraceIngestionService {
    return TraceIngestionService.create({
      codingAgents: options.codingAgents,
      codingAgentSpanFilterEnabled: options.codingAgentSpanFilterEnabled,
      dedup: options.dedup,
      commands: AppTraceIngressCommandAdapter.create(options.recordSpan),
      payloads: options.payloads,
    });
  }

  static createIngressPayloadPort(
    prepare: (data: RecordSpanCommandData) => Promise<RecordSpanCommandData>,
  ): TraceIngressPayloadPort {
    return AppTraceIngressPayloadAdapter.create(prepare);
  }

  build(): TraceService {
    return ClickHouseTraceAdapter.create({
      ...this.options,
      queryClassification: TraceQueryClassificationAdapter.create(),
      summaryReader: AppTraceSummaryReaderAdapter.create(this.options.traceSummaryStore),
      records: AppTraceRecordAdapter.create(this.options.database, this.options.records),
      eventDerivation: AppTraceEventDerivationAdapter.create(this.options.spans),
      payloads: AppTracePayloadReaderAdapter.create(this.options.blobStore),
      fullIo: AppTraceFullIoAdapter.create(this.options.fullIo),
    }).build();
  }
}

// ---------------------------------------------------------------------------
// Trace-view transport ports
// ---------------------------------------------------------------------------

/**
 * The capabilities `@langwatch/trace-server`'s two trace-view transports
 * (`tracesV2.*` and the anonymous `sharedTrace.get`) need that Trace does not
 * own, assembled once here.
 *
 * Every entry belongs to another vertical: the viewer's protections and the
 * plan window, the AI composer's model providers, Data Privacy's content-key
 * catalog and per-span markers, the legacy trace read's span display and
 * redaction passes, the reserved-metadata write, the unmapped-cost rule
 * lookup, the coding-agent log join and the prompt-ancestor walk. They are
 * injected rather than imported by the package so the transports could move
 * without dragging six features' modules with them.
 *
 * Assembled here rather than at the mount because both doors need the same
 * object: `root.ts` mounts the tRPC routers, and the REST transcript route
 * (`GET /api/traces/:traceId/transcript`) calls the same shared reader. One
 * definition is what keeps the two from drifting on redaction.
 */
export function createTraceViewReadPorts(): TracesV2ReadPorts {
  return {
    getVisibilityCutoffMs: (projectId) => getVisibilityCutoffMsForProject(projectId),
    derivedAttrPrefixes: {
      input: DERIVED_INPUT_ATTR_PREFIX,
      output: DERIVED_OUTPUT_ATTR_PREFIX,
    },
    mappers: {
      spanDisplay: { buildDisplayInput, stringifySpanIO },
      spanProtection: {
        applySpanProtections,
        extractRedactionsFromAllSpanInputs,
        extractRedactionsFromAllSpanOutputs,
        redactObject,
        applyDerivedTraceEventProtections,
      },
      contentPrivacy: {
        contentKeyCatalog: CONTENT_KEY_CATALOG,
        droppedMarkerAttribute: PRIVACY_DROPPED_MARKER_ATTR,
        piiIncompleteMarkerAttribute: PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
        stripRolesFromChatArrayJson,
        getResolvedPolicyForProject: (input) =>
          getDataPrivacyPolicyService().getResolvedForProject(input),
      },
    },
    codingAgentEnrichment: {
      isCodingAgentShapedSpan,
      enrichSpansFromLogs: (input) => enrichCodingAgentSpansFromLogs(input),
      enrichSingleSpanWithLogContent: (input) =>
        enrichSingleSpanWithClaudeLogContent({
          ...input,
          modelCallRefs: input.modelCallRefs as ClaudeSpanRef[],
        }),
      mapSummaryRowsToRefs: mapSummaryRowsToClaudeRefs,
    },
  };
}

/**
 * The `tracesV2.*` ports: the shared read ports above, plus the ones only the
 * authenticated explorer needs — the per-request viewer protections, the AI
 * composer, the reserved-metadata write, the unmapped-cost suggestion, the
 * prompt-ancestor walk and the application's `trace_not_found` error.
 */
export function createTracesV2TrpcPorts(): TracesV2TrpcPorts<TraceMetadataUpdate, unknown> {
  return {
    ...createTraceViewReadPorts(),
    getViewerProtections: (ctx, input) => getUserProtectionsForProject(ctx as never, input),
    runAiQuery: (input, ctx) =>
      generateTraceQueryFromPrompt({
        ...input,
        modelProviders: (ctx as TraceAiComposerContext).app.modelProviders,
        managedProviders: (ctx as TraceAiComposerContext).app.managedProviders,
        traces: (ctx as TraceAiComposerContext).app.traces.tree,
      }),
    runAiAction: (input, ctx) =>
      generateTraceAction({
        ...input,
        modelProviders: (ctx as TraceAiComposerContext).app.modelProviders,
        managedProviders: (ctx as TraceAiComposerContext).app.managedProviders,
        traces: (ctx as TraceAiComposerContext).app.traces.tree,
      }),
    traceMetadataUpdateSchema,
    updateTraceMetadata,
    deriveUnmappedCostSuggestion,
    resolveAncestorPromptParams: enrichLlmSpanWithAncestorPrompt,
    hasOwnPromptAttrs,
    traceNotFound: (id) => new AppTraceNotFoundError(id),
  };
}

/** The parts of the request context the AI composer reads. */
type TraceAiComposerContext = {
  app: {
    modelProviders: ModelProviderService;
    managedProviders: ManagedProviderService;
    traces: { tree: TraceService };
  };
};

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
  return PROMPT_ATTR_KEYS.some((k) => flat[k] !== undefined);
}

/**
 * Resolves the closest preceding `langwatch.prompt.*` reference for an llm
 * span by walking the trace's ancestor / sibling chain — same heuristic
 * `getSpanForPromptStudio` uses on the legacy path. Returns the llm span's
 * params merged with the resolved prompt attributes (in nested-object form
 * matching the rest of `params`), or null when nothing was found so the
 * caller can skip the assignment.
 */
async function enrichLlmSpanWithAncestorPrompt({
  tenantId,
  traceId,
  targetSpanId,
  occurredAtMs,
  currentParams,
}: {
  tenantId: string;
  traceId: string;
  targetSpanId: string;
  occurredAtMs?: number;
  currentParams: Record<string, unknown> | null;
}): Promise<Record<string, unknown> | null> {
  const app = getApp();
  const allSpans = await app.traces.readSpans({
    projectId: tenantId,
    traceId,
    ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
  });

  const lookupSpans: PromptLookupSpan[] = allSpans.map((s) => ({
    spanId: s.span_id,
    parentSpanId: s.parent_id ?? null,
    startTime: s.timestamps.started_at,
    attributes: flattenParamsToPromptAttributes(s.params as Record<string, unknown> | null),
  }));

  const ref = findPromptReferenceInAncestors({
    targetSpanId,
    spans: lookupSpans,
  });
  if (!ref?.promptHandle) return null;

  const promptNode: Record<string, unknown> = {
    id: ref.promptHandle,
  };
  if (ref.promptVersionNumber != null) {
    promptNode.version = { number: ref.promptVersionNumber };
  }
  if (ref.promptVariables) {
    promptNode.variables = ref.promptVariables;
  }

  const next: Record<string, unknown> = { ...(currentParams ?? {}) };
  const langwatch =
    next.langwatch && typeof next.langwatch === "object"
      ? (next.langwatch as Record<string, unknown>)
      : {};
  next.langwatch = { ...langwatch, prompt: promptNode };
  return next;
}

/**
 * The ports for the anonymous `sharedTrace.get` read: the shared mappers, the
 * share viewer's protections, the process's rate limiter and client-IP
 * resolution, and the trace-missing predicate that turns a deleted trace into
 * the same generic not-found a bad token gets.
 */
export function createSharedTraceTrpcPorts(): SharedTraceTrpcPorts {
  return {
    mappers: createTraceViewReadPorts().mappers,
    tryGetShareViewerProtections: async ({ projectId, session }) => {
      try {
        return await getUserProtectionsForProject(
          { prisma, session, publiclyShared: true } as never,
          { projectId },
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          return null;
        }
        throw error;
      }
    },
    rateLimit,
    getClientIp: (req) => getClientIp(req as never),
    isTraceNotFound: (error) => AppTraceNotFoundError.is(error),
  };
}
