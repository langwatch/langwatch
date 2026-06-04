import { TriggerAction } from "@prisma/client";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesEvaluationFilters,
  matchesTriggerFilters,
  triggerFiltersReferenceEvents,
} from "~/server/filters/triggerFilter.matcher";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";
import type { Trace } from "~/server/tracer/types";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import { createTenantId } from "../domain/tenantId";
import { DispatchError, isDispatchError } from "./dispatchError";
import type { DerivedTraceEvent } from "../pipelines/trace-processing/projections/services/trace-events.derivation";
import {
  computeScheduledFor,
  NOTIFY_TRIGGER_ACTIONS,
} from "../pipelines/shared/triggerActionDispatch";
import type { FoldProjectionStore } from "../projections/foldProjection.types";
import {
  TRIGGER_NOTIFY_REACTOR_NAME,
  type CadenceStagePayload,
  type OutboxJob,
  type SettleStagePayload,
} from "./payload";

const logger = createLogger("langwatch:outbox:dispatcher");

interface ActionParams {
  members?: string[] | null;
  slackWebhook?: string | null;
}

export interface OutboxDispatcherDeps {
  triggers: TriggerService;
  projects: ProjectService;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  evaluationRuns: EvaluationRunService;
  deriveEvents: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }) => Promise<DerivedTraceEvent[]>;
  traceById: (
    projectId: string,
    traceId: string,
  ) => Promise<Trace | undefined>;
  /**
   * Late-bound — settle stage's match-confirmed branch calls this to
   * re-enqueue as `cadence`. The queue ref is filled in by `buildOutboxRuntime`
   * after the queue is constructed, since the queue's `process`
   * callback (this function) holds the only reference to itself.
   *
   * `delayMs` is the wall-clock distance from now to the cadence
   * boundary the dispatcher just resolved from `trigger.notificationCadence`.
   */
  enqueueCadence: (
    payload: CadenceStagePayload,
    options: { delayMs: number },
  ) => Promise<void>;
}

/**
 * Unified outbox process callback. Branches on `stage` so one queue
 * carries both ADR-026 settle and ADR-027 cadence digest stages with
 * the operator's two knobs (`traceDebounceMs`, `notificationCadence`)
 * still independently tunable.
 *
 * `process(payload)` is invoked by the GroupQueue for single-job
 * paths (settle is never coalesced). `processBatch(payloads)` is
 * invoked when `coalesceMaxBatch` opens a digest — only cadence-stage
 * payloads coalesce.
 */
export function createOutboxDispatcher(deps: OutboxDispatcherDeps): {
  process: (payload: OutboxJob) => Promise<void>;
  processBatch: (payloads: OutboxJob[]) => Promise<void>;
} {
  return {
    process: async (payload) => {
      if (payload.stage === "settle") {
        await handleSettle(deps, payload);
      } else {
        // Single-job cadence path (no coalescing this round) — render
        // and send a one-match digest.
        await handleCadenceBatch(deps, [payload]);
      }
    },
    processBatch: async (payloads) => {
      if (payloads.length === 0) return;
      // Settle stage's coalesceMaxBatch returns 1 so we never see a
      // settle-stage batch here; defensive split anyway.
      const cadence: CadenceStagePayload[] = [];
      for (const p of payloads) {
        if (p.stage === "settle") {
          await handleSettle(deps, p);
        } else {
          cadence.push(p);
        }
      }
      if (cadence.length > 0) {
        await handleCadenceBatch(deps, cadence);
      }
    },
  };
}

/**
 * Settle stage: trace has been quiet for `traceDebounceMs`. Re-read
 * the fold, re-run filters against the now-settled state, and
 * re-enqueue as cadence so the digest window can coalesce.
 *
 * The `TriggerSent` at-most-once gate is owned entirely by
 * `handleCadenceBatch` (read pre-dispatch, written post-dispatch), so
 * settle does no claiming itself.
 */
