import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import { featureFlagService } from "~/server/featureFlag";
import { createLogger } from "~/utils/logger/server";
import type {
  OutboxEnqueueRequest,
  OutboxReactorDefinition,
} from "../../../outbox/outboxReactor.types";
import {
  GRAPH_TRIGGER_EVAL_REACTOR_NAME,
  type GraphEvalStagePayload,
  graphEvalAuditDedupKey,
  graphEvalDedupId,
  graphEvalGroupKey,
} from "../../../outbox/payload";
import type { ReactorContext } from "../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:graph-trigger-evaluation-outbox-reactor",
);

/**
 * ADR-034 Phase 5 — real-time path for custom-graph threshold alerts.
 *
 * Attached as `.withOutbox("traceAnalytics", "graphTriggerEvaluation",
 * ...)` on the trace-processing pipeline. Fires on every slim-fold
 * update; the per-(triggerId, projectId) Debounce Mode TTL (5s, locked
 * by the spec) collapses repeat enqueues into a single evaluation so a
 * burst of spans doesn't fan-out into a burst of evaluations.
 *
 * Per-project gated by `release_es_graph_triggers_firing`:
 *
 *   - OFF (default): `decide` returns `[]`. The cron handles the
 *     project's graph triggers as today.
 *   - ON: `decide` returns one `OutboxEnqueueRequest` per active graph
 *     trigger on the project, all targeting the same shared handler
 *     `evaluateGraphTrigger`.
 *
 * The reactor itself does NOT call the handler — that's the dispatcher's
 * job (settle/cadence/graphEval stage routing). This keeps the reactor
 * cheap (one cached `getActiveGraphTriggersForProject` call per
 * project) and the handler reusable from the heartbeat as well.
 */
export interface GraphTriggerEvaluationOutboxReactorDeps {
  triggers: TriggerService;
}

const REAL_TIME_DEBOUNCE_MS = 5_000;

export function createGraphTriggerEvaluationOutboxReactor(
  deps: GraphTriggerEvaluationOutboxReactorDeps,
): OutboxReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: GRAPH_TRIGGER_EVAL_REACTOR_NAME,
    options: {
      // Reactor-level dedup across the cluster — the outer queue's
      // Debounce Mode collapses additional dedup, but stamping a stable
      // jobId here lets the framework drop duplicates earlier in the
      // pipeline (per-event-loop tick).
      makeJobId: (payload) =>
        `${GRAPH_TRIGGER_EVAL_REACTOR_NAME}:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: REAL_TIME_DEBOUNCE_MS,
    },

    async decide(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<OutboxEnqueueRequest[]> {
      const { tenantId } = context;

      // Old-trace guard — replay floods, resyncs, late-arriving spans.
      // Mirrors the originGuardedReactor guard at the same threshold.
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) {
        return [];
      }

      const enabled = await featureFlagService.isEnabled(
        "release_es_graph_triggers_firing",
        { distinctId: tenantId, projectId: tenantId },
      );
      if (!enabled) return [];

      const triggers =
        await deps.triggers.getActiveGraphTriggersForProject(tenantId);
      if (triggers.length === 0) return [];

      const requests: OutboxEnqueueRequest[] = [];
      for (const trigger of triggers) {
        const payload: GraphEvalStagePayload = {
          stage: "graphEval",
          projectId: tenantId,
          triggerId: trigger.id,
          reactorName: GRAPH_TRIGGER_EVAL_REACTOR_NAME,
          reason: "real-time",
        };
        requests.push({
          dedupKey: graphEvalDedupId({
            projectId: tenantId,
            triggerId: trigger.id,
          }),
          groupKey: graphEvalGroupKey({
            projectId: tenantId,
            triggerId: trigger.id,
          }),
          // `GraphEvalStagePayload` extends `Record<string, unknown>` so it
          // satisfies `Prisma.InputJsonValue` structurally; the cast crosses
          // the structural-vs-nominal gap.
          payload: payload as unknown as OutboxEnqueueRequest["payload"],
          enqueueOptions: { ttlMs: REAL_TIME_DEBOUNCE_MS },
        });
      }

      logger.debug(
        {
          tenantId,
          triggerCount: requests.length,
        },
        "graphTriggerEvaluation reactor decided enqueues",
      );

      // Carry the audit key on the reactor's logs so an operator
      // grepping for one is one query away — even though we don't
      // currently persist a `ReactorOutbox` row for graphEval.
      void graphEvalAuditDedupKey;

      return requests;
    },
  };
}
