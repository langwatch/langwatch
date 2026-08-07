import { slackDeliveryMethodOf } from "@langwatch/automations/providers/slack";
import type { WebhookMethod } from "@langwatch/automations/providers/webhook";
import { renderTriggerEmail } from "@langwatch/automations/templating/renderEmail";
import { renderTriggerSlack } from "@langwatch/automations/templating/renderSlack";
import { renderWebhookBody } from "@langwatch/automations/templating/renderWebhookBody";
import {
  buildTemplateContext,
  type TemplateContext,
  type TemplateMatchInput,
} from "@langwatch/automations/templating/templateContext";
import { createLogger } from "@langwatch/observability";
import { type Project, TriggerAction } from "@prisma/client";
import { createHash } from "crypto";
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
import {
  sendRenderedTriggerEmail,
  sendTriggerEmail,
} from "~/server/mailer/triggerEmail";
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

/** `persist-match` handler for the withProcess declaration. */
export function createPersistMatchHandler(
  deps: TriggerSettlementDispatchDeps,
): IntentExecutor<PersistMatchIntent> {
  return async (payload, context) => {
    try {
      await dispatchPersistMatch({
        deps,
        projectId: context.projectId,
        triggerId: payload.triggerId,
        traceId: payload.traceId,
      });
    } catch (error) {
      rethrowIfRetryable(error, {
        projectId: context.projectId,
        triggerId: payload.triggerId,
        traceId: payload.traceId,
        intent: TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH,
        attempt: context.attempt,
      });
    }
  };
}

interface NotifyDigestCandidate {
  traceId: string;
  foldState: TraceSummaryData;
}

interface NotifyDigestTraceDatum {
  traceId: string;
  input: string;
  output: string;
  projectId: string;
  fullTrace: Trace;
}

interface NotifyDigestActionResult {
  didSend: boolean;
  dropReason?: string;
}

// Settle re-check + cross-dispatch dedup. The settled fold drives the filter
// confirm (a match that no longer passes is dropped silently, as the legacy
// settle stage did); `isSendClaimed` suppresses traces an earlier dispatch
// already notified. The claim WRITE stays post-send — writing it pre-send
// would defeat outbox retry (a retryable provider failure would see
// claim=true on retry and silently no-op the resend).
async function gatherNotifyDigestCandidates({
  deps,
  trigger,
  projectId,
  triggerId,
  traceIds,
}: {
  deps: TriggerSettlementDispatchDeps;
  trigger: TriggerSummary;
  projectId: string;
  triggerId: string;
  traceIds: string[];
}): Promise<NotifyDigestCandidate[]> {
  const brandedTenantId = createTenantId(projectId);
  const candidates: NotifyDigestCandidate[] = [];
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
  return candidates;
}

// Content is read HERE, not carried on the intent. The intent is an
// identity: trace content on it would be customer text at rest in the
// ProcessManagerOutbox row, duplicated from ClickHouse and outliving the
// trace. The fold is the same projection the settle confirm just read.
async function buildNotifyDigestTraceData({
  deps,
  projectId,
  candidates,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  candidates: NotifyDigestCandidate[];
}): Promise<NotifyDigestTraceDatum[]> {
  return Promise.all(
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
}

function buildNotifyDigestTemplateContext({
  deps,
  trigger,
  project,
  triggerData,
}: {
  deps: TriggerSettlementDispatchDeps;
  trigger: TriggerSummary;
  project: Project;
  triggerData: NotifyDigestTraceDatum[];
}): TemplateContext {
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
}

type NotifyDigestEmailAuthorization =
  | { allowed: true; recipients: string[]; dispatchDigest: string }
  | { allowed: false; dropReason: string };

// ADR-031: drop unsubscribed recipients FIRST — an all-suppressed dispatch
// has nothing to send and must not burn a cap slot. Then the per-trigger
// hourly cap, then the per-project daily backstop — each keyed off a stable
// per-dispatch digest over the candidate traceIds so outbox retries of THIS
// dispatch reuse the same claim instead of burning a second slot.
async function authorizeNotifyDigestEmailSend({
  deps,
  projectId,
  triggerId,
  params,
  candidates,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  params: ActionParams;
  candidates: NotifyDigestCandidate[];
}): Promise<NotifyDigestEmailAuthorization> {
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
    return { allowed: false, dropReason: "dropped: all recipients suppressed" };
  }
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
    return { allowed: false, dropReason: "dropped: over hourly cap" };
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
    return {
      allowed: false,
      dropReason: "dropped: over project daily email cap",
    };
  }
  return { allowed: true, recipients, dispatchDigest };
}