async function handleSettle(
  deps: OutboxDispatcherDeps,
  payload: SettleStagePayload,
): Promise<void> {
  const { projectId, triggerId, traceId } = payload;

  const triggers =
    await deps.triggers.getActiveTraceTriggersForProject(projectId);
  const trigger = triggers.find((t) => t.id === triggerId);
  if (!trigger) {
    logger.debug(
      { projectId, triggerId, traceId },
      "Trigger missing / deactivated during settle — skipping",
    );
    return;
  }

  const brandedTenantId = createTenantId(projectId);
  const foldState = await deps.traceSummaryStore.get(traceId, {
    tenantId: brandedTenantId,
    aggregateId: traceId,
  });
  if (!foldState) {
    logger.debug(
      { projectId, triggerId, traceId },
      "Trace fold gone during settle — skipping",
    );
    return;
  }

  const { traceFilters, evaluationFilters, hasEvaluationFilters } =
    classifyTriggerFilters(trigger.filters);

  const events = triggerFiltersReferenceEvents(traceFilters)
    ? await deps.deriveEvents({
        tenantId: projectId,
        traceId,
        occurredAtMs: foldState.occurredAt,
        foldVersion: foldState.spanCount,
      })
    : null;
  const traceData = buildPreconditionTraceDataFromFoldState(foldState, events);

  if (
    Object.keys(traceFilters).length > 0 &&
    !matchesTriggerFilters(traceData, traceFilters)
  ) {
    return;
  }

  if (hasEvaluationFilters) {
    const allEvaluations = await deps.evaluationRuns.findByTraceId(
      projectId,
      traceId,
    );
    if (!matchesEvaluationFilters(allEvaluations, evaluationFilters)) {
      return;
    }
  }

  if (!NOTIFY_TRIGGER_ACTIONS.has(trigger.action)) {
    // Persist actions don't take the outbox path — the inline
    // dispatchTriggerAction caller routed them separately.
    return;
  }

  // No claim here. Settle just re-enqueues — the at-most-once gate is
  // owned by `handleCadenceBatch`, which reads `isSendClaimed` before
  // dispatch and writes `claimSend` after success. Committing the claim
  // pre-dispatch (here or in cadence) breaks outbox retry semantics: a
  // retryable provider failure on the first cadence attempt would see
  // claim=true on retry and silently no-op the resend.
  const cadencePayload: CadenceStagePayload = {
    stage: "cadence",
    projectId,
    triggerId,
    reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
    auditDedupKey: payload.auditDedupKey,
    match: {
      traceId,
      input: foldState.computedInput ?? "",
      output: foldState.computedOutput ?? "",
    },
  };

  const now = new Date();
  const scheduledFor = computeScheduledFor({
    action: trigger.action,
    cadence: trigger.notificationCadence,
    now,
  });
  const delayMs = Math.max(0, scheduledFor.getTime() - now.getTime());

  await deps.enqueueCadence(cadencePayload, { delayMs });
}

/**
 * Cadence stage: one or more matched (trigger, trace) pairs landed in
 * the same wall-clock cadence boundary. Renders one digest and sends.
 * The group invariant (single triggerId per batch) is enforced by the
 * queue's `groupKey` configuration.
 */
