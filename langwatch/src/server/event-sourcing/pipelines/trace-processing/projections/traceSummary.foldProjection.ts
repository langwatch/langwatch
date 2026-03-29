import { coerceToNumber } from "~/utils/coerceToNumber";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  estimateCost,
  matchingLLMModelCost,
} from "~/server/background/workers/collector/cost";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";
import type {
  LogRecordReceivedEventData,
  SpanReceivedEvent,
  TopicAssignedEvent,
  LogRecordReceivedEvent,
  MetricRecordReceivedEvent,
  OriginResolvedEvent,
} from "../schemas/events";
import {
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
} from "../schemas/events";
import type { NormalizedAttributes, NormalizedSpan } from "../schemas/spans";
import { NormalizedStatusCode as StatusCode } from "../schemas/spans";

export type { TraceSummaryData };

const COMPUTED_IO_SCHEMA_VERSION = "2025-12-18" as const;

const OUTPUT_SOURCE = {
  EXPLICIT: "explicit",
  INFERRED: "inferred",
} as const;

const FIRST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "first_token",
  "llm.first_token",
]);

const LAST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "last_token",
  "llm.last_token",
]);

const STANDARD_RESOURCE_PREFIXES = [
  "host.",
  "process.",
  "telemetry.",
  "service.",
  "os.",
  "container.",
  "k8s.",
  "cloud.",
  "deployment.",
  "device.",
  "faas.",
  "webengine.",
] as const;

const SPRING_AI_SCOPE_NAMES = new Set([
  "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
]);

const CLAUDE_CODE_SCOPE_NAMES = new Set(["com.anthropic.claude_code.events"]);

const RESOURCE_ATTR_MAPPINGS = [
  ["telemetry.sdk.name", "sdk.name"],
  ["telemetry.sdk.version", "sdk.version"],
  ["telemetry.sdk.language", "sdk.language"],
  ["service.name", "service.name"],
] as const;

const SPAN_ATTR_MAPPINGS = [
  [ATTR_KEYS.GEN_AI_CONVERSATION_ID, "gen_ai.conversation.id"],
  [ATTR_KEYS.LANGWATCH_USER_ID, "langwatch.user_id"],
  [ATTR_KEYS.LANGWATCH_CUSTOMER_ID, "langwatch.customer_id"],
  [ATTR_KEYS.GEN_AI_AGENT_NAME, "gen_ai.agent.name"],
  [ATTR_KEYS.GEN_AI_AGENT_ID, "gen_ai.agent.id"],
  [ATTR_KEYS.GEN_AI_PROVIDER_NAME, "gen_ai.provider.name"],
  [ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID, "langgraph.thread_id"],
] as const;

const LEGACY_ORIGIN_RULES: Array<{
  check: (span: NormalizedSpan) => boolean;
  origin: string;
}> = [
  {
    check: (s) => s.instrumentationScope?.name === "langwatch-evaluation",
    origin: "evaluation",
  },
  {
    check: (s) => s.instrumentationScope?.name === "@langwatch/scenario",
    origin: "simulation",
  },
  {
    check: (s) =>
      s.spanAttributes["metadata.platform"] === "optimization_studio",
    origin: "workflow",
  },
  {
    check: (s) => {
      const labels = s.spanAttributes[ATTR_KEYS.LANGWATCH_LABELS];
      const arr =
        typeof labels === "string"
          ? parseJsonStringArray(labels)
          : Array.isArray(labels)
            ? (labels as string[])
            : [];
      return arr.includes("scenario-runner");
    },
    origin: "simulation",
  },
  {
    check: (s) => s.resourceAttributes["scenario.labels"] !== undefined,
    origin: "simulation",
  },
  {
    check: (s) => s.spanAttributes["evaluation.run_id"] !== undefined,
    origin: "evaluation",
  },
];

// ─── Utilities ──────────────────────────────────────────────────────

function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [raw];
  }
}

const isValidTimestamp = (ts: number | undefined | null): ts is number =>
  typeof ts === "number" && ts > 0 && Number.isFinite(ts);

function stringAttr(
  attrs: NormalizedAttributes,
  key: string,
): string | undefined {
  const v = attrs[key];
  return typeof v === "string" ? v : undefined;
}

// ─── Span extractors ────────────────────────────────────────────────

