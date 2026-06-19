import { TriggerAction } from "@prisma/client";
import { createHash } from "crypto";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesEvaluationFilters,
  matchesTriggerFilters,
  triggerFiltersReferenceEvents,
} from "~/server/filters/triggerFilter.matcher";
import {
  sendRenderedTriggerEmail,
  sendTriggerEmail,
} from "~/server/mailer/triggerEmail";
import type { Trace } from "~/server/tracer/types";
import {
  sendRenderedSlackMessage,
  sendSlackWebhook,
} from "~/server/triggers/sendSlackWebhook";
import { renderTriggerEmail } from "~/shared/templating/renderEmail";
import { renderTriggerSlack } from "~/shared/templating/renderSlack";
import {
  buildTemplateContext,
  type TemplateMatchInput,
} from "~/shared/templating/templateContext";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { createTenantId } from "../domain/tenantId";
import {
  computeScheduledFor,
  NOTIFY_TRIGGER_ACTIONS,
} from "../pipelines/shared/triggerActionDispatch";
import type { DerivedTraceEvent } from "../pipelines/trace-processing/projections/services/trace-events.derivation";
import type { FoldProjectionStore } from "../projections/foldProjection.types";
import { DispatchError, isDispatchError } from "./dispatchError";
import {
  type CadenceStagePayload,
  type OutboxJob,
  type SettleStagePayload,
  TRIGGER_NOTIFY_REACTOR_NAME,
} from "./payload";

const logger = createLogger("langwatch:outbox:dispatcher");

interface ActionParams {
  members?: string[] | null;
  slackWebhook?: string | null;
}

