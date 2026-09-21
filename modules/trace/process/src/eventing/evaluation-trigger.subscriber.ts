import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { QueueSendOptions } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { generate } from "@langwatch/ksuid";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import {
  SYNTHETIC_TRACE_SPAN_NAMES,
  isSpanReceivedEvent,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

import type {
  TraceEvaluationDispatch,
  TraceEvaluationLoopBlockReason,
  TraceEvaluationLoopMetrics,
  TraceEvaluationMonitor,
} from "../app/trace.members.ts";
import { DEFERRED_ORIGIN_CHECK_DELAY_MS } from "../services/eventing.deferred-origin.service.ts";
import {
  defineOriginGuardedTraceSubscriber,
  type TraceSummarySubscriber,
} from "./origin-guarded.subscriber.ts";
import { MAX_PROCESSED_SPANS } from "./trace-summary.projection.ts";

const CAUSALITY_LOOP_GUARD_DISABLED_FLAG = "ops_es_causality_loop_guard_disabled";

/**
 * The application's `KSUID_RESOURCES.EVALUATION`. The prefix is part of every
 * evaluation id ever written, so it is a literal here and pinned by literal in
 * the test rather than imported from a module this package cannot reach.
 */
const EVALUATION_KSUID_RESOURCE = "eval";

const logger = createLogger("langwatch:trace-processing:evaluation-trigger");

export interface EvaluationTriggerSubscriberDeps {
  featureFlags: FeatureFlagApi;
  /**
   * Narrowed from the whole `MonitorService` to the one listing this
   * subscriber calls. The application narrows the same capability inline with
   * `Pick<>`, which narrows the type and not the wiring.
   */
  monitors: TraceEvaluationMonitor;
  /** The evaluation command queue, plus the dedup identity that belongs to it. */
  evaluation: TraceEvaluationDispatch;
  /**
   * How an operator sees the loop guard firing. The application increments its
   * own prom-client counter here.
   */
  metrics: TraceEvaluationLoopMetrics;
}

/** Pure relevance guard: evaluated pre-enqueue via when(). Side-effect free
 * per ExtraGuard contract. */
function isDispatchableEvaluationEvent(event: TraceProcessingEvent): boolean {
  // Bug 2 / #3875: synthetic event spans (e.g. thumbs-up/down feedback via /api/track_event)
  // do not contribute to fold IO and must not re-trigger ON_MESSAGE evaluator runs. We
  // share `SYNTHETIC_TRACE_SPAN_NAMES` with the trace-summary fold so a future synthetic
  // name updates both sites at once.
  return !(isSpanReceivedEvent(event) && SYNTHETIC_TRACE_SPAN_NAMES.has(event.data.span.name));
}

/**
 * Dispatches evaluation commands for traces with a resolved origin. Fires on
 * every trace event; if origin is absent, returns early (originGate handles
 * deferred resolution). Otherwise iterates enabled ON_MESSAGE monitors.
 */
export function createEvaluationTriggerSubscriber(
  deps: EvaluationTriggerSubscriberDeps,
): TraceSummarySubscriber {
  return defineOriginGuardedTraceSubscriber({
    name: "evaluationTrigger",
    isRelevant: isDispatchableEvaluationEvent,
    async handler(event, context) {
      const { tenantId, aggregateId: traceId, state: foldState } = context;

      if (hasReachedProcessingCap({ tenantId, traceId, foldState })) return;
      if (
        await causalityLoopGuardFired({
          event,
          foldState,
          tenantId,
          traceId,
          featureFlags: deps.featureFlags,
          metrics: deps.metrics,
        })
      ) {
        return;
      }

      // Origin is known — dispatch to monitors, precondition matchers filter by origin.
      await dispatchEvaluations({
        deps,
        tenantId,
        traceId,
        foldState,
        occurredAt: event.occurredAt,
      });
    },
  });
}

/** Oversized-trace guard: skips eval past MAX_PROCESSED_SPANS. Keeps data,
 * drops work only. */
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
  // Log once, on the first crossing only. A runaway trace would otherwise
  // emit thousands of identical warns — the very per-span amplification we
  // are skipping the eval to avoid.
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
  event,
  foldState,
  tenantId,
  traceId,
  featureFlags,
  metrics,
}: {
  event: TraceProcessingEvent;
  foldState: TraceSummaryData;
  tenantId: string;
  traceId: string;
  featureFlags: FeatureFlagApi;
  metrics: TraceEvaluationLoopMetrics;
}): Promise<boolean> {
  const guardDisabled = await featureFlags.isEnabled(CAUSALITY_LOOP_GUARD_DISABLED_FLAG, {
    kind: "system",
  });

  if (guardDisabled) {
    logger.warn(
      { tenantId, observedTraceId: traceId },
      "ops_es_causality_loop_guard_disabled is on, loop guard bypassed",
    );
    return false;
  }

  const reason = isSpanReceivedEvent(event)
    ? detectCausalityLoop({ spanAttributes: event.data.span.attributes })
    : detectFoldedCausalityLoop({ foldState });
  if (!reason) return false;

  // Tenant attribution lives in the structured log line, not the metric
  // label — one label per project is unbounded cardinality on a series that
  // fires per dispatch.
  metrics.loopBlocked(reason);
  logger.warn(
    { tenantId, observedTraceId: traceId, reason },
    "Skipping evaluation dispatch — causality loop guard fired",
  );
  return true;
}

