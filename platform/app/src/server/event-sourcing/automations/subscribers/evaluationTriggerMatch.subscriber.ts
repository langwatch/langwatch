import {
  NOTIFY_TRIGGER_ACTIONS,
  triggerReadsEvaluations,
} from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { TriggerSummary } from "~/server/app-layer/automations/repositories/trigger.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { MatchRecordedData } from "../aggregate";
import type { AutomationSubscriber } from "./subscriber.types";

/**
 * `triggerMatch`: matches a finished evaluation against a project's
 * evaluation-filtered automations, and submits a `recordMatch` command for
 * each one that matches (ADR-098 decision 1 — a plain event subscriber, no
 * fold bound to it, at-most-once).
 *
 * **Cross-pipeline dependency, declared locally.** The evaluation pipeline
 * has not converted to `@langwatch/event-sourcing` yet, so this file cannot
 * import its event-type constants or event shape — the same situation
 * `log-processing/schema.ts` already documents for its trace-processing
 * dependency, and the same fix: declare the two type-string literals and the
 * minimal event shape this subscriber actually reads, locally. Once
 * evaluation-processing converts and derives these strings from its own
 * `defineAggregate("evaluation")` declaration (ADR-105), the values below
 * must still equal `"lw.evaluation.completed"` / `"lw.evaluation.reported"`
 * — they are what is already persisted in `event_log` and cannot change.
 */
export const EVALUATION_COMPLETED_EVENT_TYPE = "lw.evaluation.completed";
export const EVALUATION_REPORTED_EVENT_TYPE = "lw.evaluation.reported";

export interface EvaluationOutcomeEvent {
  readonly type: string;
  readonly tenantId: string;
  /** The evaluation's own aggregate id — used only to key this subscriber's
   *  dedup window, never to read anything back. */
  readonly aggregateId: string;
  readonly occurredAt: number;
  readonly data: unknown;
}

/** Debounce before a terminal evaluation outcome is matched against
 *  automations, so a burst of evaluations for one trace collapses. */
export const MATCH_DELAY_MS = 10_000;
/** Dedup window collapsing repeat deliveries of one evaluation's outcome
 *  into one match run. */
export const DEDUP_TTL_MS = 30_000;
/** Replay floods, resyncs and late-arriving results never raise a live
 *  alert — this subscriber only reacts to genuinely recent outcomes. */
const MAX_AGE_MS = 60 * 60 * 1000;

const TERMINAL_EVALUATION_STATUSES = new Set(["processed", "error", "skipped"]);

/**
 * The two facts this subscriber acts on, read directly off the committed
 * event (event-carried state transfer) rather than off a fold: a terminal
 * status, and the trace the outcome belongs to.
 *
 * Total by construction — this doubles as the enqueue filter, which has no
 * retry budget behind it (`subscriber.types.ts`), so every branch here is a
 * `typeof`/length/set check. No decoding, no I/O, no fold read.
 *
 * `traceId` is absent on a `completed` event committed before the field
 * existed, and on a `reported` event for an evaluation naming no trace.
 * Absence is a skip: an evaluation nobody can point at a trace has no trace
 * summary to match automations against.
 */
function readAlertableOutcome(event: EvaluationOutcomeEvent): { traceId: string } | null {
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) return null;
  const { status, traceId } = data as { status?: unknown; traceId?: unknown };
  if (typeof status !== "string" || !TERMINAL_EVALUATION_STATUSES.has(status)) return null;
  if (typeof traceId !== "string" || traceId.length === 0) return null;
  return { traceId };
}

export interface RecordMatchPort {
  send(data: MatchRecordedData & { tenantId: string; occurredAt: number }): Promise<void>;
}

export interface EvaluationTriggerMatchPorts {
  getActiveTraceTriggersForProject(projectId: string): Promise<readonly TriggerSummary[]>;
  /** The committed trace summary, read by identity from the (unconverted)
   *  trace pipeline's own fold — a legitimate cross-aggregate read, unlike
   *  reading back the projection built from the stream this subscriber
   *  consumes, which would race its own writer. */
  readTraceSummary(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<TraceSummaryData | null>;
  recordMatch: RecordMatchPort;
}

/**
 * A trace whose summary cannot be read THROWS rather than skipping. A miss
 * here is "we could not find out", not "this evaluation matches nothing" —
 * the summary is written by a different pipeline than the one this
 * subscriber consumes, so no debounce can order the two relative to each
 * other. Returning would drop that evaluation's alerts silently and
 * permanently, because a terminal evaluation outcome arrives once and the
 * dedup key covers it — "the next event asks again" does not hold. Throwing
 * hands the job back to the (future) router's retry, which is exactly the
 * distinction ADR-098 decision 6 draws for a fold's undecodable row: a
 * miss the platform cannot yet resolve must never be read as an answer.
 */
export function createEvaluationTriggerMatchSubscriber(
  ports: EvaluationTriggerMatchPorts,
): AutomationSubscriber<EvaluationOutcomeEvent> {
  return {
    name: "triggerMatch",
    eventTypes: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
    enqueue: { filter: (event) => readAlertableOutcome(event) !== null },
    options: {
      delay: MATCH_DELAY_MS,
      deduplication: {
        // Keyed exactly as the trace-pipeline sibling keys its own
        // fold-bound registration, so converting one at a time cannot
        // double-match an evaluation mid-rollout.
        makeId: (event) => `subscriber:triggerMatch:${event.tenantId}:${event.aggregateId}`,
        ttlMs: DEDUP_TTL_MS,
      },
    },

    async handle(event, context): Promise<void> {
      if (event.occurredAt < Date.now() - MAX_AGE_MS) return;
      const outcome = readAlertableOutcome(event);
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

      const triggers = await ports.getActiveTraceTriggersForProject(context.tenantId);
      for (const trigger of triggers.filter(triggerReadsEvaluations)) {
        // Every idempotency-key input (triggerId, traceId, occurredAt,
        // traceDebounceMs) derives from the committed event or the trigger's
        // own config — never wall-clock at handling time — so a redelivery
        // of this job sends an identical command.
        await ports.recordMatch.send({
          tenantId: context.tenantId,
          occurredAt: event.occurredAt,
          triggerId: trigger.id,
          traceId,
          action: trigger.action,
          actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action) ? "notify" : "persist",
          traceDebounceMs: trigger.traceDebounceMs,
          notificationCadence: trigger.notificationCadence,
        });
      }
    },
  };
}
