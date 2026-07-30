import crypto from "node:crypto";

import { createLogger } from "@langwatch/observability";

import type { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { IntentExecutor } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";
import type { QueueSendOptions } from "~/server/event-sourcing.old/queues";
import { featureFlagService } from "~/server/featureFlag";
import { evaluatorLoopBlockedCounter } from "~/server/metrics";

import { ExecuteEvaluationCommand } from "../../evaluation-processing/commands/executeEvaluation.command";
import type { ExecuteEvaluationCommandData } from "../../evaluation-processing/schemas/commands";
import { MAX_PROCESSED_SPANS } from "../projections/traceSummary.foldProjection";
import {
  CAUSALITY_LOOP_GUARD_DISABLED_FLAG,
  EVALUATION_REQUEST_DEDUP_TTL_MS,
  type EvaluationTriggerRequestIntent,
} from "./evaluationTriggerProcess.types";

const logger = createLogger(
  "langwatch:trace-processing:evaluation-trigger-process",
);

/** What the evaluation request needs from the trace and monitor domains. */
export interface EvaluationTriggerDispatchDeps {
  monitors: MonitorService;
  /**
   * The trace's committed summary.
   *
   * Read here rather than carried on the intent, for two reasons that point
   * the same way. The commands need the trace's accumulated attributes, its
   * computed input and output, its topics and its models — none of which a
   * process may hold, because everything it holds is persisted verbatim into
   * the instance row and the outbox (ADR-098/ADR-103). And the summary read at
   * dispatch time is the one the evaluation will actually run against, whereas
   * a copy taken when the first span landed would be a snapshot of a trace
   * that had barely started.
   */
  readTraceSummary: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }) => Promise<TraceSummaryData | null>;
  /** Dispatches one monitor's evaluation onto the evaluation pipeline. */
  evaluation: (
    data: ExecuteEvaluationCommandData,
    options?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ) => Promise<void>;
}

/**
 * Executes the `requestEvaluations` intent: runs the project's on-message
 * monitors against a trace that has gone quiet.
 *
 * **This is where every fallible guard lives, and that is the point.** The
 * predicate this replaces was evaluated before the queue and failed OPEN — a
 * throw was caught, logged and read as "yes", so a monitor was never skipped
 * by an error. Its pre-enqueue successor fails LOST, because the routing seam
 * has no retry behind it (ADR-098). Moving the
 * guard wholesale into this handler inverts it back and then some: a throw
 * here neither drops the evaluation nor waves it through, it re-leases the
 * message and asks again.
 *
 * So the monitor lookup, the trace read-back, the origin and guardrail checks
 * and the loop guard's feature flag are all here, and the only decisions taken
 * before the queue are total questions about the event itself.
 *
 * A trace this handler DECLINES is declined deliberately — no monitors, an
 * origin the trace never resolved, a guardrail block with nothing to show, or
 * a loop. A trace it cannot read is not declined; it throws, and the outbox
 * asks again.
 */
export function createEvaluationTriggerRequestHandler(
  deps: EvaluationTriggerDispatchDeps,
): IntentExecutor<EvaluationTriggerRequestIntent> {
  return async (payload) => {
    const { tenantId, traceId } = payload;

    if (await isLoopBlocked(payload)) return;

    const summary = await deps.readTraceSummary({
      tenantId,
      traceId,
      occurredAtMs: payload.occurredAt,
    });

    // Not "this trace has nothing to evaluate" — it is "we could not find out".
    // Throwing hands it back to the outbox, which is the whole reason the
    // dispatch is durable; swallowing it here would reintroduce the silent
    // skip this process exists to remove.
    if (!summary) {
      throw new Error(
        `Trace summary not found for evaluation dispatch (trace ${traceId})`,
      );
    }

    if (isOversizedTrace(summary)) {
      // Recorded rather than skipped quietly, so a runaway trace stays visible
      // (`specs/trace-processing/oversized-trace-lighter-processing.feature`).
      // One line per request, not per span: the request is already the whole
      // quiet period's worth of spans collapsed into one ask.
      logger.warn(
        {
          tenantId,
          observedTraceId: traceId,
          spanCount: summary.spanCount,
          cap: MAX_PROCESSED_SPANS,
        },
        "Declining evaluation dispatch — the trace reached the processing cap (spans still stored)",
      );
      return;
    }

    if (!isEvaluableTrace(summary)) {
      logger.debug(
        { tenantId, traceId },
        "Declining evaluation dispatch — the trace is not evaluable",
      );
      return;
    }

    const monitors = await deps.monitors.getEnabledOnMessageMonitors(tenantId);
    if (monitors.length === 0) return;

    await dispatchEvaluations({ deps, payload, summary, monitors });
  };
}

