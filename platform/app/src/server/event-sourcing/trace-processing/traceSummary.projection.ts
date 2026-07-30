import type { RowMapping } from "@langwatch/clickhouse";
import { z } from "zod";
import {
  applyOriginSpan,
  extractOriginSignals,
  initOriginState,
  legacyMarkerStripping,
  resolveOrigin,
} from "./originClassification";
import type {
  AnnotationRef,
  AnnotationsBulkSync,
  CanonicalSpan,
  LogContribution,
  MetricCorrelation,
  OriginResolution,
  TopicAssignment,
  TraceNameChange,
} from "./schema";
import {
  addPIISpanId,
  applyAnnotationBulkSync,
  applyAnnotationChange,
  attributeValues,
  betterErrorMessage,
  betterIOCandidate,
  emptyAnnotationState,
  emptyPIISpanIdSet,
  isLaterPrompt,
  isRootSpan,
  laterStampWins,
  mergeAttribute,
  mergeModelUsage,
  mergeNameCandidate,
  mergeTimeSpan,
  orderedModels,
  presentAnnotationIds,
  spanContainsAi,
  spanType as spanTypeOf,
  topicKey,
} from "./spanDerivation";
import type { TraceSummariesRow, traceSummariesTable } from "./table";

/**
 * The `traceSummary` fold: everything about a trace that is not a total. Every
 * field is a lattice maximum, a set union, or last-write-wins on a stamp our
 * own boundary set, so the state is a function of the SET of events (ADR-098
 * §4). Counts, costs and token sums are `totals.ts`'s query over the spans
 * themselves (ADR-103).
 */

/**
 * Pinned to the version already stamped on every live `trace_summaries` row
 * (the retired tree's trace-processing constants,
 * `TRACE_SUMMARY_PROJECTION_VERSION_LATEST`), per ADR-105 decision 9 — an
 * unpinned derived hash would fail every row's version gate on deploy.
 */
export const TRACE_SUMMARY_STATE_VERSION = "2026-05-07";

const PROMPT_ID_ATTR = "langwatch.prompt_ids";
const LABELS_ATTR = "langwatch.labels";
const PII_PARTIAL_ATTR = "langwatch.reserved.pii_redaction_partial_span_ids";
const PII_SKIPPED_ATTR = "langwatch.reserved.pii_redaction_skipped_span_ids";
const ORIGIN_ATTR = "langwatch.origin";
const PLATFORM_ATTR = "langwatch.platform";
const SCENARIO_RUNNER_LABEL = "scenario-runner";
const TTFT_METRIC = "gen_ai.server.time_to_first_token";

const nameCandidateSchema = z.object({
  spanId: z.string(),
  startTimeMs: z.number(),
  name: z.string(),
  spanType: z.string().nullable(),
});

const errorMessageCandidateSchema = z.object({
  message: z.string(),
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  spanId: z.string(),
});

const ioCandidateSchema = z.object({
  text: z.string(),
  tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  endTimeMs: z.number(),
  spanId: z.string(),
});

const promptCandidateSchema = z.object({
  promptId: z.string(),
  versionId: z.string().nullable(),
  versionNumber: z.number().nullable(),
  spanId: z.string(),
  startTimeMs: z.number(),
});

const piiSpanIdSetSchema = z.object({
  ids: z.set(z.string()),
  overflowed: z.boolean(),
});

const originStateSchema = z.object({
  rootOriginSpanId: z.string().nullable(),
  rootOrigin: z.string().nullable(),
  nonRootOriginSpanId: z.string().nullable(),
  nonRootOrigin: z.string().nullable(),
  hasEvaluationScope: z.boolean(),
  hasScenarioScope: z.boolean(),
  hasOptimizationStudioPlatform: z.boolean(),
  hasScenarioRunnerLabel: z.boolean(),
  hasScenarioLabelsResource: z.boolean(),
  hasEvaluationRunId: z.boolean(),
  metadataPlatform: z.string().nullable(),
  metadataPlatformSpanId: z.string().nullable(),
});