async function sendNotifyDigestCustomEmail({
  projectId,
  triggerId,
  trigger,
  recipients,
  buildContext,
  isRecipientSent,
  recordRecipientSent,
}: {
  projectId: string;
  triggerId: string;
  trigger: TriggerSummary;
  recipients: string[];
  buildContext: () => TemplateContext;
  isRecipientSent: (recipientHash: string) => Promise<boolean>;
  recordRecipientSent: (recipientHash: string) => Promise<void>;
}): Promise<void> {
  const t = trigger.templates;
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
}

async function dispatchNotifyDigestEmail({
  deps,
  projectId,
  triggerId,
  trigger,
  project,
  params,
  candidates,
  hasCustomEmail,
  triggerData,
  buildContext,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  trigger: TriggerSummary;
  project: Project;
  params: ActionParams;
  candidates: NotifyDigestCandidate[];
  hasCustomEmail: boolean;
  triggerData: NotifyDigestTraceDatum[];
  buildContext: () => TemplateContext;
}): Promise<NotifyDigestActionResult> {
  const authorization = await authorizeNotifyDigestEmailSend({
    deps,
    projectId,
    triggerId,
    params,
    candidates,
  });
  if (!authorization.allowed) {
    return { didSend: false, dropReason: authorization.dropReason };
  }
  const { recipients, dispatchDigest } = authorization;
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
    await sendNotifyDigestCustomEmail({
      projectId,
      triggerId,
      trigger,
      recipients,
      buildContext,
      isRecipientSent,
      recordRecipientSent,
    });
    return { didSend: true };
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
  return { didSend: true };
}

