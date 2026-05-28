import { generate } from "@langwatch/ksuid";
import { evaluatorLoopBlockedCounter } from "../../../../metrics";
import type { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import type { QueueSendOptions } from "../../../queues";
import { ExecuteEvaluationCommand } from "../../evaluation-processing/commands/executeEvaluation.command";
import type { ExecuteEvaluationCommandData } from "../../evaluation-processing/schemas/commands";
import { KSUID_RESOURCES } from "../../../../../utils/constants";
import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorDefinition } from "../../../reactors/reactor.types";
import {
  MAX_PROCESSED_SPANS,
  type TraceSummaryData,
} from "../projections/traceSummary.foldProjection";
import { isSpanReceivedEvent, type TraceProcessingEvent } from "../schemas/events";
import { defineOriginGuardedTraceReactor } from "./_originGuardedReactor";
import { SYNTHETIC_SPAN_NAMES } from "~/server/tracer/constants";
import { DEFERRED_CHECK_DELAY_MS } from "./originGate.reactor";
import { featureFlagService } from "../../../../featureFlag";

const CAUSALITY_LOOP_GUARD_DISABLED_FLAG =
  "ops_es_causality_loop_guard_disabled";

const logger = createLogger(
  "langwatch:trace-processing:evaluation-trigger-reactor",
);

export interface EvaluationTriggerReactorDeps {
  monitors: MonitorService;
  evaluation: (data: ExecuteEvaluationCommandData, options?: QueueSendOptions<ExecuteEvaluationCommandData>) => Promise<void>;
}

/**
 * Dispatches evaluation commands for traces that have a resolved origin.
 *
 * Fires on every trace event (via traceSummary fold). If origin is absent,
 * returns early — the originGate reactor handles deferred resolution.
 * Once origin is present, iterates all enabled ON_MESSAGE monitors and
 * sends an executeEvaluation command per monitor.
 */