export const traceSummaryStateSchema = z.object({
  traceId: z.string(),

  /** Running minimum of span starts, and the row's partition anchor. */
  occurredAt: z.number(),
  /** Maintained as `max(end) - min(start)`, so it is a lattice, not a sum. */
  totalDurationMs: z.number(),

  computedInput: ioCandidateSchema.nullable(),
  computedOutput: ioCandidateSchema.nullable(),

  timeToFirstTokenMs: z.number().nullable(),
  timeToLastTokenMs: z.number().nullable(),

  containsErrorStatus: z.boolean(),
  containsOKStatus: z.boolean(),
  errorMessage: errorMessageCandidateSchema.nullable(),

  modelUsage: z.map(z.string(), z.number()),

  blockedByGuardrail: z.boolean(),
  containsAi: z.boolean(),
  containsPrompt: z.boolean(),
  selectedPrompt: promptCandidateSchema.nullable(),
  lastUsedPrompt: promptCandidateSchema.nullable(),

  rootCandidate: nameCandidateSchema.nullable(),
  fallbackCandidate: nameCandidateSchema.nullable(),
  traceNameOverride: z.string().nullable(),
  traceNameChangedAt: z.number(),

  topicId: z.string().nullable(),
  subTopicId: z.string().nullable(),
  topicAssignedAt: z.number(),

  annotations: z.object({
    changes: z.map(
      z.string(),
      z.object({ present: z.boolean(), actedAt: z.number() }),
    ),
    sync: z
      .object({ ids: z.array(z.string()), actedAt: z.number() })
      .nullable(),
  }),
  attributes: z.map(
    z.string(),
    z.object({ value: z.string(), spanId: z.string() }),
  ),
  labels: z.set(z.string()),
  promptIds: z.set(z.string()),

  origin: originStateSchema,

  piiPartialSpanIds: piiSpanIdSetSchema,
  piiSkippedSpanIds: piiSpanIdSetSchema,
});

export type TraceSummaryState = z.infer<typeof traceSummaryStateSchema>;

export function initTraceSummaryState(): TraceSummaryState {
  return {
    traceId: "",
    occurredAt: 0,
    totalDurationMs: 0,
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    containsErrorStatus: false,
    containsOKStatus: false,
    errorMessage: null,
    modelUsage: new Map(),
    blockedByGuardrail: false,
    containsAi: false,
    containsPrompt: false,
    selectedPrompt: null,
    lastUsedPrompt: null,
    rootCandidate: null,
    fallbackCandidate: null,
    traceNameOverride: null,
    traceNameChangedAt: 0,
    topicId: null,
    subTopicId: null,
    topicAssignedAt: 0,
    annotations: emptyAnnotationState(),
    attributes: new Map(),
    labels: new Set(),
    promptIds: new Set(),
    origin: initOriginState(),
    piiPartialSpanIds: emptyPIISpanIdSet(),
    piiSkippedSpanIds: emptyPIISpanIdSet(),
  };
}

function spanTiming(
  state: TraceSummaryState,
  span: CanonicalSpan,
): Pick<TraceSummaryState, "occurredAt" | "totalDurationMs"> {
  const merged = mergeTimeSpan(
    { startMs: state.occurredAt, durationMs: state.totalDurationMs },
    span,
  );
  return { occurredAt: merged.startMs, totalDurationMs: merged.durationMs };
}

function errorMessageOf(
  span: CanonicalSpan,
): { message: string; rank: 1 | 2 | 3 } | null {
  if (span.exceptionMessage) {
    return { message: span.exceptionMessage, rank: 3 };
  }
  const attribute =
    span.attributes["exception.message"] ?? span.attributes["error.message"];
  if (typeof attribute === "string" && attribute.length > 0) {
    return { message: attribute, rank: 2 };
  }
  if (span.statusCode === "ERROR" && span.statusMessage) {
    return { message: span.statusMessage, rank: 1 };
  }
  return null;
}

