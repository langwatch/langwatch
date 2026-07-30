import { createLogger } from "@langwatch/observability";
import {
  NOTIFY_TRIGGER_ACTIONS,
  triggerReadsEvaluations,
} from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { TriggerSummary } from "~/server/app-layer/automations/repositories/trigger.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { MatchRecordedData } from "./aggregate";

const logger = createLogger("langwatch:automations:subscribers");

/**
 * An event subscriber (ADR-098 decision 1): at-most-once, never replayed, no
 * projection state, no retry budget — a lost job is lost permanently, so a
 * subscriber may only carry work whose loss is acceptable. A stake-bearing
 * effect belongs in a `*.process.ts` process manager.
 */
export interface AutomationSubscriber<SourceEvent> {
  readonly name: string;
  readonly eventTypes: readonly string[];
  /** Runs before any retry budget exists, so it is total by construction: a
   *  throw here loses the source event's job permanently. */
  readonly enqueue?: { readonly filter: (event: SourceEvent) => boolean };
  readonly options?: {
    /** Holds the job so a burst of source events lands before `handle` runs. */
    readonly delay?: number;
    /** Collapses repeat deliveries onto one run. `extend`/`replace` default to
     *  `true`; both `false` closes the window on schedule regardless of
     *  continuing traffic, which is what stops a project under constant load
     *  from starving its own window. */
    readonly deduplication?: {
      readonly makeId: (event: SourceEvent) => string;
      readonly ttlMs: number;
      readonly extend?: boolean;
      readonly replace?: boolean;
    };
  };
  handle(event: SourceEvent, context: { tenantId: string }): Promise<void>;
}

export interface EvaluationOutcomeEvent {
  readonly type: string;
  readonly tenantId: string;
  /** The evaluation's own aggregate id, used only to key the dedup window. */
  readonly aggregateId: string;
  readonly occurredAt: number;
  readonly data: unknown;
}

/** Debounce before a terminal evaluation outcome is matched against
 *  automations, so a burst of evaluations for one trace collapses. */
export const MATCH_DELAY_MS = 10_000;
/** Dedup window collapsing repeat deliveries of one evaluation's outcome. */
export const DEDUP_TTL_MS = 30_000;
/** Replay floods, resyncs and late results never raise a live alert. */
const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * The two things this subscriber acts on, read off the committed event rather
 * than a fold: a terminal status, and the trace the outcome belongs to.
 *
 * Total by construction — it doubles as the enqueue filter. `traceId` is
 * absent on a `completed` event committed before the field existed, and on a
 * `reported` event naming no trace; absence is a skip, because an evaluation
 * nobody can point at a trace has no summary to match automations against.
 */
function readAlertableOutcome(
  event: EvaluationOutcomeEvent,
  isTerminalStatus: (status: string) => boolean,
): { traceId: string } | null {
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) return null;
  if (!("status" in data) || !("traceId" in data)) return null;
  const { status, traceId } = data;
  if (typeof status !== "string" || !isTerminalStatus(status)) return null;
  if (typeof traceId !== "string" || traceId.length === 0) return null;
  return { traceId };
}