/**
 * Infinite-loop prevention (post-2026-05-11 incident). See
 * `specs/monitors/online-evaluator-loop-prevention.feature`.
 *
 * **Per span, not per trace.** Nothing this request is asking about was real
 * execution — every span behind it was emitted by an evaluator workflow or
 * downstream of one — so running it would evaluate our own output. A fresh
 * span at causality depth zero re-arms the trigger and arrives here with a
 * pending count of its own, so re-runs on genuine new activity are allowed;
 * only evaluation output is blocked.
 *
 * Reading a CUMULATIVE eligible count here is what broke the guarantee its
 * predecessor had. This feature's own traceparent propagation makes an
 * evaluator's spans children of the trace being evaluated, so a trace that
 * ever had one real span would answer "not a loop" for every evaluator span
 * that followed — a self-sustaining loop with the command queue's dedup TTL
 * for a period, bounded only by the trace-age cutoff, and invisible because
 * this counter never moved.
 *
 * The flag read is what keeps this in the handler rather than beside the
 * queue: it is IO, and an operator flipping the kill switch must be able to
 * roll the guard back without a redeploy.
 */
async function isLoopBlocked(
  payload: EvaluationTriggerRequestIntent,
): Promise<boolean> {
  const {
    tenantId,
    traceId,
    pendingEligibleSpanCount,
    evaluatorEmittedSpanCount,
  } = payload;

  if (pendingEligibleSpanCount > 0) return false;

  // Nothing an evaluator emitted either — an origin resolving on a trace whose
  // spans have not landed yet, say. Not a loop, and not something to count as
  // one.
  if (evaluatorEmittedSpanCount === 0) return false;

  const guardDisabled = await featureFlagService.isEnabled(
    CAUSALITY_LOOP_GUARD_DISABLED_FLAG,
    { distinctId: tenantId, defaultValue: false },
  );

  if (guardDisabled) {
    logger.warn(
      { tenantId, observedTraceId: traceId },
      "ops_es_causality_loop_guard_disabled is on, loop guard bypassed",
    );
    return false;
  }

  // Tenant attribution lives in the structured log line, not the Prometheus
  // label (cardinality control — see metrics.ts).
  evaluatorLoopBlockedCounter.inc({ reason: "depth_direct" });
  logger.warn(
    { tenantId, observedTraceId: traceId, reason: "depth_direct" },
    "Declining evaluation dispatch — causality loop guard fired",
  );
  return true;
}

/**
 * A runaway trace — a reused `trace_id`, an instrumentation loop — past the
 * same cap the trace-summary fold uses to stop deriving (2026-05-28 incident
 * follow-up).
 *
 * Past it the summary this request would evaluate is frozen, so re-running the
 * project's monitors buys no added signal and pays for the whole set again.
 * The WORK is refused, never the DATA: every span is stored and the trace
 * stays fully queryable.
 */
function isOversizedTrace(summary: TraceSummaryData): boolean {
  return summary.spanCount >= MAX_PROCESSED_SPANS;
}

/**
 * Whether the committed trace is one an on-message monitor may run against.
 *
 * A trace with no origin is not declined for good: the origin gate writes one
 * within its grace period, and the `origin_resolved` that follows re-arms this
 * trace's quiet period and asks again. Precondition matchers filter by origin
 * from there, so the origin is a precondition rather than a rule here.
 */
function isEvaluableTrace(summary: TraceSummaryData): boolean {
  if (summary.blockedByGuardrail && !summary.computedOutput) return false;
  return Boolean(summary.attributes?.["langwatch.origin"]);
}

async function dispatchEvaluations({
  deps,
  payload,
  summary,
  monitors,
}: {
  deps: EvaluationTriggerDispatchDeps;
  payload: EvaluationTriggerRequestIntent;
  summary: TraceSummaryData;
  monitors: Awaited<ReturnType<MonitorService["getEnabledOnMessageMonitors"]>>;
}): Promise<void> {
  const { tenantId, traceId, occurredAt } = payload;
  const attrs = summary.attributes ?? {};

  const threadId = attrs["gen_ai.conversation.id"];
  const base = {
    tenantId,
    traceId,
    isGuardrail: false,
    occurredAt,
    threadId,
    userId: attrs["langwatch.user_id"],
    customerId: attrs["langwatch.customer_id"],
    labels: parseLabels(attrs["langwatch.labels"]),
    origin: attrs["langwatch.origin"],
    hasError: summary.containsErrorStatus,
    promptIds: parseLabels(attrs["langwatch.prompt_ids"]),
    topicId: summary.topicId ?? undefined,
    subTopicId: summary.subTopicId ?? undefined,
    spanModels: summary.models.length > 0 ? summary.models : undefined,
    customMetadata: extractCustomMetadata(attrs),
    computedInput: summary.computedInput ?? undefined,
    computedOutput: summary.computedOutput ?? undefined,
  };

  const failures: unknown[] = [];

  for (const monitor of monitors) {
    const evaluationId = derivedEvaluationId({
      tenantId,
      traceId,
      evaluatorId: monitor.id,
      generation: payload.requestGeneration,
    });
    const data: ExecuteEvaluationCommandData = {
      ...base,
      evaluationId,
      evaluatorId: monitor.id,
      evaluatorType: monitor.checkType,
      evaluatorName: monitor.evaluator?.name ?? monitor.name,
      threadIdleTimeout: monitor.threadIdleTimeout ?? undefined,
    };

    try {
      await deps.evaluation(data, sendOptionsFor({ monitor, threadId }));
    } catch (error) {
      // Collected rather than rethrown immediately: one unreachable monitor
      // must not stop the rest of the project's monitors from being asked. It
      // is NOT swallowed — see the throw below.
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
      failures.push(error);
    }
  }

  logger.debug(
    {
      tenantId,
      traceId,
      monitorCount: monitors.length,
      failedCount: failures.length,
    },
    "Requested executeEvaluation commands for trace",
  );

  // Any failure re-leases the WHOLE request — the predecessor logged it and
  // carried on, which permanently lost that monitor's evaluation for that
  // trace with no error surfaced anywhere
  // (`specs/monitors/evaluation-dispatch-durability.feature`). Every monitor
  // is attempted first, so one unreachable queue costs a retry rather than the
  // other monitors' results, and the ones that already dispatched are
  // collapsed on the retry by their derived evaluation id.
  if (failures.length > 0) {
    throw failures[0] instanceof Error
      ? failures[0]
      : new Error(String(failures[0]));
  }
}