function ioCandidates(
  state: TraceSummaryState,
  span: CanonicalSpan,
): Pick<TraceSummaryState, "computedInput" | "computedOutput"> {
  const tier = (explicit: boolean): 0 | 1 | 2 =>
    isRootSpan(span) ? 2 : explicit ? 1 : 0;

  return {
    computedInput: betterIOCandidate(
      state.computedInput,
      span.io.inputText === null
        ? null
        : {
            text: span.io.inputText,
            tier: tier(span.io.inputIsExplicit),
            endTimeMs: span.endTimeUnixMs,
            spanId: span.spanId,
          },
    ),
    computedOutput: betterIOCandidate(
      state.computedOutput,
      span.io.outputText === null
        ? null
        : {
            text: span.io.outputText,
            tier: tier(span.io.outputIsExplicit),
            endTimeMs: span.endTimeUnixMs,
            spanId: span.spanId,
          },
    ),
  };
}

function nameCandidates(
  state: TraceSummaryState,
  span: CanonicalSpan,
): Pick<TraceSummaryState, "rootCandidate" | "fallbackCandidate"> {
  if (!span.name) {
    return {
      rootCandidate: state.rootCandidate,
      fallbackCandidate: state.fallbackCandidate,
    };
  }
  const candidate = {
    spanId: span.spanId,
    startTimeMs: span.startTimeUnixMs,
    name: span.name,
    spanType: spanTypeOf(span),
  };
  return isRootSpan(span)
    ? {
        rootCandidate: mergeNameCandidate(state.rootCandidate, candidate),
        fallbackCandidate: state.fallbackCandidate,
      }
    : {
        rootCandidate: state.rootCandidate,
        fallbackCandidate: mergeNameCandidate(
          state.fallbackCandidate,
          candidate,
        ),
      };
}

function attributeAccumulators(
  state: TraceSummaryState,
  span: CanonicalSpan,
): Pick<TraceSummaryState, "attributes" | "labels" | "promptIds"> {
  let attributes = state.attributes;
  for (const [key, value] of Object.entries(span.attributes)) {
    if (key === LABELS_ATTR || key === PROMPT_ID_ATTR) continue;
    if (key.startsWith("langwatch.reserved.")) continue;
    attributes = mergeAttribute(attributes, key, String(value), span.spanId);
  }
  return {
    attributes,
    labels: unionStrings(state.labels, span.attributes[LABELS_ATTR]),
    promptIds: unionStrings(state.promptIds, span.attributes[PROMPT_ID_ATTR]),
  };
}

function unionStrings(current: Set<string>, raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return current;
  const next = new Set(current);
  for (const value of raw) if (typeof value === "string") next.add(value);
  return next;
}

function promptTracking(
  state: TraceSummaryState,
  span: CanonicalSpan,
): Pick<
  TraceSummaryState,
  "containsPrompt" | "selectedPrompt" | "lastUsedPrompt"
> {
  if (!span.prompt) {
    return {
      containsPrompt: state.containsPrompt,
      selectedPrompt: state.selectedPrompt,
      lastUsedPrompt: state.lastUsedPrompt,
    };
  }
  const candidate = {
    promptId: span.prompt.promptId,
    versionId: span.prompt.versionId,
    versionNumber: span.prompt.versionNumber,
    spanId: span.spanId,
    startTimeMs: span.startTimeUnixMs,
  };
  // `selectedPrompt` is the earliest prompt the trace used, `lastUsedPrompt`
  // the latest — two running extremes over `(startTimeMs, spanId)`.
  const isEarlier =
    state.selectedPrompt === null ||
    span.startTimeUnixMs < state.selectedPrompt.startTimeMs ||
    (span.startTimeUnixMs === state.selectedPrompt.startTimeMs &&
      span.spanId < state.selectedPrompt.spanId);
  return {
    containsPrompt: true,
    selectedPrompt: isEarlier ? candidate : state.selectedPrompt,
    lastUsedPrompt: isLaterPrompt(state.lastUsedPrompt, candidate)
      ? candidate
      : state.lastUsedPrompt,
  };
}