function extractModelsFromSpan(span: NormalizedSpan): string[] {
  return [
    span.spanAttributes[ATTR_KEYS.GEN_AI_RESPONSE_MODEL],
    span.spanAttributes[ATTR_KEYS.GEN_AI_REQUEST_MODEL],
  ].filter((m): m is string => typeof m === "string" && m !== "");
}

function computeSpanCost({
  attrs,
  model,
  promptTokens,
  completionTokens,
}: {
  attrs: NormalizedAttributes;
  model: string | undefined;
  promptTokens: number;
  completionTokens: number;
}): number {
  const numInputRate = coerceToNumber(attrs[ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN]);
  const numOutputRate = coerceToNumber(attrs[ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN]);
  if (numInputRate !== null || numOutputRate !== null) {
    return (
      promptTokens * (numInputRate ?? 0) +
      completionTokens * (numOutputRate ?? 0)
    );
  }

  if (model && (promptTokens > 0 || completionTokens > 0)) {
    const matched = matchingLLMModelCost(model, getStaticModelCosts());
    if (matched) {
      const computed = estimateCost({
        llmModelCost: matched,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
      });
      if (computed !== undefined && computed > 0) return computed;
    }
  }

  const numSpanCost = coerceToNumber(attrs[ATTR_KEYS.LANGWATCH_SPAN_COST]);
  if (numSpanCost !== null && numSpanCost > 0) return numSpanCost;

  if (attrs[ATTR_KEYS.SPAN_TYPE] === "guardrail") {
    const rawOutput = attrs[ATTR_KEYS.LANGWATCH_OUTPUT];
    if (
      rawOutput &&
      typeof rawOutput === "object" &&
      !Array.isArray(rawOutput)
    ) {
      const costObj = (rawOutput as Record<string, unknown>).cost as
        | { amount?: number; currency?: string }
        | undefined;
      if (costObj?.currency === "USD" && typeof costObj.amount === "number") {
        return costObj.amount;
      }
    }
  }

  return 0;
}