/**
 * The evaluation's identity, derived from the work rather than minted
 * (ADR-098).
 *
 * This is what makes the retry above safe. The evaluation aggregate is keyed
 * by `evaluationId` (`ExecuteEvaluationCommand.getAggregateId`), so a monitor
 * that already dispatched and is asked again at the same generation lands on
 * the SAME evaluation rather than a second, chargeable run. A minted id would
 * have left that to the command queue's dedup window, which is sized
 * `threadIdleTimeout * 1000` on the thread-level branch — as little as a
 * second, and the outbox's own backoff is 1s/2s/4s, so the window can lapse
 * between attempts and bill the customer twice.
 *
 * The generation is in the hash, so a trace that resumes — or that only became
 * evaluable when its origin resolved — still gets a genuine re-run rather than
 * being collapsed onto its first evaluation forever.
 *
 * Hashed rather than concatenated for the same reason `customEvaluationSync`
 * hashes: the parts are unbounded and would otherwise produce an unbounded id.
 */
function derivedEvaluationId({
  tenantId,
  traceId,
  evaluatorId,
  generation,
}: {
  tenantId: string;
  traceId: string;
  evaluatorId: string;
  generation: number;
}): string {
  const hash = crypto
    .createHash("md5")
    .update(
      JSON.stringify({
        kind: "evaluationTrigger",
        tenantId,
        traceId,
        evaluatorId,
        generation,
      }),
    )
    .digest("hex");
  return `eval_md5_${hash}`;
}

/**
 * How one monitor's command is deduplicated on the evaluation queue.
 *
 * A monitor that waits for a conversation to go idle keys on the THREAD, so
 * sibling traces of one conversation collapse onto a single evaluation — the
 * one thing the trace-keyed process above cannot express, because its process
 * key is the trace's aggregate id. Its wait therefore remains a queue delay:
 * sizing a deadline from a monitor's configuration needs a read, and the
 * handlers that arm deadlines are pure.
 */
function sendOptionsFor({
  monitor,
  threadId,
}: {
  monitor: { threadIdleTimeout: number | null };
  threadId: string | undefined;
}): QueueSendOptions<ExecuteEvaluationCommandData> {
  const idleTimeout = monitor.threadIdleTimeout;

  if (idleTimeout && idleTimeout > 0 && threadId) {
    return {
      delay: idleTimeout * 1000,
      deduplication: {
        makeId: ExecuteEvaluationCommand.makeJobId,
        ttlMs: idleTimeout * 1000,
        shouldSurviveDispatch: true,
      },
    };
  }

  return {
    deduplication: {
      makeId: ExecuteEvaluationCommand.makeJobId,
      ttlMs: EVALUATION_REQUEST_DEDUP_TTL_MS,
      // Honour the still-alive dedup key even after the first command was
      // dispatched, so a second ask is squashed rather than restaged into a
      // duplicate evaluation run (#3912).
      shouldSurviveDispatch: true,
    },
  };
}

function parseLabels(labelsJson: string | undefined): string[] | undefined {
  if (!labelsJson) return undefined;
  try {
    const parsed: unknown = JSON.parse(labelsJson);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (label): label is string => typeof label === "string",
      );
    }
  } catch {
    // Not valid JSON, ignore.
  }
  return undefined;
}

/**
 * Custom metadata from the trace's attributes: entries under `metadata.`
 * that are not one of the reserved keys the command already carries in its
 * own fields.
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
    if (RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    const customKey = key.slice("metadata.".length);
    if (customKey) result[customKey] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