export function handleSpanReceived(
  state: TraceSummaryState,
  span: CanonicalSpan,
): TraceSummaryState {
  const error = errorMessageOf(span);

  return {
    ...state,
    // `init()` cannot know the fold's own key; the store derives the row's key
    // from its own `key` parameter, so this is informational only.
    traceId: state.traceId || span.traceId,
    ...spanTiming(state, span),
    ...ioCandidates(state, span),
    ...nameCandidates(state, span),
    ...attributeAccumulators(state, span),
    ...promptTracking(state, span),
    errorMessage: betterErrorMessage(
      state.errorMessage,
      error ? { ...error, spanId: span.spanId } : null,
    ),
    containsErrorStatus:
      state.containsErrorStatus ||
      span.statusCode === "ERROR" ||
      error !== null,
    containsOKStatus: state.containsOKStatus || span.statusCode === "OK",
    modelUsage: span.model
      ? mergeModelUsage(state.modelUsage, span.model, span.startTimeUnixMs)
      : state.modelUsage,
    timeToFirstTokenMs: smallest(
      state.timeToFirstTokenMs,
      span.timeToFirstTokenMs,
    ),
    timeToLastTokenMs: largest(state.timeToLastTokenMs, span.timeToLastTokenMs),
    blockedByGuardrail:
      state.blockedByGuardrail || spanTypeOf(span) === "guardrail",
    containsAi: state.containsAi || spanContainsAi(span),
    origin: applyOriginSpan(state.origin, extractOriginSignals(span)),
    piiPartialSpanIds:
      span.piiRedactionStatus === "partial"
        ? addPIISpanId(state.piiPartialSpanIds, span.spanId)
        : state.piiPartialSpanIds,
    piiSkippedSpanIds:
      span.piiRedactionStatus === "none"
        ? addPIISpanId(state.piiSkippedSpanIds, span.spanId)
        : state.piiSkippedSpanIds,
  };
}

/** LWW on the assigner's own stamp; a tie is broken on the topic id itself. */
export function handleTopicAssigned(
  state: TraceSummaryState,
  data: TopicAssignment,
): TraceSummaryState {
  const wins = laterStampWins(
    {
      stamp: state.topicAssignedAt,
      value: topicKey(state.topicId, state.subTopicId),
    },
    { stamp: data.assignedAt, value: topicKey(data.topicId, data.subtopicId) },
  );
  if (!wins) return state;
  return {
    ...state,
    topicId: data.topicId,
    subTopicId: data.subtopicId,
    topicAssignedAt: data.assignedAt,
  };
}

/** The resolving command addresses the whole trace, so it folds as a root signal. */
export function handleOriginResolved(
  state: TraceSummaryState,
  data: OriginResolution,
): TraceSummaryState {
  return {
    ...state,
    origin: applyOriginSpan(state.origin, {
      spanId: `origin-resolved:${data.traceId}`,
      isRoot: true,
      explicitOrigin: data.origin,
    }),
  };
}

export function handleAnnotationAdded(
  state: TraceSummaryState,
  data: AnnotationRef,
): TraceSummaryState {
  return {
    ...state,
    annotations: applyAnnotationChange(
      state.annotations,
      data.annotationId,
      true,
      data.actedAt,
    ),
  };
}

export function handleAnnotationRemoved(
  state: TraceSummaryState,
  data: AnnotationRef,
): TraceSummaryState {
  return {
    ...state,
    annotations: applyAnnotationChange(
      state.annotations,
      data.annotationId,
      false,
      data.actedAt,
    ),
  };
}

export function handleAnnotationsBulkSynced(
  state: TraceSummaryState,
  data: AnnotationsBulkSync,
): TraceSummaryState {
  return {
    ...state,
    annotations: applyAnnotationBulkSync(
      state.annotations,
      data.annotationIds,
      data.actedAt,
    ),
  };
}