function extractTokenMetrics(span: NormalizedSpan) {
  const attrs = span.spanAttributes;
  const inputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS];
  const outputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS];
  const promptTokens = Math.max(0, coerceToNumber(inputTokens) ?? 0);
  const completionTokens = Math.max(0, coerceToNumber(outputTokens) ?? 0);

  return {
    promptTokens,
    completionTokens,
    cost: computeSpanCost({
      attrs,
      model: extractModelsFromSpan(span)[0],
      promptTokens,
      completionTokens,
    }),
    estimated: attrs[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === true || attrs[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === "true",
  };
}

function extractStatus(span: NormalizedSpan) {
  const attrs = span.spanAttributes;
  let hasError = false;
  let hasOK = false;
  let errorMessage: string | null = null;

  if (span.statusCode === StatusCode.OK) hasOK = true;
  else if (span.statusCode === StatusCode.ERROR) {
    hasError = true;
    if (span.statusMessage) errorMessage = span.statusMessage;
  }

  if (!errorMessage) {
    const msg =
      attrs[ATTR_KEYS.ERROR_MESSAGE] ?? attrs[ATTR_KEYS.EXCEPTION_MESSAGE];
    if (typeof msg === "string") {
      errorMessage = msg;
      hasError = true;
    }
  }

  if (!hasError) {
    const flag =
      attrs[ATTR_KEYS.ERROR_HAS_ERROR] ?? attrs[ATTR_KEYS.SPAN_ERROR_HAS_ERROR];
    if (flag === true || flag === "true") hasError = true;
  }

  if (!errorMessage && span.events?.length) {
    const ex = span.events.find((e) => e.name === "exception");
    if (ex) {
      hasError = true;
      const msg = ex.attributes?.["exception.message"];
      if (typeof msg === "string") errorMessage = msg;
    }
  }

  return { hasError, hasOK, errorMessage };
}

function extractTokenTiming(span: NormalizedSpan) {
  let timeToFirstToken: number | null = null;
  let timeToLastToken: number | null = null;
  if (!span.events?.length) return { timeToFirstToken, timeToLastToken };

  for (const event of span.events) {
    const delta = event.timeUnixMs - span.startTimeUnixMs;
    if (delta < 0) continue;
    if (
      FIRST_TOKEN_EVENTS.has(event.name) &&
      (timeToFirstToken === null || delta < timeToFirstToken)
    ) {
      timeToFirstToken = delta;
    }
    if (
      LAST_TOKEN_EVENTS.has(event.name) &&
      (timeToLastToken === null || delta > timeToLastToken)
    ) {
      timeToLastToken = delta;
    }
  }

  return { timeToFirstToken, timeToLastToken };
}

function extractAttributes(span: NormalizedSpan): Record<string, string> {
  const result: Record<string, string> = {};
  const spanAttrs = span.spanAttributes;
  const resourceAttrs = span.resourceAttributes;

  for (const [source, dest] of RESOURCE_ATTR_MAPPINGS) {
    const v = resourceAttrs[source];
    if (typeof v === "string") result[dest] = v;
  }

  for (const [key, value] of Object.entries(resourceAttrs)) {
    if (STANDARD_RESOURCE_PREFIXES.some((p) => key.startsWith(p))) continue;
    // Skip langwatch.metadata.* and langwatch.trace.* — handled after span attrs for precedence
    if (key.startsWith("langwatch.metadata.") || key.startsWith("langwatch.trace.")) continue;
    if (typeof value === "string") result[key] = value;
    else if (typeof value === "number" || typeof value === "boolean")
      result[key] = String(value);
  }

  for (const [source, dest] of SPAN_ATTR_MAPPINGS) {
    const v = spanAttrs[source];
    if (typeof v === "string") result[dest] = v;
  }

  const origin = stringAttr(spanAttrs, "langwatch.origin");
  if (origin) result["langwatch.origin"] = origin;

  const scenarioRunId = stringAttr(spanAttrs, "scenario.run_id");
  if (scenarioRunId) result["scenario.run_id"] = scenarioRunId;

  const labels = spanAttrs[ATTR_KEYS.LANGWATCH_LABELS];
  if (typeof labels === "string") result["langwatch.labels"] = labels;
  else if (Array.isArray(labels))
    result["langwatch.labels"] = JSON.stringify(labels);

  const promptId = stringAttr(spanAttrs, "langwatch.prompt.id");
  if (promptId && promptId.includes(":")) {
    result["langwatch.prompt.id"] = promptId;
  }

  for (const [key, value] of Object.entries(spanAttrs)) {
    if (!key.startsWith("metadata.")) continue;
    if (typeof value === "string") result[key] = value;
    else if (value !== null && value !== undefined) {
      result[key] =
        typeof value === "object" ? JSON.stringify(value) : String(value);
    }
  }

  // langwatch.metadata.* and langwatch.trace.* resource attrs — highest priority,
  // overrides blob-hoisted span attrs for correct subkey > blob precedence
  for (const [key, value] of Object.entries(resourceAttrs)) {
    let bareKey: string | undefined;
    if (key.startsWith("langwatch.metadata.")) bareKey = key.slice("langwatch.metadata.".length);
    else if (key.startsWith("langwatch.trace.")) bareKey = key.slice("langwatch.trace.".length);
    if (!bareKey) continue;
    const metadataKey = "metadata." + bareKey;
    if (typeof value === "string") result[metadataKey] = value;
    else if (typeof value === "number" || typeof value === "boolean")
      result[metadataKey] = String(value);
  }

  return result;
}

// ─── Origin resolution ──────────────────────────────────────────────

function inferOriginFromLegacyMarkers(
  span: NormalizedSpan,
): string | undefined {
  for (const rule of LEGACY_ORIGIN_RULES) {
    if (rule.check(span)) return rule.origin;
  }
  return undefined;
}

// ─── Log record I/O extraction ──────────────────────────────────────

function extractIOFromLogRecord(data: LogRecordReceivedEventData): {
  input: string | null;
  output: string | null;
} {
  if (SPRING_AI_SCOPE_NAMES.has(data.scopeName)) {
    const [identifier, ...contentParts] = data.body.split("\n");
    const content = contentParts.join("\n");
    if (!identifier || !content) return { input: null, output: null };
    if (identifier === "Chat Model Prompt Content:")
      return { input: content, output: null };
    if (identifier === "Chat Model Completion:")
      return { input: null, output: content };
  }

  if (CLAUDE_CODE_SCOPE_NAMES.has(data.scopeName)) {
    const prompt = data.attributes.prompt;
    if (prompt && typeof prompt === "string") {
      return { input: prompt, output: null };
    }
  }

  return { input: null, output: null };
}

// ─── Output override logic ──────────────────────────────────────────

/**
 * Priority: root > explicit > last-finishing.
 * @internal Exported for unit testing
 */
export function shouldOverrideOutput({
  isRoot,
  outputFromRoot,
  isExplicit,
  currentIsExplicit,
  endTime,
  currentEndTime,
}: {
  isRoot: boolean;
  outputFromRoot: boolean;
  isExplicit: boolean;
  currentIsExplicit: boolean;
  endTime: number;
  currentEndTime: number;
}): boolean {
  if (isRoot) return true;
  if (outputFromRoot) return false;
  if (isExplicit && !currentIsExplicit) return true;
  if (isExplicit === currentIsExplicit && endTime >= currentEndTime)
    return true;
  return false;
}

// TODO(2027): remove once all clients are upgraded
function stripLegacyMarkers(mergedAttributes: Record<string, string>): void {
  if (mergedAttributes["metadata.platform"] === "optimization_studio") {
    delete mergedAttributes["metadata.platform"];
  }

  if (mergedAttributes["langwatch.labels"]) {
    const allLabels = parseJsonStringArray(mergedAttributes["langwatch.labels"]);
    const filtered = allLabels.filter((l) => l !== "scenario-runner");
    if (filtered.length > 0) {
      mergedAttributes["langwatch.labels"] = JSON.stringify(filtered);
    } else {
      delete mergedAttributes["langwatch.labels"];
    }
  }
}

function hoistOrigin(
  state: TraceSummaryData,
  span: NormalizedSpan,
  mergedAttributes: Record<string, string>,
): void {
  const isRootSpan = !span.parentSpanId;
  const explicitOrigin = span.spanAttributes["langwatch.origin"];
  const hasExplicitOrigin = typeof explicitOrigin === "string" && explicitOrigin !== "";

  if (hasExplicitOrigin) {
    if (isRootSpan) {
      mergedAttributes["langwatch.origin"] = explicitOrigin as string;
    } else if (!state.attributes["langwatch.origin"]) {
      mergedAttributes["langwatch.origin"] = explicitOrigin as string;
    } else {
      mergedAttributes["langwatch.origin"] = state.attributes["langwatch.origin"];
    }
  } else if (isRootSpan && state.attributes["langwatch.origin"]) {
    mergedAttributes["langwatch.origin"] = state.attributes["langwatch.origin"];
  } else {
    const inferred = inferOriginFromLegacyMarkers(span);
    if (inferred) {
      if (isRootSpan) {
        mergedAttributes["langwatch.origin"] = inferred;
      } else if (!state.attributes["langwatch.origin"]) {
        mergedAttributes["langwatch.origin"] = inferred;
      } else {
        mergedAttributes["langwatch.origin"] = state.attributes["langwatch.origin"];
      }
    } else if (state.attributes["langwatch.origin"]) {
      mergedAttributes["langwatch.origin"] = state.attributes["langwatch.origin"];
    } else if (mergedAttributes["sdk.name"]) {
      // SDK heuristic: sdk.name present but no explicit origin and no
      // legacy markers → old SDK that doesn't tag origin. Old SDK
      // evaluations/simulations are already caught by legacy rules above,
      // so what's left must be a regular application trace.
      mergedAttributes["langwatch.origin"] = "application";
    }
  }
}

function hoistSource(
  state: TraceSummaryData,
  span: NormalizedSpan,
  mergedAttributes: Record<string, string>,
): void {
  const isRootSpan = !span.parentSpanId;
  const explicitSource =
    span.spanAttributes["langwatch.origin.source"] as string | undefined;
  if (typeof explicitSource === "string" && explicitSource !== "") {
    if (isRootSpan) {
      mergedAttributes["langwatch.origin.source"] = explicitSource;
    } else if (!state.attributes["langwatch.origin.source"]) {
      mergedAttributes["langwatch.origin.source"] = explicitSource;
    } else {
      mergedAttributes["langwatch.origin.source"] = state.attributes["langwatch.origin.source"];
    }
  } else if (state.attributes["langwatch.origin.source"]) {
    mergedAttributes["langwatch.origin.source"] = state.attributes["langwatch.origin.source"];
  }
}

function accumulateTiming({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}) {
  if (
    !isValidTimestamp(span.startTimeUnixMs) ||
    !isValidTimestamp(span.endTimeUnixMs)
  ) {
    return {
      occurredAt: state.occurredAt,
      totalDurationMs: state.totalDurationMs,
    };
  }

  const occurredAt =
    state.occurredAt > 0
      ? Math.min(state.occurredAt, span.startTimeUnixMs)
      : span.startTimeUnixMs;
  const currentEnd =
    state.occurredAt > 0 ? state.occurredAt + state.totalDurationMs : 0;
  const totalDurationMs = Math.max(currentEnd, span.endTimeUnixMs) - occurredAt;

  return { occurredAt, totalDurationMs };
}

function accumulateTokens({
  state,
  span,
  totalDurationMs,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
  totalDurationMs: number;
}) {
  const metrics = extractTokenMetrics(span);
  const totalPromptTokenCount =
    (state.totalPromptTokenCount ?? 0) + metrics.promptTokens;
  const totalCompletionTokenCount =
    (state.totalCompletionTokenCount ?? 0) + metrics.completionTokens;
  const totalCost = (state.totalCost ?? 0) + metrics.cost;

  const timing = extractTokenTiming(span);
  let timeToFirstTokenMs = state.timeToFirstTokenMs;
  if (timing.timeToFirstToken !== null) {
    timeToFirstTokenMs =
      timeToFirstTokenMs === null
        ? timing.timeToFirstToken
        : Math.min(timeToFirstTokenMs, timing.timeToFirstToken);
  }
  let timeToLastTokenMs = state.timeToLastTokenMs;
  if (timing.timeToLastToken !== null) {
    timeToLastTokenMs =
      timeToLastTokenMs === null
        ? timing.timeToLastToken
        : Math.max(timeToLastTokenMs, timing.timeToLastToken);
  }

  const tokensPerSecond =
    totalCompletionTokenCount > 0 && totalDurationMs > 0
      ? Math.round((totalCompletionTokenCount / totalDurationMs) * 1000)
      : null;

  return {
    totalPromptTokenCount:
      totalPromptTokenCount > 0 ? totalPromptTokenCount : null,
    totalCompletionTokenCount:
      totalCompletionTokenCount > 0 ? totalCompletionTokenCount : null,
    totalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
    tokensEstimated: state.tokensEstimated || metrics.estimated,
    timeToFirstTokenMs,
    timeToLastTokenMs,
    tokensPerSecond,
  };
}

function accumulateStatus({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}) {
  const info = extractStatus(span);
  return {
    containsErrorStatus: state.containsErrorStatus || info.hasError,
    containsOKStatus: state.containsOKStatus || info.hasOK,
    errorMessage: state.errorMessage ?? info.errorMessage,
  };
}

function accumulateIO({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}) {
  const spanType = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
  const currentOutputSource =
    state.attributes["langwatch.reserved.output_source"] ??
    OUTPUT_SOURCE.INFERRED;

  let computedInput = state.computedInput;
  let computedOutput = state.computedOutput;
  let outputFromRootSpan = state.outputFromRootSpan;
  let outputSpanEndTimeMs = state.outputSpanEndTimeMs;
  let outputSource = currentOutputSource;
  let blockedByGuardrail = state.blockedByGuardrail;

  if (spanType === "guardrail") {
    const rawOutput = span.spanAttributes[ATTR_KEYS.LANGWATCH_OUTPUT];
    if (
      rawOutput &&
      typeof rawOutput === "object" &&
      !Array.isArray(rawOutput)
    ) {
      if ((rawOutput as Record<string, unknown>).passed === false)
        blockedByGuardrail = true;
    }
  }

  if (spanType === "evaluation" || spanType === "guardrail") {
    return {
      computedInput,
      computedOutput,
      outputFromRootSpan,
      outputSpanEndTimeMs,
      outputSource,
      blockedByGuardrail,
    };
  }

  const isRoot = !span.parentSpanId;

  const inputResult = traceIOExtractionService.extractRichIOFromSpan(
    span,
    "input",
  );
  if (inputResult && (isRoot || computedInput === null)) {
    const raw = inputResult.raw;
    computedInput = typeof raw === "string" ? raw : JSON.stringify(raw);
  }

  const outputResult = traceIOExtractionService.extractRichIOFromSpan(
    span,
    "output",
  );
  if (outputResult) {
    const isExplicit = outputResult.source === "langwatch";
    if (
      shouldOverrideOutput({
        isRoot,
        outputFromRoot: outputFromRootSpan,
        isExplicit,
        currentIsExplicit: currentOutputSource === OUTPUT_SOURCE.EXPLICIT,
        endTime: span.endTimeUnixMs,
        currentEndTime: outputSpanEndTimeMs,
      })
    ) {
      const raw = outputResult.raw;
      computedOutput = typeof raw === "string" ? raw : JSON.stringify(raw);
      outputFromRootSpan = isRoot;
      outputSpanEndTimeMs = span.endTimeUnixMs;
      outputSource = isExplicit
        ? OUTPUT_SOURCE.EXPLICIT
        : OUTPUT_SOURCE.INFERRED;
    }
  }

  return {
    computedInput,
    computedOutput,
    outputFromRootSpan,
    outputSpanEndTimeMs,
    outputSource,
    blockedByGuardrail,
  };
}

function accumulateAttributes({
  state,
  span,
  outputSource,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
  outputSource: string;
}): Record<string, string> {
  const spanAttrs = extractAttributes(span);
  const merged = { ...spanAttrs, ...state.attributes };

  // Labels: union across spans
  const existingLabels = state.attributes["langwatch.labels"];
  const newLabels = spanAttrs["langwatch.labels"];
  if (existingLabels || newLabels) {
    const union = [
      ...new Set([
        ...parseJsonStringArray(existingLabels),
        ...parseJsonStringArray(newLabels),
      ]),
    ];
    if (union.length > 0) merged["langwatch.labels"] = JSON.stringify(union);
  }

  // Prompt IDs: union across spans
  const existingPromptIds = state.attributes["langwatch.prompt_ids"];
  const newPromptId = spanAttrs["langwatch.prompt.id"];
  if (existingPromptIds || newPromptId) {
    const union = [
      ...new Set([
        ...parseJsonStringArray(existingPromptIds),
        ...(newPromptId ? [newPromptId] : []),
      ]),
    ];
    if (union.length > 0)
      merged["langwatch.prompt_ids"] = JSON.stringify(union);
  }
  // Remove the per-span key so it doesn't leak into trace-level attributes
  delete merged["langwatch.prompt.id"];

  // Metadata: deep-merge JSON objects, first-wins for primitives
  for (const key of Object.keys(merged)) {
    if (!key.startsWith("metadata.")) continue;
    const prev = state.attributes[key];
    const next = spanAttrs[key];
    if (!prev || !next) continue;
    try {
      const prevObj: unknown = JSON.parse(prev);
      const nextObj: unknown = JSON.parse(next);
      if (
        typeof prevObj === "object" &&
        prevObj &&
        !Array.isArray(prevObj) &&
        typeof nextObj === "object" &&
        nextObj &&
        !Array.isArray(nextObj)
      ) {
        merged[key] = JSON.stringify({ ...nextObj, ...prevObj });
      }
    } catch {
      /* not JSON — keep first-wins */
    }
  }

  stripLegacyMarkers(merged);
  hoistOrigin(state, span, merged);
  hoistSource(state, span, merged);

  merged["langwatch.reserved.output_source"] = outputSource;

  // PII redaction status tracking — accumulate span IDs by severity
  const piiStatus =
    span.spanAttributes[ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS];
  if (piiStatus === "partial" || piiStatus === "none") {
    const key =
      piiStatus === "partial"
        ? ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_PARTIAL_SPAN_IDS
        : ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_SKIPPED_SPAN_IDS;
    const ids = parseJsonStringArray(merged[key]);
    ids.push(span.spanId);
    merged[key] = JSON.stringify(ids);
  }

  return merged;
}

// ─── Per-role cost/latency ────────────────────────────────────────────

function accumulateRoleCostLatency({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}): Pick<TraceSummaryData, "scenarioRoleCosts" | "scenarioRoleLatencies" | "scenarioRoleSpans" | "spanCosts"> {
  const scenarioRoleSpans = { ...(state.scenarioRoleSpans ?? {}) };
  const spanCosts = { ...(state.spanCosts ?? {}) };

  // Track this span's cost and parent for retroactive role assignment
  const spanCost = extractTokenMetrics(span).cost;
  if (spanCost > 0) {
    spanCosts[span.spanId] = spanCost;
  }

  // Record parent relationship for retroactive role propagation.
  // Only stored in scenarioRoleSpans — not in spanCosts (which would
  // bloat the Map column with zero-value entries for every span).
  if (span.parentSpanId) {
    scenarioRoleSpans[`_parent:${span.spanId}`] = span.parentSpanId;
  }

  // Record this span's role if it has one
  const directRole = span.spanAttributes["scenario.role"];
  const isNewRoleSpan = typeof directRole === "string" && directRole !== "";

  if (isNewRoleSpan) {
    scenarioRoleSpans[span.spanId] = directRole;
    // Propagate role to all existing spans that are descendants of this span
    for (const key of Object.keys(scenarioRoleSpans)) {
      if (key.startsWith("_parent:")) {
        const childId = key.slice("_parent:".length);
        const parentId = scenarioRoleSpans[key]!;
        if (parentId === span.spanId && !scenarioRoleSpans[childId]) {
          scenarioRoleSpans[childId] = directRole;
        }
      }
    }
  } else if (span.parentSpanId && scenarioRoleSpans[span.parentSpanId]) {
    scenarioRoleSpans[span.spanId] = scenarioRoleSpans[span.parentSpanId]!;
  }

  // Recompute ALL role costs from spanCosts + scenarioRoleSpans.
  // This handles the case where child LLM spans arrive before their
  // parent agent span — when the parent arrives and propagates its role,
  // all children's costs are retroactively assigned.
  const scenarioRoleCosts: Record<string, number> = {};
  for (const [sid, cost] of Object.entries(spanCosts)) {
    if (sid.startsWith("_parent:")) continue; // skip parent mappings
    const role = scenarioRoleSpans[sid];
    if (role && !role.startsWith("_parent:") && cost > 0) {
      scenarioRoleCosts[role] = (scenarioRoleCosts[role] ?? 0) + cost;
    }
  }

  // Latency: only from spans that directly carry the role attribute
  let scenarioRoleLatencies = state.scenarioRoleLatencies ?? {};
  if (isNewRoleSpan) {
    const spanDurationMs = span.endTimeUnixMs - span.startTimeUnixMs;
    scenarioRoleLatencies = {
      ...scenarioRoleLatencies,
      [directRole]: (scenarioRoleLatencies[directRole] ?? 0) + spanDurationMs,
    };
  }

  return { scenarioRoleCosts, scenarioRoleLatencies, scenarioRoleSpans, spanCosts };
}

// ─── Main composition ───────────────────────────────────────────────

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);
const traceIOExtractionService = new TraceIOExtractionService();

