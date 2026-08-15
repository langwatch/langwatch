import { slackDeliveryMethodOf } from "@langwatch/automations/providers/slack";
import type { WebhookMethod } from "@langwatch/automations/providers/webhook";
import { renderTriggerEmail } from "@langwatch/automations/templating/renderEmail";
import { renderTriggerSlack } from "@langwatch/automations/templating/renderSlack";
import { renderWebhookBody } from "@langwatch/automations/templating/renderWebhookBody";
import {
  buildTemplateContext,
  type TemplateMatchInput,
} from "@langwatch/automations/templating/templateContext";
import { createLogger } from "@langwatch/observability";
import { createHash } from "crypto";
import { TriggerAction } from "~/generated/prisma/client";
import {
  deliverWebhook,
  type WebhookDeliveryRecorder,
} from "~/server/app-layer/automations/delivery/deliverWebhook";
import {
  sendRenderedSlackMessage,
  sendSlackWebhook,
} from "~/server/app-layer/automations/delivery/sendSlackWebhook";
import { postSlackChatMessage } from "~/server/app-layer/automations/delivery/slackWebApi";
import { decryptSlackBotToken } from "~/server/app-layer/automations/providers/slack/server";
import {
  decryptWebhookHeaders,
  decryptWebhookSigningSecrets,
} from "~/server/app-layer/automations/providers/webhook/server";
import type { TriggerSummary } from "~/server/app-layer/automations/repositories/trigger.repository";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { DatasetRecordEntry } from "~/server/datasets/types";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { IntentExecutor } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import {
  DispatchError,
  isDispatchError,
} from "~/server/event-sourcing/queues/dispatchError";
import { pMapLimited } from "~/server/event-sourcing/replay/pMapLimited";
import {
  sendRenderedTriggerEmail,
  sendTriggerEmail,
} from "~/server/mailer/triggerEmail";
import { incrementAutomationOverflowFlushTotal } from "~/server/metrics";
import type { Trace } from "~/server/tracer/types";
import { captureException, toError } from "~/utils/posthogErrorCapture";

import {
  type ConfirmSettledMatchDeps,
  confirmSettledMatch,
} from "../../../../app-layer/automations/dispatch/confirmSettledMatch";
import { dispatchTriggerAction } from "../../../../app-layer/automations/dispatch/triggerActionDispatch";
import {
  type LogOverflowIntent,
  type NotifyDigestIntent,
  type PersistMatchIntent,
  TRIGGER_SETTLEMENT_INTENT_TYPES,
} from "./triggerSettlementProcess.types";

const logger = createLogger("langwatch:triggers:settlement-dispatch");

/** Log bounded-state flushes after the process commit, never from pure
 *  evolve. The cap never discards matches — it dispatches the oldest ones
 *  ahead of their settle boundary; this records how often that degraded
 *  batching kicks in. */
export function createLogOverflowHandler(): IntentExecutor<LogOverflowIntent> {
  return async (payload, context) => {
    // Overflow is OUR amplification, not the customer's: it happens because
    // matches are recorded before filters are evaluated. It is counted for the
    // team and never charged against a customer's ceiling.
    incrementAutomationOverflowFlushTotal(payload.flushed);
    logger.warn(
      {
        projectId: context.projectId,
        triggerId: payload.triggerId,
        flushed: payload.flushed,
        totalFlushed: payload.totalFlushed,
      },
      "Trigger settlement pending-match bound flushed oldest matches to immediate dispatch",
    );
  };
}

interface ActionParams {
  members?: string[] | null;
  slackWebhook?: string | null;
  /** ADR-041 Slack bot delivery. Absent `slackDelivery` = legacy webhook. */
  slackDelivery?: "webhook" | "bot";
  /** Encrypted bot token (ciphertext) — decrypted just before dispatch. */
  slackBotToken?: string;
  slackChannelId?: string;
  /** ADR-040 SEND_WEBHOOK destination — the whole config, body included,
   *  lives in actionParams. Header values are secrets, stored as one
   *  ciphertext blob (ADR-040 §3) and decrypted just before dispatch. */
  url?: string;
  method?: WebhookMethod;
  headersEncrypted?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string | null;
  /** Optional HMAC signing (ADR-040 §3), stored the same way as the header
   *  values. Absent means the delivery goes out unsigned. */
  signingSecretEncrypted?: string;
  previousSigningSecretEncrypted?: string;
  previousSigningSecretExpiresAt?: number;
}