/** A rename carries its own stamp; a tie is broken on the name itself. */
export function handleTraceNameChanged(
  state: TraceSummaryState,
  data: TraceNameChange,
): TraceSummaryState {
  const wins = laterStampWins(
    { stamp: state.traceNameChangedAt, value: state.traceNameOverride ?? "" },
    { stamp: data.changedAt, value: data.newName },
  );
  if (!wins) return state;
  return {
    ...state,
    traceNameOverride: data.newName,
    traceNameChangedAt: data.changedAt,
  };
}

/** A log record contributes trace-level output text, nothing else. */
export function handleLogContributed(
  state: TraceSummaryState,
  data: LogContribution,
): TraceSummaryState {
  if (!data.body) return state;
  return {
    ...state,
    computedOutput: betterIOCandidate(state.computedOutput, {
      text: data.body,
      tier: 0,
      endTimeMs: data.timeUnixMs,
      spanId: data.spanId,
    }),
  };
}

/** A correlated exemplar can supply a time-to-first-token reading of its own. */
export function handleMetricDataPointCorrelated(
  state: TraceSummaryState,
  data: MetricCorrelation,
): TraceSummaryState {
  if (data.metricName !== TTFT_METRIC || data.exemplarValue === null) {
    return state;
  }
  return {
    ...state,
    timeToFirstTokenMs: smallest(state.timeToFirstTokenMs, data.exemplarValue),
  };
}

function smallest(
  current: number | null,
  candidate: number | null,
): number | null {
  if (candidate === null) return current;
  return current === null ? candidate : Math.min(current, candidate);
}

function largest(
  current: number | null,
  candidate: number | null,
): number | null {
  if (candidate === null) return current;
  return current === null ? candidate : Math.max(current, candidate);
}

export interface TraceSummaryView {
  readonly traceId: string;
  readonly occurredAt: number;
  readonly totalDurationMs: number;
  readonly computedInput: string | null;
  readonly computedOutput: string | null;
  readonly timeToFirstTokenMs: number | null;
  readonly timeToLastTokenMs: number | null;
  readonly containsErrorStatus: boolean;
  readonly containsOKStatus: boolean;
  readonly errorMessage: string | null;
  readonly models: readonly string[];
  readonly blockedByGuardrail: boolean;
  readonly containsAi: boolean;
  readonly containsPrompt: boolean;
  readonly selectedPrompt: TraceSummaryState["selectedPrompt"];
  readonly lastUsedPrompt: TraceSummaryState["lastUsedPrompt"];
  readonly traceName: string;
  readonly rootSpanType: string | null;
  readonly rootSpanStartTimeMs: number | null;
  readonly traceNameFromFallback: boolean;
  readonly topicId: string | null;
  readonly subTopicId: string | null;
  readonly annotationIds: readonly string[];
  readonly attributes: Record<string, string>;
}

