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
import { DEFERRED_CHECK_DELAY_MS } from "./originGate.reactor";

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

      // Guard: origin not yet resolved — originGate reactor handles deferred resolution
      if (!attrs["langwatch.origin"]) return;

      // Origin is known — dispatch to monitors, precondition matchers filter by origin.
      await dispatchEvaluations({ deps, tenantId, traceId, foldState, occurredAt: event.occurredAt });
    },
  };
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
          : {
              deduplication: {
                makeId: makeJobId,
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