export interface EvaluationTriggerMatchPorts {
  getActiveTraceTriggersForProject(
    projectId: string,
  ): Promise<readonly TriggerSummary[]>;
  /** The committed trace summary, read by identity from the (unconverted)
   *  trace pipeline's own fold — a cross-aggregate read, unlike reading back
   *  the projection built from the stream this subscriber consumes. */
  readTraceSummary(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<TraceSummaryData | null>;
  recordMatch: {
    send(
      data: MatchRecordedData & { tenantId: string; occurredAt: number },
    ): Promise<void>;
  };
}

/**
 * `triggerMatch`: matches a finished evaluation against a project's
 * evaluation-filtered automations and submits a `recordMatch` command per hit.
 *
 * A trace whose summary cannot be read THROWS rather than skipping: a miss is
 * "we could not find out", not "this matches nothing", and returning would drop
 * that evaluation's alerts permanently.
 */
export function createEvaluationTriggerMatchSubscriber(params: {
  /** The evaluation pipeline's terminal outcome events, and which of its
   *  statuses are terminal. Both supplied by the composition root from that
   *  pipeline's own declaration — this pipeline cannot see another's
   *  vocabulary (ADR-102 decision 5). */
  eventTypes: readonly string[];
  isTerminalStatus: (status: string) => boolean;
  ports: EvaluationTriggerMatchPorts;
}): AutomationSubscriber<EvaluationOutcomeEvent> {
  const { ports, isTerminalStatus } = params;
  return {
    name: "triggerMatch",
    eventTypes: params.eventTypes,
    enqueue: {
      filter: (event) => readAlertableOutcome(event, isTerminalStatus) !== null,
    },
    options: {
      delay: MATCH_DELAY_MS,
      deduplication: {
        makeId: (event) =>
          `subscriber:triggerMatch:${event.tenantId}:${event.aggregateId}`,
        ttlMs: DEDUP_TTL_MS,
      },
    },

    async handle(event, context): Promise<void> {
      if (event.occurredAt < Date.now() - MAX_AGE_MS) return;
      const outcome = readAlertableOutcome(event, isTerminalStatus);
      if (!outcome) return;
      const { traceId } = outcome;

      const traceSummary = await ports.readTraceSummary({
        tenantId: context.tenantId,
        traceId,
        occurredAtMs: event.occurredAt,
      });
      if (!traceSummary) {
        throw new Error(
          `Trace summary not found for evaluation-alert trigger match (trace ${traceId})`,
        );
      }

      const triggers = await ports.getActiveTraceTriggersForProject(
        context.tenantId,
      );
      for (const trigger of triggers.filter(triggerReadsEvaluations)) {
        // Every field derives from the committed event or the trigger's own
        // config — never wall-clock at handling time — so a redelivery of this
        // job sends an identical command.
        await ports.recordMatch.send({
          tenantId: context.tenantId,
          occurredAt: event.occurredAt,
          triggerId: trigger.id,
          traceId,
          action: trigger.action,
          actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
            ? "notify"
            : "persist",
          traceDebounceMs: trigger.traceDebounceMs,
          notificationCadence: trigger.notificationCadence,
        });
      }
    },
  };
}

export const GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS = 5_000;

export interface TraceActivityEvent {
  readonly type: string;
  readonly tenantId: string;
  readonly occurredAt: number;
}

export function graphTriggerActivityDedupId(event: TraceActivityEvent): string {
  return `graph-trigger-activity:${event.tenantId}`;
}

export interface GraphTriggerActivityPorts {
  getActiveGraphTriggers(params: {
    tenantId: string;
  }): Promise<readonly { readonly id: string }[]>;
  evaluateGraphTrigger(params: {
    triggerId: string;
    tenantId: string;
    reason: "real-time";
  }): Promise<void>;
}

/**
 * `graphTriggerActivity`: the real-time half of graph-threshold alerting.
 * Trace activity nudges a project's graph triggers to re-evaluate promptly;
 * `graphAlertSweep` is what makes the outcome durable, so a lost nudge here
 * costs latency, not correctness.
 *
 * `eventTypes` is supplied per mount, because "activity" means different
 * events on each source pipeline and no single pipeline sees all of them.
 */
export function createGraphTriggerActivitySubscriber<
  E extends TraceActivityEvent,
>(params: {
  eventTypes: readonly string[];
  ports: GraphTriggerActivityPorts;
}): AutomationSubscriber<E> {
  return {
    name: "graphTriggerActivity",
    eventTypes: params.eventTypes,
    options: {
      delay: GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
      deduplication: {
        makeId: graphTriggerActivityDedupId,
        ttlMs: GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
        // Non-extending is load-bearing: a window that kept extending under
        // constant traffic would never close, starving the trigger of any
        // evaluation at all.
        extend: false,
        replace: false,
      },
    },

    async handle(event, context): Promise<void> {
      if (event.occurredAt < Date.now() - MAX_AGE_MS) return;

      const triggers = await params.ports.getActiveGraphTriggers({
        tenantId: context.tenantId,
      });
      if (triggers.length === 0) return;

      let failures = 0;
      for (const trigger of triggers) {
        try {
          await params.ports.evaluateGraphTrigger({
            triggerId: trigger.id,
            tenantId: context.tenantId,
            reason: "real-time",
          });
        } catch (error) {
          failures++;
          logger.error(
            {
              tenantId: context.tenantId,
              triggerId: trigger.id,
              error: error instanceof Error ? error.message : String(error),
            },
            "graphTriggerActivity: evaluation failed",
          );
        }
      }
      // Thrown after the loop so one trigger's failure never starves the
      // others; redelivery retries the whole job, safe to repeat because the
      // evaluator's own idempotency covers an already-resolved trigger.
      if (failures > 0) {
        throw new Error(
          `graphTriggerActivity: ${failures}/${triggers.length} evaluations failed — retry via redelivery`,
        );
      }
    },
  };
}