/**
 * Everything the settled dispatch needs. Mirrors the legacy outbox
 * dispatcher's deps (ADR-030/031/035/036/040/041 contracts) minus the
 * queue transport — the ProcessManagerOutbox owns retry now.
 */
export interface TriggerSettlementDispatchDeps extends ConfirmSettledMatchDeps {
  triggers: TriggerService;
  projects: ProjectService;
  /** Base host for deep links inside rendered customer templates (ADR-036). */
  baseHost: string;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  evaluationRuns: EvaluationRunService;
  traceById: (projectId: string, traceId: string) => Promise<Trace | undefined>;
  addToAnnotationQueue: (params: {
    traceIds: string[];
    projectId: string;
    annotators: string[];
    userId: string;
  }) => Promise<void>;
  addToDataset: (params: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
  }) => Promise<void>;
  /** ADR-040 §6 delivery-log writer. Optional: absent in tests. */
  recordWebhookDelivery?: WebhookDeliveryRecorder;
  /** ADR-031 per-trigger hourly email cap (dedupKey gates the INCR). */
  consumeEmailCapSlot: (args: {
    projectId: string;
    triggerId: string;
    now: Date;
    dedupKey: string;
  }) => Promise<{ allowed: boolean; count: number }>;
  emailHourlyCap: number;
  /** ADR-031 per-project daily cap (counts recipients). */
  consumeTenantEmailCapSlot: (args: {
    projectId: string;
    now: Date;
    cap: number;
    recipientCount: number;
    dedupKey: string;
  }) => Promise<{ allowed: boolean; count: number }>;
  tenantDailyCap: number;
  /** ADR-031 unsubscribe suppression. */
  filterSuppressedEmails: (args: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }) => Promise<string[]>;
  /** Plan-tiered daily ceiling on confirmed persist dispatches. */
  resolvePersistDailyCap: (projectId: string) => Promise<number>;
  consumePersistCapSlot: (args: {
    projectId: string;
    triggerId: string;
    now: Date;
    cap: number;
    dedupKey: string;
  }) => Promise<{
    allowed: boolean;
    count: number;
    cap: number;
    skipped: number;
  }>;
  /** Emails, pauses and counts a breach. Must never throw. */
  handlePersistCapBreach: (args: {
    trigger: TriggerSummary;
    projectId: string;
    count: number;
    cap: number;
    skipped: number;
  }) => Promise<void>;
}

/**
 * Retry doctrine on the process outbox: THROW only what should retry.
 * Terminal outcomes (trigger gone, non-retryable DispatchError, cap or
 * suppression drops) return normally so the message retires as dispatched —
 * the legacy queue retried blindly and leaned on claims to no-op; the
 * process outbox lets us encode "terminal" directly.
 */
function rethrowIfRetryable(error: unknown, context: Record<string, unknown>) {
  const retryable = isDispatchError(error) ? error.retryable : true;
  logger.error(
    {
      ...context,
      retryable,
      error: error instanceof Error ? error.message : String(error),
    },
    "Settlement dispatch failed",
  );
  captureException(toError(error), { extra: context });
  if (retryable) throw error;
}

/** `notify-digest` handler for the withProcess declaration. */
export function createNotifyDigestHandler(
  deps: TriggerSettlementDispatchDeps,
): IntentExecutor<NotifyDigestIntent> {
  return async (payload, context) => {
    try {
      await dispatchNotifyDigest({
        deps,
        projectId: context.projectId,
        triggerId: payload.triggerId,
        traceIds: payload.traceIds,
        messageKey: context.messageKey,
      });
    } catch (error) {
      rethrowIfRetryable(error, {
        projectId: context.projectId,
        triggerId: payload.triggerId,
        intent: TRIGGER_SETTLEMENT_INTENT_TYPES.NOTIFY_DIGEST,
        attempt: context.attempt,
      });
    }
  };
}

/**
 * `persist-match` handler for the withProcess declaration. Accepts both
 * payload shapes: the paged `{ traceIds }` and the legacy single
 * `{ traceId }` still pending in the outbox from before the paging change.
 */
