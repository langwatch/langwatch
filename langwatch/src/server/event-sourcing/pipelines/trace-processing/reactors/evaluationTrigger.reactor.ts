import { generate } from "@langwatch/ksuid";
import type { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import type { QueueSendOptions } from "../../../queues";
import { makeJobId } from "../../evaluation-processing/commands/executeEvaluation.command";
import type { ExecuteEvaluationCommandData } from "../../evaluation-processing/schemas/commands";
import { KSUID_RESOURCES } from "../../../../../utils/constants";
import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { createTenantId } from "../../../domain/tenantId";

const logger = createLogger(
  "langwatch:trace-processing:evaluation-trigger-reactor",
);

/** Delay (ms) before the deferred evaluation check fires */
const DEFERRED_CHECK_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export interface DeferredEvaluationPayload {
  tenantId: string;
  traceId: string;
  occurredAt: number;
}

export interface EvaluationTriggerReactorDeps {
  monitors: MonitorService;
  evaluation: (data: ExecuteEvaluationCommandData, options?: QueueSendOptions<ExecuteEvaluationCommandData>) => Promise<void>;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  scheduleDeferred: (payload: DeferredEvaluationPayload) => Promise<void>;
}

/**
 * Resolves the origin of a trace from its fold state attributes.
 *
 * Returns:
 * - The explicit origin string when `langwatch.origin` is set
 * - `"application"` when no origin but `sdk.name` is present (old SDK heuristic)
 * - `null` when no origin and no SDK info (needs deferred check)
 */
export function resolveOrigin(attrs: Record<string, string>): string | null {
  const origin = attrs["langwatch.origin"];
  if (origin) return origin;

  // SDK heuristic: if sdk.name is present, this is an old SDK trace
  // that doesn't set explicit origin. Old SDK evaluations/simulations
  // are already tagged via legacy inference, so untagged = application.
  const sdkName = attrs["sdk.name"];
  if (sdkName) return "application";

  // No origin and no SDK info: cannot determine yet
  return null;
}

export function createEvaluationTriggerReactor(
  deps: EvaluationTriggerReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "evaluationTrigger",
    options: {
      makeJobId: (payload) =>
        `eval-trigger:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 30_000,
      delay: 30_000,
    },

    async handle(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, aggregateId: traceId, foldState } = context;

      // Guard: skip old traces (resyncing)
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;

      // Guard: skip traces blocked by guardrail with no output
      if (foldState.blockedByGuardrail && !foldState.computedOutput) return;

      const attrs = foldState.attributes ?? {};

      // Phase 1: Origin resolution
      const resolvedOrigin = resolveOrigin(attrs);

      if (resolvedOrigin === null) {
        // No origin and no SDK info: schedule deferred check.
        // We can't dispatch yet because precondition matchers need
        // a concrete origin value — empty means "pending".
        logger.debug(
          { tenantId, traceId },
          "No origin or SDK info, scheduling deferred evaluation check",
        );
        await deps.scheduleDeferred({
          tenantId,
          traceId,
          occurredAt: event.occurredAt,
        });
        return;
      }

      // Origin is known (explicit or inferred via SDK heuristic).
      // Dispatch to monitors — precondition matchers handle filtering by origin.
      await dispatchEvaluations({ deps, tenantId, traceId, foldState, occurredAt: event.occurredAt });
    },
  };
}

/**
 * Creates the deferred evaluation check handler.
 *
 * This handler is called after a 5-minute delay for traces that had no origin
 * and no SDK info at normal debounce time. It re-reads the fold state from
 * the projection store (not the captured state) to see if an origin was set
 * in the meantime.
 */
export function createDeferredEvaluationHandler(deps: EvaluationTriggerReactorDeps) {
  return async (payload: DeferredEvaluationPayload): Promise<void> => {
    const { tenantId, traceId, occurredAt } = payload;

    // Re-read fold state from the projection store (fresh, not captured)
    const foldState = await deps.traceSummaryStore.get(traceId, { tenantId: createTenantId(tenantId), aggregateId: traceId });
    if (!foldState) {
      logger.debug(
        { tenantId, traceId },
        "Deferred check: fold state not found, skipping",
      );
      return;
    }

    const attrs = foldState.attributes ?? {};
    const origin = attrs["langwatch.origin"];

    // If origin is still empty after 5 min, stamp it as "application"
    // and persist so it's queryable from the dashboard.
    if (!origin) {
      attrs["langwatch.origin"] = "application";
      foldState.attributes = attrs;

      // Persist the stamped origin to ClickHouse
      await deps.traceSummaryStore.store(foldState, {
        tenantId: createTenantId(tenantId),
        aggregateId: traceId,
      });

      logger.debug(
        { tenantId, traceId },
        "Deferred check: no origin after 5 min, stamped and persisted as application",
      );
    } else {
      logger.debug(
        { tenantId, traceId, origin },
        "Deferred check: origin now set, dispatching with it",
      );
    }

    // Dispatch — precondition matchers handle filtering by origin
    await dispatchEvaluations({ deps, tenantId, traceId, foldState, occurredAt });
  };
}

/** Dedup key for deferred evaluation checks */
export function makeDeferredJobId(payload: DeferredEvaluationPayload): string {
  return `deferred-eval-trigger:${payload.tenantId}:${payload.traceId}`;
}

/** Delay for deferred evaluation checks */
export { DEFERRED_CHECK_DELAY_MS };

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
  const satisfactionScore = (foldState as Record<string, unknown>).satisfactionScore as number | undefined;
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
        evaluatorName: monitor.name,
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
        satisfactionScore,
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
                makeId: makeJobId,
                ttlMs: monitor.threadIdleTimeout! * 1000,
              },
            }
          : undefined;

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