const CAUSALITY_DEPTH_ATTR = "langwatch.reserved.causality_depth";

/**
 * Causality-loop detection on a single incoming span_received event.
 * Exported so the guard can be pinned directly.
 */
export function detectCausalityLoop(params: {
  spanAttributes: { key: string; value: unknown }[] | undefined | null;
}): TraceEvaluationLoopBlockReason | null {
  const depth = extractCausalityDepthFromOtlpAttrs(params.spanAttributes);
  if (depth >= 1) return "depth_direct";
  return null;
}

/**
 * Causality-loop detection on the deferred-origin path (`origin_resolved`,
 * no span payload) — reads the depth the fold already accumulated instead.
 */
export function detectFoldedCausalityLoop(params: {
  foldState: Pick<TraceSummaryData, "attributes">;
}): TraceEvaluationLoopBlockReason | null {
  const depth = Number(params.foldState.attributes?.[CAUSALITY_DEPTH_ATTR]);
  if (Number.isFinite(depth) && depth >= 1) return "depth_fold";
  return null;
}

/**
 * OTLP spans deliver attributes as `[{key, value: AnyValue}]` arrays.
 * AnyValue is a union — string/int/bool/double/array. We accept any
 * encoding that parses to a positive finite integer.
 */
function readNumericAttrValue(value: unknown): number | undefined {
  let raw: unknown = value;
  if (value && typeof value === "object") {
    // Handle OTLP AnyValue: { intValue?, stringValue?, doubleValue? }
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
    const n = readNumericAttrValue(attr.value);
    if (n !== undefined && n > 0) return n;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The trace-derived fields every monitor's command payload shares. */
function buildTraceEvaluationFields(foldState: TraceSummaryData): {
  threadId: string | undefined;
  userId: string | undefined;
  customerId: string | undefined;
  labels: string[] | undefined;
  origin: string | undefined;
  hasError: boolean;
  promptIds: string[] | undefined;
  topicId: string | undefined;
  subTopicId: string | undefined;
  spanModels: string[] | undefined;
  customMetadata: Record<string, string> | undefined;
  computedInput: string | undefined;
  computedOutput: string | undefined;
} {
  const attrs = foldState.attributes ?? {};
  return {
    threadId: attrs["gen_ai.conversation.id"],
    userId: attrs["langwatch.user_id"],
    customerId: attrs["langwatch.customer_id"],
    labels: parseLabels(attrs["langwatch.labels"]),
    origin: attrs["langwatch.origin"],
    hasError: foldState.containsErrorStatus,
    promptIds: parseLabels(attrs["langwatch.prompt_ids"]),
    // Additional metadata for expanded precondition matching
    topicId: foldState.topicId ?? undefined,
    subTopicId: foldState.subTopicId ?? undefined,
    spanModels: foldState.models.length > 0 ? foldState.models : undefined,
    customMetadata: extractCustomMetadata(attrs),
    computedInput: foldState.computedInput ?? undefined,
    computedOutput: foldState.computedOutput ?? undefined,
  };
}

async function dispatchEvaluations({
  deps,
  tenantId,
  traceId,
  foldState,
  occurredAt,
}: {
  deps: EvaluationTriggerSubscriberDeps;
  tenantId: string;
  traceId: string;
  foldState: TraceSummaryData;
  occurredAt: number;
}): Promise<void> {
  // Read all enabled ON_MESSAGE monitors for this project
  const monitors = await deps.monitors.getEnabledOnMessageMonitors(tenantId);

  if (monitors.length === 0) return;

  // Send executeEvaluation command per monitor (dedup + 30s delay handles the rest)
  const traceFields = buildTraceEvaluationFields(foldState);

  for (const monitor of monitors) {
    const evaluationId = generate(EVALUATION_KSUID_RESOURCE).toString();
    try {
      const payload: ExecuteEvaluationCommandData = {
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
      };

      await deps.evaluation.send(
        payload,
        buildSendOptions({
          dispatch: deps.evaluation,
          monitor,
          threadId: traceFields.threadId,
        }),
      );
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

function buildSendOptions({
  dispatch,
  monitor,
  threadId,
}: {
  dispatch: TraceEvaluationDispatch;
  monitor: Pick<MonitorSummary, "threadIdleTimeout">;
  threadId: string | undefined;
}): QueueSendOptions<ExecuteEvaluationCommandData> {
  const makeId = (payload: ExecuteEvaluationCommandData): string => dispatch.makeDedupId(payload);
  const isThreadLevel = monitor.threadIdleTimeout && monitor.threadIdleTimeout > 0 && threadId;

  if (isThreadLevel) {
    return {
      delay: monitor.threadIdleTimeout! * 1000,
      deduplication: {
        makeId,
        ttlMs: monitor.threadIdleTimeout! * 1000,
        // Defensive on this branch: the thread dedup TTL roughly equals the
        // dispatch delay (both = threadIdleTimeout), so the post-dispatch
        // squash window is ~0. The load-bearing fix is the trace-level
        // deferred branch below (6-min TTL >> dispatch latency) (#3912).
        shouldSurviveDispatch: true,
      },
    };
  }

  return {
    deduplication: {
      makeId,
      // 6 min — outlasts the 5-min deferred origin resolution window
      // so that if the subscriber fires twice (once from a late span,
      // once from the deferred OriginResolvedEvent), the second
      // dispatch is squashed by the dedup key.
      ttlMs: DEFERRED_ORIGIN_CHECK_DELAY_MS + 60_000,
      // Honor the still-alive dedup key even after the first command was
      // dispatched, so the second trigger is squashed rather than
      // DEL+restaged into a duplicate evaluation run (#3912).
      shouldSurviveDispatch: true,
    },
  };
}

function parseLabels(labelsJson: string | undefined): string[] | undefined {
  if (!labelsJson) return undefined;
  try {
    const parsed = JSON.parse(labelsJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((l): l is string => typeof l === "string");
    }
  } catch {
    // Not valid JSON, ignore
    return undefined;
  }
  return undefined;
}

/**
 * Extract custom metadata from span attributes.
 * Entries starting with "metadata." (excluding reserved keys) are treated
 * as custom metadata key-value pairs.
 */
function extractCustomMetadata(attrs: Record<string, string>): Record<string, string> | undefined {
  const RESERVED_PREFIXES = ["langwatch.", "gen_ai.", "metadata.sdk_", "metadata.telemetry_"];
  const RESERVED_KEYS = new Set([
    "metadata.thread_id",
    "metadata.user_id",
    "metadata.customer_id",
    "metadata.labels",
    "metadata.prompt_ids",
    "metadata.topic_id",
    "metadata.subtopic_id",
  ]);

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith("metadata.")) continue;
    if (RESERVED_KEYS.has(key)) continue;
    const isReservedPrefix = RESERVED_PREFIXES.some((p) => key.startsWith(p));
    if (isReservedPrefix) continue;
    // Strip "metadata." prefix for the custom key
    const customKey = key.slice("metadata.".length);
    if (customKey) {
      result[customKey] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