// ADR-041: a bot connection posts via the Web API with the gated
// chart/table/alert blocks open — never the legacy plain-text builder.
async function sendNotifyDigestSlackBot({
  projectId,
  triggerId,
  trigger,
  params,
  buildContext,
}: {
  projectId: string;
  triggerId: string;
  trigger: TriggerSummary;
  params: ActionParams;
  buildContext: () => TemplateContext;
}): Promise<void> {
  const t = trigger.templates;
  const token = decryptSlackBotToken(params);
  const channel = params.slackChannelId?.trim();
  if (!token || !channel) {
    throw new DispatchError({
      message: `Slack bot connection for trigger "${trigger.name}" is missing its token or channel`,
      retryable: false,
    });
  }
  const rendered = await renderTriggerSlack({
    templateType: t.slackTemplateType === "block_kit" ? "block_kit" : "string",
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
}

async function sendNotifyDigestSlackCustomTemplate({
  projectId,
  triggerId,
  trigger,
  params,
  buildContext,
}: {
  projectId: string;
  triggerId: string;
  trigger: TriggerSummary;
  params: ActionParams;
  buildContext: () => TemplateContext;
}): Promise<void> {
  const t = trigger.templates;
  const rendered = await renderTriggerSlack({
    templateType: t.slackTemplateType === "block_kit" ? "block_kit" : "string",
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
}

async function dispatchNotifyDigestSlack({
  projectId,
  triggerId,
  trigger,
  project,
  params,
  hasCustomSlack,
  triggerData,
  buildContext,
}: {
  projectId: string;
  triggerId: string;
  trigger: TriggerSummary;
  project: Project;
  params: ActionParams;
  hasCustomSlack: boolean;
  triggerData: NotifyDigestTraceDatum[];
  buildContext: () => TemplateContext;
}): Promise<void> {
  if (slackDeliveryMethodOf(params) === "bot") {
    await sendNotifyDigestSlackBot({
      projectId,
      triggerId,
      trigger,
      params,
      buildContext,
    });
    return;
  }
  if (hasCustomSlack) {
    await sendNotifyDigestSlackCustomTemplate({
      projectId,
      triggerId,
      trigger,
      params,
      buildContext,
    });
    return;
  }
  await sendSlackWebhook({
    triggerWebhook: params.slackWebhook ?? "",
    triggerData,
    triggerName: trigger.name,
    projectSlug: project.slug,
    triggerType: trigger.alertType,
    triggerMessage: trigger.message ?? "",
  });
}

async function dispatchNotifyDigestWebhook({
  deps,
  projectId,
  triggerId,
  trigger,
  params,
  messageKey,
  buildContext,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  trigger: TriggerSummary;
  params: ActionParams;
  messageKey: string;
  buildContext: () => TemplateContext;
}): Promise<void> {
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
    "evt_" + createHash("sha256").update(messageKey).digest("hex").slice(0, 32);
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
}

// Post-dispatch: claim each (trigger, trace) so a future match of the same
// pair is suppressed. Best-effort — the provider call already succeeded, so
// a claim failure must not throw (an outbox retry would double-send).
async function claimNotifyDigestCandidates({
  deps,
  projectId,
  triggerId,
  candidates,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  candidates: NotifyDigestCandidate[];
}): Promise<void> {
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
}

async function finalizeNotifyDigestDispatch({
  deps,
  projectId,
  triggerId,
  trigger,
  candidates,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  trigger: TriggerSummary;
  candidates: NotifyDigestCandidate[];
}): Promise<void> {
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

interface NotifyDigestDispatchPrep {
  params: ActionParams;
  triggerData: NotifyDigestTraceDatum[];
  hasCustomEmail: boolean;
  hasCustomSlack: boolean;
  buildContext: () => TemplateContext;
}

// Content is read HERE, not carried on the intent. The intent is an
// identity: trace content on it would be customer text at rest in the
// ProcessManagerOutbox row, duplicated from ClickHouse and outliving the
// trace. The fold is the same projection the settle confirm just read.
async function prepareNotifyDigestDispatch({
  deps,
  projectId,
  trigger,
  project,
  candidates,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  trigger: TriggerSummary;
  project: Project;
  candidates: NotifyDigestCandidate[];
}): Promise<NotifyDigestDispatchPrep> {
  const params = (trigger.actionParams ?? {}) as ActionParams;
  const triggerData = await buildNotifyDigestTraceData({
    deps,
    projectId,
    candidates,
  });
  const t = trigger.templates;
  const hasCustomEmail =
    t.emailSubjectTemplate != null || t.emailBodyTemplate != null;
  const hasCustomSlack = t.slackTemplate != null;
  const buildContext = () =>
    buildNotifyDigestTemplateContext({ deps, trigger, project, triggerData });
  return {
    params,
    triggerData,
    hasCustomEmail,
    hasCustomSlack,
    buildContext,
  };
}

// Tracks whether a provider send actually happened. Suppression / over-cap
// drops still run `claimSend` in the caller (a retry must no-op) but skip
// the delivery-only bookkeeping (`updateLastRunAt`, success log).
async function dispatchNotifyDigestAction({
  deps,
  projectId,
  triggerId,
  trigger,
  project,
  params,
  candidates,
  hasCustomEmail,
  hasCustomSlack,
  triggerData,
  buildContext,
  messageKey,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  trigger: TriggerSummary;
  project: Project;
  params: ActionParams;
  candidates: NotifyDigestCandidate[];
  hasCustomEmail: boolean;
  hasCustomSlack: boolean;
  triggerData: NotifyDigestTraceDatum[];
  buildContext: () => TemplateContext;
  messageKey: string;
}): Promise<NotifyDigestActionResult> {
  switch (trigger.action) {
    case TriggerAction.SEND_EMAIL:
      return dispatchNotifyDigestEmail({
        deps,
        projectId,
        triggerId,
        trigger,
        project,
        params,
        candidates,
        hasCustomEmail,
        triggerData,
        buildContext,
      });
    case TriggerAction.SEND_SLACK_MESSAGE:
      await dispatchNotifyDigestSlack({
        projectId,
        triggerId,
        trigger,
        project,
        params,
        hasCustomSlack,
        triggerData,
        buildContext,
      });
      return { didSend: true };
    case TriggerAction.SEND_WEBHOOK:
      await dispatchNotifyDigestWebhook({
        deps,
        projectId,
        triggerId,
        trigger,
        params,
        messageKey,
        buildContext,
      });
      return { didSend: true };
    default:
      throw new DispatchError({
        message: `notify digest cannot dispatch action ${trigger.action} — match subscriber misrouted`,
        retryable: false,
      });
  }
}

async function resolveNotifyDigestTarget({
  deps,
  projectId,
  triggerId,
  traceIds,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  traceIds: string[];
}): Promise<{ trigger: TriggerSummary; project: Project } | null> {
  const triggersForProject =
    await deps.triggers.getActiveTraceTriggersForProject(projectId);
  const trigger = triggersForProject.find((t) => t.id === triggerId);
  if (!trigger) {
    logger.info(
      { projectId, triggerId, batchSize: traceIds.length },
      "Trigger gone / deactivated since match — dropping digest",
    );
    return null;
  }
  const project = await deps.projects.getById(projectId);
  if (!project) {
    throw new DispatchError({
      message: `project ${projectId} not found at dispatch time`,
      retryable: false,
    });
  }
  return { trigger, project };
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
  const target = await resolveNotifyDigestTarget({
    deps,
    projectId,
    triggerId,
    traceIds,
  });
  if (!target) return;
  const { trigger, project } = target;

  const candidates = await gatherNotifyDigestCandidates({
    deps,
    trigger,
    projectId,
    triggerId,
    traceIds,
  });
  if (candidates.length === 0) {
    logger.debug(
      { projectId, triggerId, batchSize: traceIds.length },
      "Digest fully suppressed (filters / prior claims) — no dispatch",
    );
    return;
  }

  const { params, triggerData, hasCustomEmail, hasCustomSlack, buildContext } =
    await prepareNotifyDigestDispatch({
      deps,
      projectId,
      trigger,
      project,
      candidates,
    });

  const { didSend, dropReason } = await dispatchNotifyDigestAction({
    deps,
    projectId,
    triggerId,
    trigger,
    project,
    params,
    candidates,
    hasCustomEmail,
    hasCustomSlack,
    triggerData,
    buildContext,
    messageKey,
  });

  await claimNotifyDigestCandidates({
    deps,
    projectId,
    triggerId,
    candidates,
  });

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

  await finalizeNotifyDigestDispatch({
    deps,
    projectId,
    triggerId,
    trigger,
    candidates,
  });
}

/**
 * Persist-class dispatch (ADR-035): one settled match per intent. The
 * per-trace message key makes retries independent; `TriggerSent` claims
 * keep the side effect at-most-once, written AFTER a successful dispatch.
 */
async function dispatchPersistMatch({
  deps,
  projectId,
  triggerId,
  traceId,
}: {
  deps: TriggerSettlementDispatchDeps;
  projectId: string;
  triggerId: string;
  traceId: string;
}): Promise<void> {
  const triggersForProject =
    await deps.triggers.getActiveTraceTriggersForProject(projectId);
  const trigger = triggersForProject.find((t) => t.id === triggerId);
  if (!trigger) {
    logger.info(
      { projectId, triggerId, traceId },
      "Trigger gone / deactivated since match — dropping persist dispatch",
    );
    return;
  }

  const alreadySent = await deps.triggers.isSendClaimed({
    triggerId,
    traceId,
    projectId,
  });
  if (alreadySent) return;

  const brandedTenantId = createTenantId(projectId);
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

  await dispatchTriggerAction({
    deps,
    trigger,
    traceId,
    tenantId: projectId,
    foldState,
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
        error: claimErr instanceof Error ? claimErr.message : String(claimErr),
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
}