/** @internal Exported for unit testing */
export function applySpanToSummary({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}): TraceSummaryData {
  const timing = accumulateTiming({ state, span });
  const tokens = accumulateTokens({
    state,
    span,
    totalDurationMs: timing.totalDurationMs,
  });
  const status = accumulateStatus({ state, span });
  const io = accumulateIO({ state, span });
  const attributes = accumulateAttributes({
    state,
    span,
    outputSource: io.outputSource,
  });

  const newModels = extractModelsFromSpan(span);
  const models =
    newModels.length > 0
      ? [...new Set([...state.models, ...newModels])].sort()
      : state.models;

  // Track span-to-role mapping and accumulate per-role cost/latency.
  // Roles are set on agent spans, but costs live on child LLM spans.
  // We resolve each span's effective role by walking up the parent chain.
  const roleAccumulation = accumulateRoleCostLatency({ state, span });

  return {
    ...state,
    traceId: state.traceId || span.traceId,
    spanCount: state.spanCount + 1,
    computedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
    occurredAt: timing.occurredAt,
    totalDurationMs: timing.totalDurationMs,
    models,
    ...tokens,
    ...status,
    computedInput: io.computedInput,
    computedOutput: io.computedOutput,
    outputFromRootSpan: io.outputFromRootSpan,
    outputSpanEndTimeMs: io.outputSpanEndTimeMs,
    blockedByGuardrail: io.blockedByGuardrail,
    attributes,
    ...roleAccumulation,
  };
}