export interface OutboxDispatcherDeps {
  triggers: TriggerService;
  projects: ProjectService;
  /** Base host for building trace/automation deep links inside rendered
   *  customer templates (ADR-028). Injected, not read from env, so the
   *  dispatcher stays testable. */
  baseHost: string;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  evaluationRuns: EvaluationRunService;
  deriveEvents: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }) => Promise<DerivedTraceEvent[]>;
  traceById: (projectId: string, traceId: string) => Promise<Trace | undefined>;
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
  /**
   * ADR-031: per-trigger hourly hard cap on dispatched emails. Consults a
   * fixed-hour Redis counter; `allowed: false` means the trigger has already
   * sent `cap` emails this hour and this dispatch must be dropped (not sent,
   * not retried). Injected so tests can fake it. Slack never calls it.
   *
   * `dedupKey` is the stable per-dispatch identity so an outbox RETRY of the
   * same digest does not re-INCR and burn a second cap slot — the cap is
   * consumed at most once per logical dispatch, not once per attempt (the
   * retry double-count finding).
   */
  consumeEmailCapSlot: (args: {
    projectId: string;
    triggerId: string;
    now: Date;
    dedupKey: string;
  }) => Promise<{ allowed: boolean; count: number }>;
  /** The configured cap, for operator-facing drop logs (ADR-031). */
  emailHourlyCap: number;
  /**
   * ADR-031: per-PROJECT daily hard cap — a backstop ABOVE the per-trigger
   * hourly cap, bounding the aggregate trigger-email volume a whole project can
   * emit in 24h (SES sender-reputation protection). Consulted AFTER the hourly
   * cap passes and the recipient set is known; counts RECIPIENTS (actual email
   * volume), not dispatches. `allowed: false` means the project has already sent
   * `cap` trigger emails today — this dispatch is dropped (not sent, not
   * retried). Injected so tests can fake it. Slack never calls it.
   *
   * `dedupKey` is the stable per-dispatch identity so an outbox RETRY of the
   * same digest does not re-count its recipients and burn the budget twice.
   */
  consumeTenantEmailCapSlot: (args: {
    projectId: string;
    now: Date;
    cap: number;
    recipientCount: number;
    dedupKey: string;
  }) => Promise<{ allowed: boolean; count: number }>;
  /** The configured per-project daily cap, for operator-facing drop logs. */
  tenantDailyCap: number;
  /**
   * ADR-031: drops recipients who unsubscribed before the provider call.
   * Returns `emails` minus any address suppressed for this trigger
   * (trigger-scoped OR project-wide rows). Injected so tests can fake it.
   * Slack never calls it.
   */
  filterSuppressedEmails: (args: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }) => Promise<string[]>;
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

  // ADR-028: a trigger with customer-authored templates renders them here;
  // a NULL template keeps the legacy framework senders byte-for-byte. The
  // template-vs-legacy decision is per-channel and made BEFORE the legacy
  // switch so the legacy path is reached only when no custom template exists.
  const t = trigger.templates;
  const hasCustomEmail =
    t.emailSubjectTemplate != null || t.emailBodyTemplate != null;
  const hasCustomSlack = t.slackTemplate != null;

  const buildContext = () => {
    const matches: TemplateMatchInput[] = triggerData.map((d) => ({
      traceId: d.traceId,
      input: d.input,
      output: d.output,
      metadata: d.fullTrace?.metadata ?? {},
    }));
    return buildTemplateContext({
      trigger: {
        id: trigger.id,
        name: trigger.name,
        alertType: trigger.alertType,
      },
      project: { name: project.name, slug: project.slug },
      baseHost: deps.baseHost,
      matches,
    });
  };

  // Tracks whether a provider send actually happened. Suppression / over-cap
  // drops still run `claimSend` below (ADR-031: a replay must no-op), but they
  // must NOT run the delivery-only bookkeeping — `updateLastRunAt` (the
  // operator "last-fired" column) and the "dispatched" success log — which
  // would misrepresent a dropped no-op as a real notification.
  let didSend = false;
  // Reason a dispatch resolved to a no-op (over cap / all suppressed). Stamped
  // onto each payload below so the PG audit projection records a distinct
  // `lastError` instead of a delivered-looking null — drops stay NON-retryable
  // (we return normally, never throw) but must be visible as drops, not sends.
  let dropReason: string | undefined;

  try {
    switch (trigger.action) {
      case TriggerAction.SEND_EMAIL: {
        // ADR-031: drop unsubscribed recipients FIRST. An all-suppressed
        // dispatch has nothing to send — record the claim (so a replay
        // no-ops), log at info, and skip without throwing AND without burning
        // a cap slot (the cap is for emails actually sent, not for dispatches
        // that resolve to zero recipients).
        const recipients = await deps.filterSuppressedEmails({
          projectId,
          triggerId,
          emails: params.members ?? [],
        });
        if (recipients.length === 0) {
          logger.info(
            { projectId, triggerId },
            "All trigger email recipients are suppressed — skipping send",
          );
          dropReason = "dropped: all recipients suppressed";
          break;
        }
        // Stable per-dispatch digest over the batch's traceIds. Identical
        // across outbox retries of THIS dispatch (the candidate set is
        // deterministic) but distinct from past/future dispatches. Used as
        // BOTH the cap-consumption claim (so a retry doesn't burn a second
        // slot, ADR-031) and the per-recipient idempotency key prefix below.
        const dispatchDigest = createHash("sha256")
          .update(
            candidatePayloads
              .map((p) => p.match.traceId)
              .sort()
              .join(","),
          )
          .digest("hex")
          .slice(0, 16);
        // ADR-031: per-trigger hourly hard cap. Only consumed once we know
        // there is a real send to make. Gate BEFORE either the custom-template
        // or legacy send path. Over the cap the dispatch is a terminal drop:
        // log loudly, fall through to claimSend below (so a replay no-ops
        // instead of re-sending), and return WITHOUT sending and WITHOUT
        // throwing — throwing would let the outbox retry the spam. The cap is
        // consumed at most once per logical dispatch: `dedupKey` gates the
        // INCR so a retry of the same digest re-reads the count rather than
        // re-incrementing (the retry double-count finding). Counts dispatches,
        // not traces or recipients.
        const capSlot = await deps.consumeEmailCapSlot({
          projectId,
          triggerId,
          now: new Date(),
          dedupKey: `${projectId}/${triggerId}:digest:${dispatchDigest}`,
        });
        if (!capSlot.allowed) {
          logger.error(
            {
              projectId,
              triggerId,
              count: capSlot.count,
              cap: deps.emailHourlyCap,
            },
            "Trigger exceeded its hourly email cap — dropping this dispatch. " +
              "Switch this trigger to a digest cadence to coalesce its volume.",
          );
          dropReason = "dropped: over hourly cap";
          break;
        }
        // ADR-031: per-PROJECT daily cap — a backstop ABOVE the per-trigger
        // hourly cap, run only once the hourly cap has passed and the recipient
        // set is known. Counts RECIPIENTS (`recipients.length`), the actual
        // outbound email volume that hits SES, not dispatches. Over the cap the
        // dispatch is a terminal drop with the same shape as the over-hourly-cap
        // path: log loudly, fall through to claimSend below (so a replay no-ops),
        // return WITHOUT sending and WITHOUT throwing (throwing would let the
        // outbox retry the spam). The same `dispatchDigest`-derived dedupKey
        // gates the recipient count so a retry of the same digest re-reads the
        // daily total rather than counting its recipients twice.
        const tenantSlot = await deps.consumeTenantEmailCapSlot({
          projectId,
          now: new Date(),
          cap: deps.tenantDailyCap,
          recipientCount: recipients.length,
          dedupKey: `${projectId}:tenant:${dispatchDigest}`,
        });
        if (!tenantSlot.allowed) {
          logger.warn(
            {
              projectId,
              triggerId,
              count: tenantSlot.count,
              cap: deps.tenantDailyCap,
            },
            "Project exceeded its daily trigger-email cap — dropping this " +
              "dispatch. This is a per-project backstop above the per-trigger " +
              "hourly cap; investigate which triggers are driving the volume.",
          );
          dropReason = "dropped: over project daily email cap";
          break;
        }
        // Per-recipient idempotency (ADR-031): back the mailer's recipient
        // gate with the same TriggerSent claim store used for the
        // (trigger, trace) dedup below, encoding the recipient hash into the
        // traceId field under a `rcpt:` prefix (real trace ids never carry
        // it). The same `dispatchDigest` keeps the key stable across outbox
        // retries of THIS dispatch — so a partial provider failure retries
        // only the unfinished recipients — while staying distinct from past
        // and future dispatches to the same recipients.
        const recipientClaimKey = (recipientHash: string) =>
          `rcpt:${dispatchDigest}:${recipientHash}`;
        const isRecipientSent = (recipientHash: string) =>
          deps.triggers.isSendClaimed({
            triggerId,
            traceId: recipientClaimKey(recipientHash),
            projectId,
          });
        const recordRecipientSent = async (recipientHash: string) => {
          await deps.triggers.claimSend({
            triggerId,
            traceId: recipientClaimKey(recipientHash),
            projectId,
          });
        };
        if (hasCustomEmail) {
          const rendered = await renderTriggerEmail({
            subjectTemplate: t.emailSubjectTemplate,
            bodyTemplate: t.emailBodyTemplate,
            context: buildContext(),
          });
          if (rendered.errors.length > 0) {
            logger.warn(
              { projectId, triggerId, errors: rendered.errors },
              "Custom email template render errors — fell back to default for affected parts",
            );
          }
          await sendRenderedTriggerEmail({
            triggerEmails: recipients,
            triggerId,
            projectId,
            subject: rendered.subject,
            html: rendered.html,
            isRecipientSent,
            recordRecipientSent,
          });
          didSend = true;
          break;
        }
        await sendTriggerEmail({
          triggerEmails: recipients,
          triggerData,
          triggerName: trigger.name,
          triggerId,
          projectId,
          projectSlug: project.slug,
          triggerType: trigger.alertType,
          triggerMessage: trigger.message ?? "",
          isRecipientSent,
          recordRecipientSent,
        });
        didSend = true;
        break;
      }
      case TriggerAction.SEND_SLACK_MESSAGE:
        if (hasCustomSlack) {
          const rendered = await renderTriggerSlack({
            templateType:
              t.slackTemplateType === "block_kit" ? "block_kit" : "string",
            template: t.slackTemplate,
            context: buildContext(),
          });
          if (rendered.errors.length > 0) {
            logger.warn(
              { projectId, triggerId, errors: rendered.errors },
              "Custom Slack template render errors — fell back to default",
            );
          }
          await sendRenderedSlackMessage({
            triggerWebhook: params.slackWebhook ?? "",
            triggerName: trigger.name,
            payload: rendered.payload,
          });
          didSend = true;
          break;
        }
        await sendSlackWebhook({
          triggerWebhook: params.slackWebhook ?? "",
          triggerData,
          triggerName: trigger.name,
          projectSlug: project.slug,
          triggerType: trigger.alertType,
          triggerMessage: trigger.message ?? "",
        });
        didSend = true;
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
    captureException(toError(error), {
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
      captureException(toError(claimErr), {
        extra: {
          projectId,
          triggerId,
          traceId: p.match.traceId,
          phase: "claimSend-post-dispatch",
        },
      });
    }
  }

  // Delivery-only bookkeeping. A suppression / over-cap drop still claimed its
  // sends above (replay no-op), but never actually delivered — so skip the
  // "last-fired" cosmetic and the success log, which would otherwise report a
  // dropped dispatch as a notification.
  if (!didSend) {
    // Stamp the drop reason onto every payload so the PG audit adapter's
    // `onDispatched` hook records it as `lastError` (ADR-031). Without this the
    // row reads as dispatched/lastError=null — indistinguishable from a real
    // send. The dispatch still returns normally (non-retryable): a drop must
    // not retry. `payloads` (not just `candidatePayloads`) so the shared audit
    // row keyed by `auditDedupKey` is covered even when a trace was in-batch
    // deduped out of the candidate set.
    for (const p of payloads) {
      p.dropReason = dropReason;
    }
    logger.info(
      {
        projectId,
        triggerId,
        action: trigger.action,
        cadence: trigger.notificationCadence,
        dropReason,
      },
      "Outbox cadence digest dropped (no recipients or over cap) — claimed but not sent",
    );
    return;
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
          lastRunErr instanceof Error ? lastRunErr.message : String(lastRunErr),
      },
      "updateLastRunAt failed post-dispatch — swallowing to avoid double-send on retry",
    );
    captureException(toError(lastRunErr), {
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