export function createEvaluationTriggerReactor(
  deps: EvaluationTriggerReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return defineOriginGuardedTraceReactor({
    name: "evaluationTrigger",
    jobIdPrefix: "eval-trigger",
    async handle(event, context) {
      // Bug 2 / #3875: synthetic event spans (e.g. thumbs-up/down feedback via /api/track_event)
      // do not contribute to fold IO and must not re-trigger ON_MESSAGE evaluator runs. We
      // share `SYNTHETIC_SPAN_NAMES` with the trace-summary fold (foldProjection.ts:88) so a
      // future synthetic name updates both sites at once.
      if (isSpanReceivedEvent(event) && SYNTHETIC_SPAN_NAMES.has(event.data.span.name)) {
        return;
      }
      const { tenantId, aggregateId: traceId, foldState } = context;

      // Oversized-trace guard (2026-05-28 incident follow-up). Past the same
      // processing cap the fold uses to stop deriving the summary
      // (MAX_PROCESSED_SPANS), a trace is a runaway / reused trace_id and is too
      // large to keep evaluating — re-running every ON_MESSAGE monitor per span
      // on a 26k-span trace is pure amplification for no added signal. Skip the
      // eval dispatch (lighter processing). The span itself is still stored and
      // the trace stays fully queryable: we drop the WORK, never the DATA.
      if (foldState.spanCount >= MAX_PROCESSED_SPANS) {
        logger.warn(
          {
            tenantId,
            observedTraceId: traceId,
            spanCount: foldState.spanCount,
            cap: MAX_PROCESSED_SPANS,
          },
          "Skipping evaluation dispatch — trace exceeds the processing cap (span still stored)",
        );
        return;
      }

      // Infinite-loop prevention (post-2026-05-11 incident). See
      // specs/monitors/online-evaluator-loop-prevention.feature.
      //
      // Depth-only per-span check (origin remains a user-configurable
      // precondition, not a hardcoded reactor rule): if the inbound
      // span's own `langwatch.reserved.causality_depth` attribute is
      // >= 1, it was emitted by an evaluator workflow (or downstream
      // of one). Skip dispatch.
      //
      // A fresh app-origin span on the same trace (depth 0) still
      // triggers normally — re-runs are allowed, only eval spans are
      // blocked.
      //
      // The primary guarantee that every eval-emitted span carries the
      // attribute is the nlpgo-side BaggageAttributeProcessor (stamps
      // every span at OnStart from a single baggage entry on context).
      //
      // Kill-switch: SYSTEM flag `ops_es_causality_loop_guard_disabled`
      // bypasses the check (emergency rollback without redeploy).
      // Resolved through featureFlagService so operators can flip it
      // from the Ops UI without restarting pods; the legacy
      // `LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD=1` env var still works
      // via the standard env-override path (uppercased flag key).
      const guardDisabled = await featureFlagService.isEnabled(
        CAUSALITY_LOOP_GUARD_DISABLED_FLAG,
        { distinctId: tenantId, defaultValue: false },
      );

      if (!guardDisabled && isSpanReceivedEvent(event)) {
        const reason = detectCausalityLoop({
          spanAttributes: event.data.span.attributes,
        });
        if (reason) {
          recordLoopBlocked(reason);
          logger.warn(
            { tenantId, observedTraceId: traceId, reason },
            "Skipping evaluation dispatch — causality loop guard fired",
          );
          return;
        }
      } else if (guardDisabled) {
        logger.warn(
          { tenantId, observedTraceId: traceId },
          "ops_es_causality_loop_guard_disabled is on, loop guard bypassed",
        );
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

const CAUSALITY_DEPTH_ATTR = "langwatch.reserved.causality_depth";

/**
 * Causality-loop detection on a single incoming span_received event.
 * Exported for unit testing.
 */
export function detectCausalityLoop(params: {
  spanAttributes: Array<{ key: string; value: unknown }> | undefined | null;
}): "depth_direct" | null {
  const depth = extractCausalityDepthFromOtlpAttrs(params.spanAttributes);
  if (depth >= 1) return "depth_direct";
  return null;
}

/**
 * OTLP spans deliver attributes as `[{key, value: AnyValue}]` arrays.
 * AnyValue is a union — string/int/bool/double/array. We accept any
 * encoding that parses to a positive finite integer.
 */
function extractCausalityDepthFromOtlpAttrs(
  attrs: Array<{ key: string; value: unknown }> | undefined | null,
): number {
  if (!Array.isArray(attrs)) return 0;
  for (const attr of attrs) {
    if (attr?.key !== CAUSALITY_DEPTH_ATTR) continue;
    const v = attr.value as Record<string, unknown> | number | string | null;
    let raw: unknown = v;
    if (v && typeof v === "object") {
      // Handle OTLP AnyValue: { intValue?, stringValue?, doubleValue? }
      raw =
        (v as Record<string, unknown>).intValue ??
        (v as Record<string, unknown>).stringValue ??
        (v as Record<string, unknown>).doubleValue ??
        v;
    }
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number.parseInt(raw, 10)
          : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function recordLoopBlocked(reason: string): void {
  // tenant attribution lives in the structured log line, not the
  // Prometheus label (cardinality control — see metrics.ts comment).
  evaluatorLoopBlockedCounter.inc({ reason });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function dispatchEvaluations({
  deps,
  tenantId,
  traceId,
  foldState,
  occurredAt,
}: {
  deps: EvaluationTriggerReactorDeps;
  tenantId: string;
  traceId: string;
  foldState: TraceSummaryData;
  occurredAt: number;
}): Promise<void> {
  const attrs = foldState.attributes ?? {};

  // Read all enabled ON_MESSAGE monitors for this project
  const monitors = await deps.monitors.getEnabledOnMessageMonitors(tenantId);

  if (monitors.length === 0) return;

  // Send executeEvaluation command per monitor (dedup + 30s delay handles the rest)
  const threadId = attrs["gen_ai.conversation.id"];
  const userId = attrs["langwatch.user_id"];
  const customerId = attrs["langwatch.customer_id"];
  const labels = parseLabels(attrs["langwatch.labels"]);
  const origin = attrs["langwatch.origin"];
  const hasError = foldState.containsErrorStatus;
  const promptIds = parseLabels(attrs["langwatch.prompt_ids"]);

  // Additional metadata for expanded precondition matching
  const topicId = foldState.topicId ?? undefined;
  const subTopicId = foldState.subTopicId ?? undefined;
  const spanModels = foldState.models.length > 0 ? foldState.models : undefined;
  const customMetadata = extractCustomMetadata(attrs);
  const computedInput = foldState.computedInput ?? undefined;
  const computedOutput = foldState.computedOutput ?? undefined;

  for (const monitor of monitors) {
    const evaluationId = generate(KSUID_RESOURCES.EVALUATION).toString();
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
        threadId,
        userId,
        customerId,
        labels,
        origin,
        hasError,
        promptIds,
        topicId,
        subTopicId,
        customMetadata,
        spanModels,
        computedInput,
        computedOutput,
      };

      const isThreadLevel =
        monitor.threadIdleTimeout &&
        monitor.threadIdleTimeout > 0 &&
        threadId;

      const sendOptions: QueueSendOptions<ExecuteEvaluationCommandData> | undefined =
        isThreadLevel
          ? {
              delay: monitor.threadIdleTimeout! * 1000,
              deduplication: {
                makeId: ExecuteEvaluationCommand.makeJobId,
                ttlMs: monitor.threadIdleTimeout! * 1000,
              },
            }
          : {
              deduplication: {
                makeId: ExecuteEvaluationCommand.makeJobId,
                // 6 min — outlasts the 5-min deferred origin resolution window
                // so that if the reactor fires twice (once from a late span,
                // once from the deferred OriginResolvedEvent), the second
                // dispatch is squashed by the dedup key.
                ttlMs: DEFERRED_CHECK_DELAY_MS + 60_000,
              },
            };

      await deps.evaluation(payload, sendOptions);
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
    const parsed = JSON.parse(labelsJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((l): l is string => typeof l === "string");
    }
  } catch {
    // Not valid JSON, ignore
  }
  return undefined;
}

/**
 * Extract custom metadata from span attributes.
 * Entries starting with "metadata." (excluding reserved keys) are treated
 * as custom metadata key-value pairs.
 */
function extractCustomMetadata(
  attrs: Record<string, string>,
): Record<string, string> | undefined {
  const RESERVED_PREFIXES = [
    "langwatch.",
    "gen_ai.",
    "metadata.sdk_",
    "metadata.telemetry_",
  ];
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
    if (RESERVED_PREFIXES.some((p) => key.startsWith(p))) continue;
    // Strip "metadata." prefix for the custom key
    const customKey = key.slice("metadata.".length);
    if (customKey) {
      result[customKey] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