async function handleCadenceBatch(
  deps: OutboxDispatcherDeps,
  payloads: CadenceStagePayload[],
): Promise<void> {
  const projectId = payloads[0]!.projectId;
  const triggerId = payloads[0]!.triggerId;

  for (const p of payloads) {
    if (p.triggerId !== triggerId || p.projectId !== projectId) {
      throw new DispatchError({
        message: `cadence batch has mixed identity (${projectId}/${triggerId} vs ${p.projectId}/${p.triggerId})`,
        retryable: false,
      });
    }
  }

  const triggersForProject =
    await deps.triggers.getActiveTraceTriggersForProject(projectId);
  const trigger = triggersForProject.find((t) => t.id === triggerId);
  if (!trigger) {
    logger.info(
      { projectId, triggerId, batchSize: payloads.length },
      "Trigger gone / deactivated since enqueue — dropping digest",
    );
    return;
  }

  const project = await deps.projects.getById(projectId);
  if (!project) {
    throw new DispatchError({
      message: `project ${projectId} not found at dispatch time`,
      retryable: false,
    });
  }

  // Decide which (trigger, trace) pairs need a real dispatch. Two
  // suppressors run before the provider call:
  //
  // 1. In-batch dedup via `seenTraceIds`. Settle re-enqueues are
  //    idempotent at the queue level only by collapsing on the digest
  //    boundary, so a (trigger, trace) pair may legitimately appear
  //    twice in the batch (settle retry after a Redis blip).
  // 2. Cross-batch dedup via the read-only `isSendClaimed` check —
  //    suppresses pairs already dispatched by an earlier cadence batch
  //    (or the inline evaluation reactor) so we don't re-send.
  //
  // Crucially, the actual `claimSend` write is deferred to AFTER a
  // successful provider call. Writing the at-most-once gate pre-
  // dispatch defeats outbox retry: a retryable provider failure on
  // the first attempt would see claim=true on retry and silently
  // no-op the resend, recording the notification as sent while
  // nothing actually went out.
  const params = (trigger.actionParams ?? {}) as ActionParams;
  const candidatePayloads: CadenceStagePayload[] = [];
  const seenTraceIds = new Set<string>();
  for (const p of payloads) {
    if (seenTraceIds.has(p.match.traceId)) continue;
    seenTraceIds.add(p.match.traceId);
    const alreadySent = await deps.triggers.isSendClaimed({
      triggerId,
      traceId: p.match.traceId,
      projectId,
    });
    if (alreadySent) continue;
    candidatePayloads.push(p);
  }
  if (candidatePayloads.length === 0) {
    logger.debug(
      { projectId, triggerId, batchSize: payloads.length },
      "Cadence batch fully suppressed by prior TriggerSent claims — no dispatch",
    );
    return;
  }

  const triggerData = await Promise.all(
    candidatePayloads.map(async (p) => {
      const fullTrace =
        (await deps.traceById(projectId, p.match.traceId)) ??
        ({ trace_id: p.match.traceId } as Trace);
      return {
        traceId: p.match.traceId,
        input: p.match.input,
        output: p.match.output,
        projectId,
        fullTrace,
      };
    }),
  );

  try {
    switch (trigger.action) {
      case TriggerAction.SEND_EMAIL:
        await sendTriggerEmail({
          triggerEmails: params.members ?? [],
          triggerData,
          triggerName: trigger.name,
          triggerId,
          projectSlug: project.slug,
          triggerType: trigger.alertType,
          triggerMessage: trigger.message ?? "",
        });
        break;
      case TriggerAction.SEND_SLACK_MESSAGE:
        await sendSlackWebhook({
          triggerWebhook: params.slackWebhook ?? "",
          triggerData,
          triggerName: trigger.name,
          projectSlug: project.slug,
          triggerType: trigger.alertType,
          triggerMessage: trigger.message ?? "",
        });
        break;
      default:
        throw new DispatchError({
          message: `cadence stage cannot dispatch action ${trigger.action} — settle stage misrouted`,
          retryable: false,
        });
    }
  } catch (error) {
    const retryable = isDispatchError(error) ? error.retryable : true;
    logger.error(
      {
        projectId,
        triggerId,
        retryable,
        error: error instanceof Error ? error.message : String(error),
      },
      "Cadence dispatch failed",
    );
    captureException(error, {
      extra: { projectId, triggerId, triggerAction: trigger.action },
    });
    throw error;
  }

  // Post-dispatch: write `TriggerSent` for each (trigger, trace) so a
  // future settle re-enqueue for the same pair is suppressed by the
  // pre-dispatch `isSendClaimed` check above. Best-effort: a failure
  // here cannot throw, because the provider call has already succeeded
  // and re-throwing would let the outbox retry the dispatch and double-
  // send. `claimSend` is INSERT IGNORE, so racing workers see `false`
  // and that is also fine — the pair landed somewhere.
  for (const p of candidatePayloads) {
    try {
      await deps.triggers.claimSend({
        triggerId,
        traceId: p.match.traceId,
        projectId,
      });
    } catch (claimErr) {
      logger.warn(
        {
          projectId,
          triggerId,
          traceId: p.match.traceId,
          error:
            claimErr instanceof Error ? claimErr.message : String(claimErr),
        },
        "claimSend failed post-dispatch — swallowing to avoid double-send on retry",
      );
      captureException(claimErr, {
        extra: {
          projectId,
          triggerId,
          traceId: p.match.traceId,
          phase: "claimSend-post-dispatch",
        },
      });
    }
  }

  // `updateLastRunAt` is a soft-state cosmetic for the operator UI
  // (last-fired column on the trigger list). The provider-side send
  // above has already happened; if this write fails we MUST NOT throw,
  // because the outer outbox retry would re-emit an identical digest
  // and burn a real notification on a write-only race. Log + capture
  // and move on.
  try {
    await deps.triggers.updateLastRunAt(triggerId, projectId);
  } catch (lastRunErr) {
    logger.warn(
      {
        projectId,
        triggerId,
        error:
          lastRunErr instanceof Error
            ? lastRunErr.message
            : String(lastRunErr),
      },
      "updateLastRunAt failed post-dispatch — swallowing to avoid double-send on retry",
    );
    captureException(lastRunErr, {
      extra: { projectId, triggerId, phase: "updateLastRunAt-post-dispatch" },
    });
  }
  logger.info(
    {
      projectId,
      triggerId,
      action: trigger.action,
      cadence: trigger.notificationCadence,
      digestSize: candidatePayloads.length,
    },
    "Outbox cadence digest dispatched",
  );
}

// Re-export so callers building cadence payloads from outside (e.g. a
// test) reach computeScheduledFor through the same module surface.
export { computeScheduledFor };