export function createPersistMatchHandler(
  deps: TriggerSettlementDispatchDeps,
): IntentExecutor<PersistMatchIntent> {
  return async (payload, context) => {
    const traceIds =
      "traceIds" in payload ? payload.traceIds : [payload.traceId];
    try {
      await dispatchPersistMatchPage({
        deps,
        projectId: context.projectId,
        triggerId: payload.triggerId,
        traceIds,
      });
    } catch (error) {
      rethrowIfRetryable(error, {
        projectId: context.projectId,
        triggerId: payload.triggerId,
        traceCount: traceIds.length,
        intent: TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH,
        attempt: context.attempt,
      });
    }
  };
}

/**
 * The ADR-027 cadence digest, dispatched from the process outbox. Behavior
 * is the legacy cadence handler's, unchanged: settle-confirm each trace,
 * dedup against `TriggerSent` claims, ADR-031 suppression + caps keyed on
 * the dispatch digest, ADR-036/041 template render or legacy senders,
 * claim-after-send, `updateLastRunAt` last.
 */
async function dispatchNotifyDigest({
  deps,
  projectId,
  triggerId,
  traceIds,
  messageKey,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  traceIds: string[];
  messageKey: string;
}): Promise<void> {
  const triggersForProject =
    await deps.triggers.getActiveTraceTriggersForProject(projectId);
  const trigger = triggersForProject.find((t) => t.id === triggerId);
  if (!trigger) {
    logger.info(
      { projectId, triggerId, batchSize: traceIds.length },
      "Trigger gone / deactivated since match — dropping digest",
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

  // Settle re-check + cross-dispatch dedup. The settled fold drives the
  // filter confirm (a match that no longer passes is dropped silently, as
  // the legacy settle stage did); `isSendClaimed` suppresses traces an
  // earlier dispatch already notified. The claim WRITE stays post-send —
  // writing it pre-send would defeat outbox retry (a retryable provider
  // failure would see claim=true on retry and silently no-op the resend).
  const brandedTenantId = createTenantId(projectId);
  const candidates: Array<{ traceId: string; foldState: TraceSummaryData }> =
    [];
  for (const traceId of new Set(traceIds)) {
    const foldState = await deps.traceSummaryStore.get(traceId, {
      tenantId: brandedTenantId,
      aggregateId: traceId,
    });
    if (!foldState) {
      logger.debug(
        { projectId, triggerId, traceId },
        "Trace fold gone before dispatch — skipping match",
      );
      continue;
    }
    if (
      !(await confirmSettledMatch({
        deps,
        trigger,
        projectId,
        traceId,
        foldState,
      }))
    ) {
      continue;
    }
    const alreadySent = await deps.triggers.isSendClaimed({
      triggerId,
      traceId,
      projectId,
    });
    if (alreadySent) continue;
    candidates.push({ traceId, foldState });
  }
  if (candidates.length === 0) {
    logger.debug(
      { projectId, triggerId, batchSize: traceIds.length },
      "Digest fully suppressed (filters / prior claims) — no dispatch",
    );
    return;
  }

  // Content is read HERE, not carried on the intent. The intent is an
  // identity: trace content on it would be customer text at rest in the
  // ProcessManagerOutbox row, duplicated from ClickHouse and outliving the
  // trace. The fold is the same projection the settle confirm just read.
  const params = (trigger.actionParams ?? {}) as ActionParams;
  const triggerData = await Promise.all(
    candidates.map(async ({ traceId, foldState }) => {
      const trace = await deps.traceById(projectId, traceId);
      return {
        traceId,
        input: foldState.computedInput ?? "",
        output: foldState.computedOutput ?? "",
        projectId,
        fullTrace: trace ?? ({ trace_id: traceId } as Trace),
      };
    }),
  );

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
  // drops still run `claimSend` below (a retry must no-op) but skip the
  // delivery-only bookkeeping (`updateLastRunAt`, success log).
  let didSend = false;
  let dropReason: string | undefined;

  switch (trigger.action) {
    case TriggerAction.SEND_EMAIL: {
      // ADR-031: drop unsubscribed recipients FIRST — an all-suppressed
      // dispatch has nothing to send and must not burn a cap slot.
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
      // Stable per-dispatch digest over the candidate traceIds: identical
      // across outbox retries of THIS dispatch, distinct from other
      // dispatches. Keys the cap claims AND the per-recipient ledger.
      const dispatchDigest = createHash("sha256")
        .update(
          candidates
            .map((c) => c.traceId)
            .sort()
            .join(","),
        )
        .digest("hex")
        .slice(0, 16);
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
      const tenantSlot = await deps.consumeTenantEmailCapSlot({
        projectId,
        now: new Date(),
        cap: deps.tenantDailyCap,
        recipientCount: recipients.length,
        dedupKey: `${projectId}:tenant:${triggerId}:${dispatchDigest}`,
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
      // Per-recipient idempotency (ADR-031): the TriggerSent claim store,
      // recipient hash under a `rcpt:` prefix. Stable across retries of THIS
      // dispatch so a partial provider failure retries only the unfinished
      // recipients.
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
    case TriggerAction.SEND_SLACK_MESSAGE: {
      // ADR-041: a bot connection posts via the Web API with the gated
      // chart/table/alert blocks open — never the legacy plain-text builder.
      if (slackDeliveryMethodOf(params) === "bot") {
        const token = decryptSlackBotToken(params);
        const channel = params.slackChannelId?.trim();
        if (!token || !channel) {
          throw new DispatchError({
            message: `Slack bot connection for trigger "${trigger.name}" is missing its token or channel`,
            retryable: false,
          });
        }
        const rendered = await renderTriggerSlack({
          templateType:
            t.slackTemplateType === "block_kit" ? "block_kit" : "string",
          template: t.slackTemplate,
          context: buildContext(),
          allowGatedBlocks: true,
        });
        if (rendered.errors.length > 0) {
          logger.warn(
            { projectId, triggerId, errors: rendered.errors },
            "Custom Slack template render errors — fell back to default",
          );
        }
        await postSlackChatMessage({
          token,
          channel,
          payload: rendered.payload,
          triggerName: trigger.name,
        });
        didSend = true;
        break;
      }
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
    }
    case TriggerAction.SEND_WEBHOOK: {
      if (!params.url) {
        throw new DispatchError({
          message: `Webhook trigger "${trigger.name}" has no URL configured`,
          retryable: false,
        });
      }
      // ADR-040 §2: Liquid → JSON.parse, falling back to the framework
      // default envelope on any template failure.
      const rendered = await renderWebhookBody({
        template: params.bodyTemplate ?? null,
        context: buildContext(),
      });
      if (rendered.errors.length > 0) {
        logger.warn(
          { projectId, triggerId, errors: rendered.errors },
          "Webhook body template render errors — fell back to default body",
        );
      }
      // The outbox message key is the logical fire identity. Deriving the
      // receiver-facing id from it keeps the id stable when a crash after a
      // partial claim causes the retry's surviving candidate set to shrink.
      const webhookEventId =
        "evt_" +
        createHash("sha256").update(messageKey).digest("hex").slice(0, 32);
      await deliverWebhook({
        recorder: deps.recordWebhookDelivery,
        projectId,
        triggerId,
        eventId: webhookEventId,
        url: params.url,
        method: params.method,
        headers: decryptWebhookHeaders(params),
        signingSecrets: decryptWebhookSigningSecrets(params),
        body: rendered.body,
        triggerName: trigger.name,
      });
      didSend = true;
      break;
    }
    default:
      throw new DispatchError({
        message: `notify digest cannot dispatch action ${trigger.action} — match subscriber misrouted`,
        retryable: false,
      });
  }

  // Post-dispatch: claim each (trigger, trace) so a future match of the
  // same pair is suppressed. Best-effort — the provider call already
  // succeeded, so a claim failure must not throw (an outbox retry would
  // double-send).
  for (const { traceId } of candidates) {
    try {
      await deps.triggers.claimSend({ triggerId, traceId, projectId });
    } catch (claimErr) {
      logger.warn(
        {
          projectId,
          triggerId,
          traceId,
          error:
            claimErr instanceof Error ? claimErr.message : String(claimErr),
        },
        "claimSend failed post-dispatch — swallowing to avoid double-send on retry",
      );
      captureException(toError(claimErr), {
        extra: {
          projectId,
          triggerId,
          traceId,
          phase: "claimSend-post-dispatch",
        },
      });
    }
  }

  if (!didSend) {
    logger.info(
      {
        projectId,
        triggerId,
        action: trigger.action,
        cadence: trigger.notificationCadence,
        dropReason,
      },
      "Notify digest dropped (no recipients or over cap) — claimed but not sent",
    );
    return;
  }

  // `updateLastRunAt` is a soft-state cosmetic for the operator UI. The
  // send already happened; a failure here must not throw (retry would
  // re-emit an identical digest).
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
      digestSize: candidates.length,
    },
    "Notify digest dispatched",
  );
}

/**
 * Consumes one slot of the trigger's daily ceiling for this confirmed match,
 * and reports whether the action may go ahead.
 *
 * A refusal is a TERMINAL drop rather than a throw: retrying would not find a
 * slot and would only churn the outbox. The trigger stays ACTIVE and works
 * again next UTC day, unless containment decides its shape is misconfigured
 * rather than merely busy.
 */
async function allowedByDailyCeiling({
  deps,
  trigger,
  projectId,
  traceId,
  cap,
  claimBreachReport,
}: {
  deps: TriggerSettlementDispatchDeps;
  trigger: TriggerSummary;
  projectId: string;
  traceId: string;
  /** Resolved once per page — the plan lookup does not vary per trace. */
  cap: number;
  /**
   * Page-scoped once-guard for breach containment: true means this call
   * reports the breach (email + pause), false means a page-mate already
   * did. Every refused trace stays dropped either way.
   */
  claimBreachReport: () => boolean;
}): Promise<boolean> {
  const triggerId = trigger.id;
  const slot = await deps.consumePersistCapSlot({
    projectId,
    triggerId,
    // The (trigger, trace) pair is this dispatch's identity, so an outbox
    // retry of the same dispatch presents the same key and re-reads the count
    // instead of burning a second slot.
    dedupKey: `${projectId}/${triggerId}:persist:${traceId}`,
    now: new Date(),
    cap,
  });
  if (slot.allowed) return true;

  logger.warn(
    { projectId, triggerId, traceId, count: slot.count, cap: slot.cap },
    "Automation passed its daily match ceiling — skipping this match for " +
      "the rest of the UTC day",
  );
  if (!claimBreachReport()) return false;
  // Containment is bookkeeping ABOUT a match that has already been dropped.
  // Letting it throw would send the whole dispatch back through the outbox's
  // retry ladder, and every one of those attempts would reach this same point
  // and drop the match again. The failure is recorded and the dispatch still
  // completes.
  try {
    await deps.handlePersistCapBreach({
      trigger,
      projectId,
      count: slot.count,
      cap: slot.cap,
      skipped: slot.skipped,
    });
  } catch (containmentError) {
    logger.error(
      {
        projectId,
        triggerId,
        error:
          containmentError instanceof Error
            ? containmentError.message
            : String(containmentError),
      },
      "Runaway containment threw while handling a ceiling breach — the match " +
        "stays dropped and the dispatch is not retried",
    );
    captureException(toError(containmentError), {
      extra: { projectId, triggerId, phase: "persist-cap-breach" },
    });
  }
  return false;
}

/** Traces confirmed concurrently inside one persist page. */
const PERSIST_CONFIRM_CONCURRENCY = 4;

/**
 * Persist-class dispatch (ADR-035, paged): one page of settled matches per
 * intent. The fixed per-dispatch reads (trigger row, prior claims, plan cap,
 * project) run once per page; the per-trace confirm and action run through a
 * small pool. `TriggerSent` claims keep each trace's side effect
 * at-most-once, written AFTER a successful dispatch, so a retry of the page
 * re-runs only the traces that never claimed.
 */
async function dispatchPersistMatchPage({
  deps,
  projectId,
  triggerId,
  traceIds,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  traceIds: string[];
}): Promise<void> {
  const triggersForProject =
    await deps.triggers.getActiveTraceTriggersForProject(projectId);
  const trigger = triggersForProject.find((t) => t.id === triggerId);
  if (!trigger) {
    logger.info(
      { projectId, triggerId, pageSize: traceIds.length },
      "Trigger gone / deactivated since match — dropping persist dispatch",
    );
    return;
  }

  const uniqueTraceIds = [...new Set(traceIds)];
  const alreadySent = await deps.triggers.filterSendClaimed({
    triggerId,
    traceIds: uniqueTraceIds,
    projectId,
  });
  const remaining = uniqueTraceIds.filter(
    (traceId) => !alreadySent.has(traceId),
  );
  if (remaining.length === 0) return;

  const cap = await deps.resolvePersistDailyCap(projectId);
  // The action layer needs the project row; resolving it once here keeps a
  // page at one read instead of one per trace.
  const project = await deps.projects.getById(projectId);
  if (!project) {
    throw new DispatchError({
      message: `project ${projectId} not found at dispatch time`,
      retryable: false,
    });
  }

  // Breach containment (email + pause) fires at most once per page; every
  // refused trace still stays dropped.
  let breachReported = false;
  const claimBreachReport = () => {
    if (breachReported) return false;
    breachReported = true;
    return true;
  };

  const brandedTenantId = createTenantId(projectId);
  // A terminal failure for one trace must not fail its page-mates, and a
  // retryable failure must retry the page exactly once, after every other
  // trace had its chance. Each pooled run therefore settles locally and
  // reports; the page throws one representative retryable error at the end.
  const retryableFailures: unknown[] = [];

  const dispatchOneTrace = async (traceId: string): Promise<void> => {
    const foldState = await deps.traceSummaryStore.get(traceId, {
      tenantId: brandedTenantId,
      aggregateId: traceId,
    });
    if (!foldState) {
      logger.debug(
        { projectId, triggerId, traceId },
        "Trace fold gone before persist dispatch — skipping match",
      );
      return;
    }
    if (
      !(await confirmSettledMatch({
        deps,
        trigger,
        projectId,
        traceId,
        foldState,
      }))
    ) {
      return;
    }

    // THE CEILING SITS EXACTLY HERE, and the position is the policy.
    //
    // After `confirmSettledMatch`, so only CUSTOMER-ATTRIBUTABLE volume
    // counts: a match that no longer passes its filters returned above and
    // consumed nothing. Before `dispatchTriggerAction`, so passing the
    // ceiling costs the customer the action, not a half-written one.
    //
    // Match RECORDING is deliberately not capped. Our pipeline records a
    // match for every active trigger on every trace and only evaluates
    // filters later, so that volume is our amplification and pressing the
    // customer about it would be charging them for our design.
    if (
      !(await allowedByDailyCeiling({
        deps,
        trigger,
        projectId,
        traceId,
        cap,
        claimBreachReport,
      }))
    ) {
      return;
    }

    await dispatchTriggerAction({
      deps,
      trigger,
      traceId,
      tenantId: projectId,
      foldState,
      project,
    });

    // Post-dispatch at-most-once write. Best-effort: the side effect already
    // landed; throwing would let the outbox retry and double-dispatch.
    try {
      await deps.triggers.claimSend({ triggerId, traceId, projectId });
    } catch (claimErr) {
      logger.warn(
        {
          projectId,
          triggerId,
          traceId,
          error:
            claimErr instanceof Error ? claimErr.message : String(claimErr),
        },
        "claimSend failed post-persist-dispatch — swallowing to avoid double-dispatch on retry",
      );
      captureException(toError(claimErr), {
        extra: {
          projectId,
          triggerId,
          traceId,
          phase: "claimSend-post-persist-dispatch",
        },
      });
    }
  };

  await pMapLimited({
    items: remaining,
    concurrency: PERSIST_CONFIRM_CONCURRENCY,
    fn: async (traceId) => {
      try {
        await dispatchOneTrace(traceId);
      } catch (error) {
        const retryable = isDispatchError(error) ? error.retryable : true;
        if (retryable) {
          retryableFailures.push(error);
          return;
        }
        // Terminal for this trace only: recorded, page-mates unaffected.
        logger.error(
          {
            projectId,
            triggerId,
            traceId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Persist dispatch failed terminally for one trace of a page",
        );
        captureException(toError(error), {
          extra: { projectId, triggerId, traceId },
        });
      }
    },
  });

  if (retryableFailures.length > 0) {
    logger.warn(
      {
        projectId,
        triggerId,
        failed: retryableFailures.length,
        pageSize: remaining.length,
      },
      "Persist page had retryable failures — retrying the page; claimed traces no-op on the retry",
    );
    throw retryableFailures[0];
  }
}
