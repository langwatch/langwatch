import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { generate } from "@langwatch/ksuid";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import {
  MAX_PROCESSED_SPANS,
  passesTraceOriginGuards,
  SPAN_RECEIVED_EVENT_TYPE,
  spanSchema,
  SYNTHETIC_TRACE_SPAN_NAMES,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type {
  EvaluationLoopBlockReason,
  EvaluationLoopMetrics,
} from "../features/execution/services/evaluation-loop-metrics.service.ts";

/** Main's 30s quiet window per trace, before the trace's monitors are offered it. */
export const TRACE_EVALUATION_TRIGGER_SETTLE_MS = 30_000;

/** All of span_received the trigger reads: the span's name and its attributes. */
export const traceEvaluationTriggerSpanSchema = z.object({
  span: spanSchema.pick({ name: true, attributes: true }),
});

/** origin_resolved carries nothing the trigger reads; the fold has the origin. */
export const traceEvaluationTriggerOriginSchema = z.object({});

/** The trace event in front of the trigger: its type, instant and, for a span, its attributes. */
interface TraceEvaluationTriggerEvent {
  type: string;
  occurredAt: number;
  spanAttributes?: { key: string; value: unknown }[];
}

interface TraceEvaluationTriggerDeps {
  /** Trace's folded summary, read at handling (§9: the folded state is read through TraceApi). */
  findSummary: (input: { projectId: string; traceId: string }) => Promise<TraceSummaryData | null>;
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  monitors: { getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> };
  /** Evaluation's own executeEvaluation sender, which owns the delay and the dedup. */
  queueTraceEvaluation: (data: ExecuteEvaluationCommandData) => Promise<void>;
  /** How an operator sees the loop guard firing. */
  metrics: EvaluationLoopMetrics;
}

const CAUSALITY_LOOP_GUARD_DISABLED_FLAG = "ops_es_causality_loop_guard_disabled";

/**
 * The application's `KSUID_RESOURCES.EVALUATION`. The prefix is part of every
 * evaluation id ever written, so it is a literal here and pinned by literal in
 * the test.
 */
const EVALUATION_KSUID_RESOURCE = "eval";

const CAUSALITY_DEPTH_ATTR = "langwatch.reserved.causality_depth";

const logger = createLogger("langwatch:evaluation:trace-evaluation-trigger");

/** Pre-enqueue relevance: a synthetic span (feedback via /api/track_event) never re-triggers. */
export function isDispatchableTraceSpan(
  data: z.output<typeof traceEvaluationTriggerSpanSchema>,
): boolean {
  return !SYNTHETIC_TRACE_SPAN_NAMES.has(data.span.name);
}

/**
 * Evaluation's peer reaction to trace's span_received and origin_resolved: reads the folded
 * summary, applies the origin, cap and loop guards, then queues one evaluation per enabled
 * on-message monitor. A summary not yet folded throws, so the job retries.
 */
export function createTraceEvaluationTrigger(
  deps: TraceEvaluationTriggerDeps,
): (input: {
  tenantId: string;
  traceId: string;
  event: TraceEvaluationTriggerEvent;
}) => Promise<void> {
  return async ({ tenantId, traceId, event }) => {
    const foldState = await deps.findSummary({ projectId: tenantId, traceId });
    if (!foldState) {
      throw new Error(
        `trace ${traceId} has no folded summary yet; retrying the evaluation trigger`,
      );
    }
    if (!passesTraceOriginGuards(event, foldState)) return;
    if (hasReachedProcessingCap({ tenantId, traceId, foldState })) return;
    if (await causalityLoopGuardFired({ deps, event, foldState, tenantId, traceId })) return;

    await dispatchEvaluations({ deps, tenantId, traceId, foldState, occurredAt: event.occurredAt });
  };
}

/** Oversized-trace guard: skips eval past MAX_PROCESSED_SPANS. Keeps data, drops work only. */
function hasReachedProcessingCap({
  tenantId,
  traceId,
  foldState,
}: {
  tenantId: string;
  traceId: string;
  foldState: TraceSummaryData;
}): boolean {
  if (foldState.spanCount < MAX_PROCESSED_SPANS) return false;
  // Log once, on the first crossing only: a runaway trace would otherwise warn per span.
  if (foldState.spanCount === MAX_PROCESSED_SPANS) {
    logger.warn(
      {
        tenantId,
        observedTraceId: traceId,
        spanCount: foldState.spanCount,
        cap: MAX_PROCESSED_SPANS,
      },
      "Skipping evaluation dispatch: trace reached the processing cap (spans still stored)",
    );
  }
  return true;
}

/**
 * Causality loop guard: depth >= 1 (evaluator-emitted) skips dispatch, depth 0
 * triggers normally. A non-span event falls back to the folded depth.
 */
async function causalityLoopGuardFired({
  deps,
  event,
  foldState,
  tenantId,
  traceId,
}: {
  deps: TraceEvaluationTriggerDeps;
  event: TraceEvaluationTriggerEvent;
  foldState: TraceSummaryData;
  tenantId: string;
  traceId: string;
}): Promise<boolean> {
  const guardDisabled = await deps.featureFlags.isEnabled(CAUSALITY_LOOP_GUARD_DISABLED_FLAG, {
    kind: "system",
  });
  if (guardDisabled) {
    logger.warn(
      { tenantId, observedTraceId: traceId },
      "ops_es_causality_loop_guard_disabled is on, loop guard bypassed",
    );
    return false;
  }

  const reason =
    event.type === SPAN_RECEIVED_EVENT_TYPE
      ? detectCausalityLoop({ spanAttributes: event.spanAttributes })
      : detectFoldedCausalityLoop({ foldState });
  if (!reason) return false;

  // Tenant attribution lives in the log line, not the metric label (unbounded cardinality).
  deps.metrics.loopBlocked(reason);
  logger.warn(
    { tenantId, observedTraceId: traceId, reason },
    "Skipping evaluation dispatch — causality loop guard fired",
  );
  return true;
}

/** Causality-loop detection on a single incoming span_received event. */
export function detectCausalityLoop(params: {
  spanAttributes: { key: string; value: unknown }[] | undefined | null;
}): EvaluationLoopBlockReason | null {
  const depth = extractCausalityDepthFromOtlpAttrs(params.spanAttributes);
  if (depth >= 1) return "depth_direct";
  return null;
}

/** The deferred-origin path (`origin_resolved`, no span payload) reads the folded depth. */
export function detectFoldedCausalityLoop(params: {
  foldState: Pick<TraceSummaryData, "attributes">;
}): EvaluationLoopBlockReason | null {
  const depth = Number(params.foldState.attributes?.[CAUSALITY_DEPTH_ATTR]);
  if (Number.isFinite(depth) && depth >= 1) return "depth_fold";
  return null;
}

/** OTLP AnyValue in any encoding that parses to a finite number. */
function parseNumericAttrValue(value: unknown): number | undefined {
  let raw: unknown = value;
  if (value && typeof value === "object") {
    const anyValue = value as Record<string, unknown>;
    raw = anyValue.intValue ?? anyValue.stringValue ?? anyValue.doubleValue ?? value;
  }
  const parsedFromString = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  const n = typeof raw === "number" ? raw : parsedFromString;
  return Number.isFinite(n) ? n : undefined;
}

function extractCausalityDepthFromOtlpAttrs(
  attrs: { key: string; value: unknown }[] | undefined | null,
): number {
  if (!Array.isArray(attrs)) return 0;
  for (const attr of attrs) {
    if (attr?.key !== CAUSALITY_DEPTH_ATTR) continue;
    const n = parseNumericAttrValue(attr.value);
    if (n !== undefined && n > 0) return n;
  }
  return 0;
}

/** The trace-derived fields every monitor's command payload shares. */
function buildTraceEvaluationFields(foldState: TraceSummaryData) {
  const attrs = foldState.attributes ?? {};
  return {
    threadId: attrs["gen_ai.conversation.id"],
    userId: attrs["langwatch.user_id"],
    customerId: attrs["langwatch.customer_id"],
    labels: parseLabels(attrs["langwatch.labels"]),
    origin: attrs["langwatch.origin"],
    hasError: foldState.containsErrorStatus,
    promptIds: parseLabels(attrs["langwatch.prompt_ids"]),
    topicId: foldState.topicId ?? undefined,
    subTopicId: foldState.subTopicId ?? undefined,
    spanModels: foldState.models.length > 0 ? foldState.models : undefined,
    customMetadata: extractCustomMetadata(attrs),
    computedInput: foldState.computedInput ?? undefined,
    computedOutput: foldState.computedOutput ?? undefined,
    // Last span end: span-seeded start plus wall-clock duration; none before a span is folded
    spanEndedAt:
      foldState.occurredAt > 0
        ? foldState.occurredAt + Math.max(0, foldState.totalDurationMs)
        : undefined,
  };
}

async function dispatchEvaluations({
  deps,
  tenantId,
  traceId,
  foldState,
  occurredAt,
}: {
  deps: TraceEvaluationTriggerDeps;
  tenantId: string;
  traceId: string;
  foldState: TraceSummaryData;
  occurredAt: number;
}): Promise<void> {
  const monitors = await deps.monitors.getEnabledOnMessageMonitors(tenantId);
  if (monitors.length === 0) return;

  // One executeEvaluation command per monitor; the command's dedup and delay handle the rest.
  const traceFields = buildTraceEvaluationFields(foldState);
  for (const monitor of monitors) {
    const evaluationId = generate(EVALUATION_KSUID_RESOURCE).toString();
    try {
      await deps.queueTraceEvaluation({
        tenantId,
        traceId,
        evaluationId,
        evaluatorId: monitor.id,
        evaluatorType: monitor.checkType,
        evaluatorName: monitor.evaluator?.name ?? monitor.name,
        isGuardrail: false,
        occurredAt,
        threadIdleTimeout: monitor.threadIdleTimeout ?? undefined,
        ...traceFields,
      });
    } catch (error) {
      logger.error(
        {
          tenantId,
          traceId,
          evaluationId,
          evaluatorId: monitor.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to send executeEvaluation command",
      );
    }
  }

  logger.debug(
    { tenantId, traceId, monitorCount: monitors.length },
    "Sent executeEvaluation commands for trace",
  );
}

function parseLabels(labelsJson: string | undefined): string[] | undefined {
  if (!labelsJson) return undefined;
  try {
    const parsed: unknown = JSON.parse(labelsJson);
    if (Array.isArray(parsed)) return parsed.filter((l): l is string => typeof l === "string");
  } catch {
    return undefined;
  }
  return undefined;
}

const RESERVED_METADATA_PREFIXES = [
  "langwatch.",
  "gen_ai.",
  "metadata.sdk_",
  "metadata.telemetry_",
];
const RESERVED_METADATA_KEYS = new Set([
  "metadata.thread_id",
  "metadata.user_id",
  "metadata.customer_id",
  "metadata.labels",
  "metadata.prompt_ids",
  "metadata.topic_id",
  "metadata.subtopic_id",
]);

/** `metadata.*` attributes (reserved keys excluded), keyed without the prefix. */
function extractCustomMetadata(attrs: Record<string, string>): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith("metadata.")) continue;
    if (RESERVED_METADATA_KEYS.has(key)) continue;
    if (RESERVED_METADATA_PREFIXES.some((p) => key.startsWith(p))) continue;
    const customKey = key.slice("metadata.".length);
    if (customKey) result[customKey] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