/** Everything computed from state at read time, never stored as state. */
export function deriveTraceSummaryView(
  state: TraceSummaryState,
): TraceSummaryView {
  const rootOrFallback = state.rootCandidate ?? state.fallbackCandidate;
  const origin = resolveOrigin(state.origin);
  const stripping = legacyMarkerStripping(state.origin);

  const attributes = attributeValues(state.attributes);
  if (origin !== null) attributes[ORIGIN_ATTR] = origin;
  if (stripping.stripPlatform) delete attributes[PLATFORM_ATTR];

  const labels = stripping.stripScenarioRunnerLabel
    ? [...state.labels].filter((label) => label !== SCENARIO_RUNNER_LABEL)
    : [...state.labels];
  if (labels.length > 0) attributes[LABELS_ATTR] = JSON.stringify(labels);
  if (state.promptIds.size > 0) {
    attributes[PROMPT_ID_ATTR] = JSON.stringify([...state.promptIds]);
  }
  if (state.piiPartialSpanIds.ids.size > 0) {
    attributes[PII_PARTIAL_ATTR] = JSON.stringify([
      ...state.piiPartialSpanIds.ids,
    ]);
  }
  if (state.piiSkippedSpanIds.ids.size > 0) {
    attributes[PII_SKIPPED_ATTR] = JSON.stringify([
      ...state.piiSkippedSpanIds.ids,
    ]);
  }

  return {
    traceId: state.traceId,
    occurredAt: state.occurredAt,
    totalDurationMs: state.totalDurationMs,
    computedInput: state.computedInput?.text ?? null,
    computedOutput: state.computedOutput?.text ?? null,
    timeToFirstTokenMs: state.timeToFirstTokenMs,
    timeToLastTokenMs: state.timeToLastTokenMs,
    containsErrorStatus: state.containsErrorStatus,
    containsOKStatus: state.containsOKStatus,
    errorMessage: state.errorMessage?.message ?? null,
    models: orderedModels(state.modelUsage),
    blockedByGuardrail: state.blockedByGuardrail,
    containsAi: state.containsAi,
    containsPrompt: state.containsPrompt,
    selectedPrompt: state.selectedPrompt,
    lastUsedPrompt: state.lastUsedPrompt,
    traceName: state.traceNameOverride ?? rootOrFallback?.name ?? "",
    rootSpanType: rootOrFallback?.spanType ?? null,
    rootSpanStartTimeMs: rootOrFallback?.startTimeMs ?? null,
    traceNameFromFallback:
      state.traceNameOverride === null &&
      state.rootCandidate === null &&
      state.fallbackCandidate !== null,
    topicId: state.topicId,
    subTopicId: state.subTopicId,
    annotationIds: presentAnnotationIds(state.annotations),
    attributes,
  };
}

/**
 * The row is the derived view plus the stamps and candidates a read-back needs
 * to keep folding, so it is not a case shift of the state and the mapping is
 * declared rather than derived. Attribute and model provenance is not stored:
 * after a read-back a later span merges against a spanId-less owner, which
 * makes the newer span win — deliberate, and the reason a rebuild from the
 * event log is the authority.
 */
export const traceSummaryRowMapping: RowMapping<
  TraceSummaryState,
  typeof traceSummariesTable.columns