const traceSummaryEvents = [
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
] as const;

/**
 * Type-safe fold projection for trace summary state.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event schema
 * - Handler names derived from event type strings (e.g. `"lw.obs.trace.span_received"` -> `handleTraceSpanReceived`)
 * - `updatedAt` is auto-managed by the base class after each handler call (camelCase)
 */
export class TraceSummaryFoldProjection
  extends AbstractFoldProjection<TraceSummaryData, typeof traceSummaryEvents>
  implements FoldEventHandlers<typeof traceSummaryEvents, TraceSummaryData>
{
  readonly name = "traceSummary";
  readonly version = TRACE_SUMMARY_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<TraceSummaryData>;
  protected override readonly timestampStyle = "camel" as const;

  protected readonly events = traceSummaryEvents;

  constructor(deps: { store: FoldProjectionStore<TraceSummaryData> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return {
      traceId: "",
      spanCount: 0,
      totalDurationMs: 0,
      computedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: false,
      errorMessage: null,
      models: [],
      totalCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      topicId: null,
      subTopicId: null,
      hasAnnotation: null,
      attributes: {},
      scenarioRoleCosts: {},
      scenarioRoleLatencies: {},
      scenarioRoleSpans: {},
      spanCosts: {},
      // Sentinel: 0 means "no spans received yet". The timing function uses
      // occurredAt > 0 to decide first-span vs min-of-existing. Using Date.now()
      // here would break Math.min logic — wall-clock time >> span startTimeUnixMs.
      occurredAt: 0,
    };
  }

  handleTraceSpanReceived(
    event: SpanReceivedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const normalizedSpan =
      spanNormalizationPipelineService.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );
    enrichRagContextIds(normalizedSpan);

    return {
      ...applySpanToSummary({ state, span: normalizedSpan }),
      createdAt: state.createdAt,
    };
  }

  handleTraceTopicAssigned(
    event: TopicAssignedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    return {
      ...state,
      topicId: event.data.topicId ?? state.topicId,
      subTopicId: event.data.subtopicId ?? state.subTopicId,
    };
  }

  handleTraceLogRecordReceived(
    event: LogRecordReceivedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const mergedAttributes = { ...state.attributes };
    const logCount = parseInt(
      mergedAttributes["langwatch.reserved.log_record_count"] ?? "0",
      10,
    );
    mergedAttributes["langwatch.reserved.log_record_count"] = String(
      logCount + 1,
    );

    let computedInput = state.computedInput;
    let computedOutput = state.computedOutput;
    let outputSpanEndTimeMs = state.outputSpanEndTimeMs;
    const currentOutputSource =
      state.attributes["langwatch.reserved.output_source"] ??
      OUTPUT_SOURCE.INFERRED;

    const logIO = extractIOFromLogRecord(event.data);

    if (logIO.input !== null && computedInput === null) {
      computedInput = logIO.input;
    }

    if (logIO.output !== null) {
      if (
        shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: state.outputFromRootSpan,
          isExplicit: false,
          currentIsExplicit: currentOutputSource === OUTPUT_SOURCE.EXPLICIT,
          endTime: event.data.timeUnixMs,
          currentEndTime: outputSpanEndTimeMs,
        })
      ) {
        computedOutput = logIO.output;
        outputSpanEndTimeMs = event.data.timeUnixMs;
        mergedAttributes["langwatch.reserved.output_source"] =
          OUTPUT_SOURCE.INFERRED;
      }
    }

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      computedInput,
      computedOutput,
      outputSpanEndTimeMs,
      attributes: mergedAttributes,
    };
  }

  handleTraceMetricRecordReceived(
    event: MetricRecordReceivedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    let timeToFirstTokenMs = state.timeToFirstTokenMs;
    if (event.data.metricName === "gen_ai.server.time_to_first_token") {
      const ttftMs = event.data.value * 1000;
      timeToFirstTokenMs =
        timeToFirstTokenMs === null
          ? ttftMs
          : Math.min(timeToFirstTokenMs, ttftMs);
    }

    const mergedAttributes = { ...state.attributes };
    const metricCount = parseInt(
      mergedAttributes["langwatch.reserved.metric_record_count"] ?? "0",
      10,
    );
    mergedAttributes["langwatch.reserved.metric_record_count"] = String(
      metricCount + 1,
    );

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      timeToFirstTokenMs,
      attributes: mergedAttributes,
    };
  }

  handleTraceOriginResolved(
    event: OriginResolvedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const currentOrigin = state.attributes["langwatch.origin"];
    if (currentOrigin) {
      // Explicit origin already set — do not override
      return state;
    }
    return {
      ...state,
      attributes: {
        ...state.attributes,
        "langwatch.origin": event.data.origin,
      },
    };
  }
}