> = {
  toRow(state, context) {
    const view = deriveTraceSummaryView(state);
    const anchor = new Date(state.occurredAt || context.writtenAt.getTime());
    return {
      TenantId: context.tenantId,
      TraceId: context.key,
      Version: context.version,
      TotalDurationMs: BigInt(Math.max(0, Math.round(view.totalDurationMs))),
      ComputedInput: view.computedInput,
      ComputedOutput: view.computedOutput,
      TimeToFirstTokenMs: toBigInt(view.timeToFirstTokenMs),
      TimeToLastTokenMs: toBigInt(view.timeToLastTokenMs),
      ContainsErrorStatus: view.containsErrorStatus,
      ContainsOKStatus: view.containsOKStatus,
      ErrorMessage: view.errorMessage,
      Models: [...view.models],
      BlockedByGuardrail: view.blockedByGuardrail,
      ContainsAi: view.containsAi,
      ContainsPrompt: view.containsPrompt,
      SelectedPromptId: view.selectedPrompt?.promptId ?? null,
      SelectedPromptVersionId: view.selectedPrompt?.versionId ?? null,
      LastUsedPromptId: view.lastUsedPrompt?.promptId ?? null,
      LastUsedPromptVersionId: view.lastUsedPrompt?.versionId ?? null,
      TraceName: view.traceName,
      RootSpanType: view.rootSpanType,
      RootSpanStartTimeMs: toBigInt(view.rootSpanStartTimeMs),
      TraceNameFromFallback: view.traceNameFromFallback,
      TopicId: view.topicId,
      SubTopicId: view.subTopicId,
      TopicAssignedAt: BigInt(Math.max(0, state.topicAssignedAt)),
      TraceNameChangedAt: BigInt(Math.max(0, state.traceNameChangedAt)),
      AnnotationIds: [...view.annotationIds],
      AttributesJson: JSON.stringify(view.attributes),
      OccurredAt: anchor,
      AcceptedAt: anchor,
      UpdatedAt: context.writtenAt,
      _retention_days: context.retentionDays,
    };
  },

  fromRow(row) {
    const base = initTraceSummaryState();
    const attributes = decodeAttributes(row.AttributesJson);
    return {
      ...base,
      traceId: row.TraceId,
      occurredAt: row.OccurredAt.getTime(),
      totalDurationMs: Number(row.TotalDurationMs),
      computedInput: rehydrateIO(row.ComputedInput),
      computedOutput: rehydrateIO(row.ComputedOutput),
      timeToFirstTokenMs: toNumber(row.TimeToFirstTokenMs),
      timeToLastTokenMs: toNumber(row.TimeToLastTokenMs),
      containsErrorStatus: row.ContainsErrorStatus,
      containsOKStatus: row.ContainsOKStatus,
      errorMessage:
        row.ErrorMessage === null
          ? null
          : { message: row.ErrorMessage, rank: 1, spanId: "" },
      // Rank order is lost on read-back, so models are reseeded newest-first by
      // their stored order rather than by their original start times.
      modelUsage: new Map(row.Models.map((model, index) => [model, -index])),
      blockedByGuardrail: row.BlockedByGuardrail,
      containsAi: row.ContainsAi,
      containsPrompt: row.ContainsPrompt,
      selectedPrompt: rehydratePrompt(
        row.SelectedPromptId,
        row.SelectedPromptVersionId,
        0,
      ),
      lastUsedPrompt: rehydratePrompt(
        row.LastUsedPromptId,
        row.LastUsedPromptVersionId,
        Number.MAX_SAFE_INTEGER,
      ),
      rootCandidate: row.TraceNameFromFallback
        ? null
        : rehydrateName(row, row.TraceName),
      fallbackCandidate: row.TraceNameFromFallback
        ? rehydrateName(row, row.TraceName)
        : null,
      traceNameOverride:
        row.TraceNameChangedAt > 0n ? row.TraceName : base.traceNameOverride,
      traceNameChangedAt: Number(row.TraceNameChangedAt),
      topicId: row.TopicId,
      subTopicId: row.SubTopicId,
      topicAssignedAt: Number(row.TopicAssignedAt),
      annotations: {
        changes: new Map(
          row.AnnotationIds.map((id) => [id, { present: true, actedAt: 0 }]),
        ),
        sync: null,
      },
      attributes: new Map(
        Object.entries(attributes).map(([key, value]) => [
          key,
          { value, spanId: "" },
        ]),
      ),
    };
  },
};

function toBigInt(value: number | null): bigint | null {
  return value === null ? null : BigInt(Math.max(0, Math.round(value)));
}

function toNumber(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

function rehydrateIO(text: string | null): TraceSummaryState["computedInput"] {
  return text === null ? null : { text, tier: 0, endTimeMs: 0, spanId: "" };
}

function rehydratePrompt(
  promptId: string | null,
  versionId: string | null,
  startTimeMs: number,
): TraceSummaryState["selectedPrompt"] {
  return promptId === null
    ? null
    : { promptId, versionId, versionNumber: null, spanId: "", startTimeMs };
}

function rehydrateName(
  row: TraceSummariesRow,
  name: string,
): TraceSummaryState["rootCandidate"] {
  if (row.RootSpanStartTimeMs === null) return null;
  return {
    spanId: "",
    startTimeMs: Number(row.RootSpanStartTimeMs),
    name,
    spanType: row.RootSpanType,
  };
}

function decodeAttributes(cell: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(cell);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    // Display data, not identity: a degraded read beats failing the version
    // gate on a row an older build wrote.
    return {};
  }
}
