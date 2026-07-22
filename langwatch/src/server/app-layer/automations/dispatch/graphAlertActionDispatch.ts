import type { Project, Trigger } from "@prisma/client";
import { createHash } from "crypto";
import { DispatchError } from "@langwatch/dispatch-error";
import {
  decryptWebhookHeaders,
  type WebhookStoredActionParams,
} from "~/server/app-layer/automations/providers/webhook/server";
import type { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import type { sendRenderedSlackMessage } from "@langwatch/automations-server/clients/slack/incoming-webhook.client";
import type { sendWebhook } from "~/server/app-layer/automations/delivery/appWebhookSender";
import {
  deliverWebhook,
  type WebhookDeliveryRecorder,
} from "@langwatch/automations-server/clients/http/deliver-webhook";
import type { postSlackChatMessage } from "~/server/app-layer/automations/delivery/appSlackWebApi";
import { ALERT_TRIGGER_DEFAULTS } from "@langwatch/automations/templating/defaults";
import { renderTriggerEmail } from "@langwatch/automations/templating/renderEmail";
import { renderWebhookBody } from "@langwatch/automations/templating/renderWebhookBody";
import {
  renderTriggerSlack,
  type SlackTemplateType,
} from "@langwatch/automations/templating/renderSlack";
import type { GraphAlertTemplateContext } from "@langwatch/automations/templating/templateContext";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:graph-alert-action-dispatch");

/**
 * The idempotency key prefix for ONE fire of ONE graph alert (ADR-031's
 * `rcpt:` convention, same shape the trace cadence dispatcher uses).
 *
 * A fire is delivered BEFORE its incident row is written, so a crash in
 * between makes the outbox retry the whole evaluation — and the retry finds no
 * open incident and dispatches again. Gating each send on this digest turns
 * that retry into a no-op for anyone already notified.
 *
 * `previousFireId` is the id of the alert's most recent incident row (open or
 * resolved), which is what makes the digest a per-FIRE identity rather than a
 * per-alert one:
 *
 *   - stable across retries of the same fire — no incident row is written
 *     until a send succeeds, so the "previous" id does not move; and
 *   - distinct for the next fire — the incident this fire opens becomes the
 *     next fire's `previousFireId`.
 *
 * Hashing the alert's identity alone would suppress every future fire to the
 * same recipients forever; hashing wall-clock would re-send whenever a retry
 * crossed a bucket boundary.
 */
export function graphAlertFireDigest({
  triggerId,
  customGraphId,
  previousFireId,
}: {
  triggerId: string;
  customGraphId: string;
  /** Null before the alert has ever fired. */
  previousFireId: string | null;
}): string {
  return createHash("sha256")
    .update(`${triggerId}:${customGraphId}:${previousFireId ?? "genesis"}`)
    .digest("hex")
    .slice(0, 16);
}

/** Short, privacy-preserving hash of one destination (an email address hash is
 *  produced by the mailer itself; this covers the Slack channel / webhook). */
function destinationHash(destination: string): string {
  return createHash("sha256").update(destination).digest("hex").slice(0, 16);
}

/**
 * Inputs the graph-trigger evaluator hands the dispatch helper. This is
 * the seam between the evaluator (which knows the metric value + the
 * threshold + the trigger) and the rendering pipeline (which knows how
 * to invoke Liquid + the senders).
 *
 * `recipients` (email) and `slackWebhook` are pre-extracted from
 * `trigger.actionParams` by the evaluator, so this module stays free of
 * the cron-page `ActionParams` type import.
 */
export interface GraphAlertDispatchInput {
  trigger: Trigger;
  project: Project;
  /** ADR-034 Phase 8.1 template-variable context. The evaluator builds
   *  it via `buildGraphAlertTemplateContext` and hands it in. */
  context: GraphAlertTemplateContext;
  /** Email-recipient list and Slack webhook URL — read from
   *  `trigger.actionParams`. */
  recipients: string[];
  slackWebhook: string | null;
  /** ADR-041 Slack bot connection: resolved token + channel, pre-extracted
   *  (and decrypted) from `trigger.actionParams` by the evaluator. When set,
   *  the alert posts via the Web API with gated blocks instead of the webhook. */
  botDestination?: { token: string; channel: string } | null;
  /** Stable identity of THIS fire — see {@link graphAlertFireDigest}. Prefixes
   *  every per-recipient idempotency key, so a retried dispatch skips whoever
   *  the previous attempt already reached. */
  fireDigest: string;
}

export interface GraphAlertDispatchDeps {
  /**
   * Per-recipient email sender — same `sendRenderedTriggerEmail` the
   * trace cadence dispatcher uses. Injected so this module is free of
   * mailer dependencies and easy to unit-test.
   */
  sendEmail: typeof sendRenderedTriggerEmail;
  /** Slack sender — same `sendRenderedSlackMessage` the trace cadence
   *  dispatcher uses. */
  sendSlack: typeof sendRenderedSlackMessage;
  /** Slack Web API sender for bot connections — same `postSlackChatMessage`
   *  the trace cadence dispatcher uses. */
  sendSlackBot: typeof postSlackChatMessage;
  /** ADR-040 SSRF-fenced webhook sender — same `sendWebhook` the trace
   *  cadence dispatcher uses. */
  sendWebhook: typeof sendWebhook;
  /** ADR-040 §6 delivery-log writer — records one row per attempt. Optional:
   *  when absent (tests, cron before wiring), deliveries aren't logged but
   *  dispatch is unchanged. */
  recordWebhookDelivery?: WebhookDeliveryRecorder;
  /**
   * ADR-031 email suppression gate. The event-sourced graph-alert path
   * renders the SAME one-click-unsubscribe footer + `List-Unsubscribe`
   * headers the cron path does, so it MUST honour the same suppression
   * list — otherwise a recipient who one-click-unsubscribed keeps receiving
   * alerts (RFC 8058 compliance regression). Returns the recipients that
   * survive suppression. Mirrors `getApp().emailSuppressions.filterSuppressed`
   * used by the cron's `handleSendEmail`.
   */
  filterSuppressedRecipients: (params: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }) => Promise<string[]>;
  /**
   * ADR-031: per-trigger hourly hard cap on dispatched trigger emails — the
   * SAME consumer the trace cadence dispatcher and the cron's email path use.
   * `allowed: false` means this trigger already sent `cap` emails this hour
   * and the dispatch must be dropped (not sent, not retried). Injected so
   * tests can fake it; Slack never calls it.
   *
   * `dedupKey` is the stable per-dispatch identity — keyed on the fire digest
   * here — so an outbox retry of the same fire does not re-INCR and burn a
   * second cap slot (the retry double-count finding).
   */
  consumeEmailCapSlot: (params: {
    projectId: string;
    triggerId: string;
    now: Date;
    dedupKey: string;
  }) => Promise<{ allowed: boolean; count: number }>;
  /** The configured hourly cap, for operator-facing drop logs (ADR-031). */
  emailHourlyCap: number;
  /**
   * ADR-031: per-PROJECT daily hard cap — a backstop ABOVE the per-trigger
   * hourly cap, consulted only once the hourly cap has passed and the
   * suppression-filtered recipient set is known. Counts RECIPIENTS (actual
   * outbound email volume, what SES reputation is measured on), not
   * dispatches. Same fire-digest dedup as the hourly cap, so a retry re-reads
   * the running total instead of counting its recipients twice.
   */
  consumeTenantEmailCapSlot: (params: {
    projectId: string;
    now: Date;
    cap: number;
    recipientCount: number;
    dedupKey: string;
  }) => Promise<{ allowed: boolean; count: number }>;
  /** The configured per-project daily cap, for operator-facing drop logs. */
  tenantDailyCap: number;
  /**
   * Read side of the per-recipient at-most-once ledger (ADR-031). Backed by
   * the SAME `TriggerSent` claim store the trace cadence dispatcher threads
   * into the mailer — the recipient key rides the `traceId` column under a
   * `rcpt:` prefix (a real trace id never carries one).
   *
   * The graph-alert path needs this because the incident row is written AFTER
   * the send: if that write (or `updateLastRunAt`) throws, the outbox retries
   * the whole evaluation, finds no open incident, and dispatches again. Without
   * the ledger that is a duplicate notification per retry, up to `maxAttempts`.
   */
  isRecipientSent: (params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }) => Promise<boolean>;
  /**
   * Write side, recorded only AFTER a successful provider call. Claiming
   * before the send would let a retryable provider failure permanently no-op
   * its own retry — the notification would be recorded as delivered while
   * nothing went out.
   */
  recordRecipientSent: (params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }) => Promise<void>;
}

export interface GraphAlertDispatchResult {
  channel: "email" | "slack" | "webhook" | "none";
  /** True when this fire is consumed from the caller's perspective: a
   *  provider call was made, a retry found every recipient already claimed,
   *  or an ADR-031 email cap suppressed the delivery (see `capExhausted`).
   *  False only on a config-only drop (no recipients, all unsubscribed, no
   *  webhook), which the caller logs — and rolls its claim back on — but
   *  does NOT treat as an error. */
  didSend: boolean;
  /** Set when an ADR-031 email cap dropped the delivery. `didSend` stays true
   *  — the fire consumed its cap slot and the caller must open the incident,
   *  matching the cron, which records `TriggerSent` even when a cap dropped
   *  the email — but no provider call was made. */
  capExhausted?: "trigger-hourly" | "project-daily";
  /** Variables a custom template referenced but the render context did
   *  not supply (ADR-036 / ADR-037). Aggregated across whichever
   *  channel rendered. */
  missingVariables: string[];
  /** Render errors from custom templates that fell back, for operator
   *  visibility. */
  renderErrors: string[];
}

/**
 * ADR-034 Phase 8.1 dispatch helper for custom-graph threshold alerts.
 *
 * Parallel to `dispatchTriggerAction` (the trace-shape persist
 * dispatcher) — kept separate because the alert path:
 *
 *   - renders against `GraphAlertTemplateContext` (no `matches[]`);
 *   - keys its incident dedup on the graph, not on a (trigger, trace) pair,
 *     and owns that at the evaluator layer;
 *   - never digest-coalesces — a breach is one alert, not a window of matches;
 *   - and the existing `dispatchTriggerAction` only handles persist
 *     actions inline (it explicitly throws for SEND_EMAIL /
 *     SEND_SLACK_MESSAGE).
 *
 * Squeezing this into the existing helper would require a kind-
 * discriminated branch whose two arms share no logic.
 *
 * What it DOES share with the trace notify path, deliberately: the ADR-031
 * suppression list, the per-trigger hourly + per-project daily email caps,
 * and the per-recipient at-most-once ledger (all injected as deps and keyed
 * the same way), so an unsubscribe means the same thing, a flapping metric
 * cannot mail past the caps, and a retry re-notifies nobody — whichever path
 * delivered.
 *
 * Uses `ALERT_TRIGGER_DEFAULTS` directly as the default template set,
 * then defers to the same Liquid pipeline the
 * trace notify path uses (`renderTriggerEmail` / `renderTriggerSlack`)
 * so per-trigger custom templates (the four Trigger columns) override
 * the defaults uniformly. The senders are the rendered-form variants
 * (`sendRenderedTriggerEmail` / `sendRenderedSlackMessage`) — same ones
 * the trace cadence dispatcher uses; sender signatures are unchanged.
 *
 * The event-sourced evaluator (real-time reactor + heartbeat) is the sole
 * caller — the K8s cron that used to share this dispatcher was removed once
 * every project cut over (ADR-034).
 */
export async function dispatchGraphAlertAction({
  deps,
  input,
}: {
  deps: GraphAlertDispatchDeps;
  input: GraphAlertDispatchInput;
}): Promise<GraphAlertDispatchResult> {
  const { trigger, project, context, recipients, slackWebhook } = input;
  const defaults = ALERT_TRIGGER_DEFAULTS;

  // Per-recipient at-most-once gate for THIS fire. Same key shape the trace
  // cadence dispatcher uses (`rcpt:{fireDigest}:{recipientHash}`), so both
  // paths read and write one ledger.
  const claimKey = (recipientHash: string) =>
    `rcpt:${input.fireDigest}:${recipientHash}`;
  const isRecipientSent = (recipientHash: string) =>
    deps.isRecipientSent({
      triggerId: trigger.id,
      traceId: claimKey(recipientHash),
      projectId: project.id,
    });
  const recordRecipientSent = async (recipientHash: string) => {
    await deps.recordRecipientSent({
      triggerId: trigger.id,
      traceId: claimKey(recipientHash),
      projectId: project.id,
    });
  };

  if (trigger.action === "SEND_EMAIL") {
    if (recipients.length === 0) {
      logger.info(
        { triggerId: trigger.id, projectId: project.id },
        "Graph alert has no email recipients — skipping send",
      );
      return {
        channel: "email",
        didSend: false,
        missingVariables: [],
        renderErrors: [],
      };
    }
    // ADR-031: drop suppressed (unsubscribed) recipients BEFORE rendering /
    // sending, exactly as the cron's handleSendEmail does. Without this the
    // event-sourced path silently ignores one-click unsubscribes.
    const allowedRecipients = await deps.filterSuppressedRecipients({
      projectId: project.id,
      triggerId: trigger.id,
      emails: recipients,
    });
    if (allowedRecipients.length === 0) {
      logger.info(
        { triggerId: trigger.id, projectId: project.id },
        "All graph-alert email recipients are suppressed — skipping send",
      );
      return {
        channel: "email",
        didSend: false,
        missingVariables: [],
        renderErrors: [],
      };
    }
    // ADR-031: the two hard email caps, consumed HERE — inside the shared
    // dispatcher — so the real-time reactor and heartbeat callers cannot
    // drift. Both claims are keyed on the fire digest, so an outbox retry of
    // THIS fire re-reads the count instead of burning a second slot, and the
    // next incident (new digest) gets a fresh slot.
    //
    // Over either cap the dispatch is a terminal drop: no send, no throw —
    // throwing would let the outbox retry the spam. `didSend` stays true so
    // the caller opens the incident, exactly as the cron does
    // (`addTriggersSent` runs even after a cap-suppressed send). Rolling the
    // evaluator's claim back instead would re-arm the alert on every fold
    // update for as long as the cap is exhausted. `capExhausted` carries what
    // actually happened for logs / telemetry.
    const capSlot = await deps.consumeEmailCapSlot({
      projectId: project.id,
      triggerId: trigger.id,
      now: new Date(),
      dedupKey: `${project.id}/${trigger.id}:digest:${input.fireDigest}`,
    });
    if (!capSlot.allowed) {
      logger.error(
        {
          triggerId: trigger.id,
          projectId: project.id,
          count: capSlot.count,
          cap: deps.emailHourlyCap,
        },
        "Custom-graph trigger exceeded its hourly email cap — dropping this dispatch",
      );
      return {
        channel: "email",
        didSend: true,
        capExhausted: "trigger-hourly",
        missingVariables: [],
        renderErrors: [],
      };
    }
    // ADR-031: per-PROJECT daily cap — the backstop ABOVE the per-trigger
    // hourly cap, run only once the hourly cap has passed and the surviving
    // recipient set is known. Counts RECIPIENTS (`allowedRecipients.length`),
    // the actual outbound email volume, not dispatches.
    const tenantSlot = await deps.consumeTenantEmailCapSlot({
      projectId: project.id,
      now: new Date(),
      cap: deps.tenantDailyCap,
      recipientCount: allowedRecipients.length,
      dedupKey: `${project.id}:tenant:${input.fireDigest}`,
    });
    if (!tenantSlot.allowed) {
      logger.warn(
        {
          triggerId: trigger.id,
          projectId: project.id,
          count: tenantSlot.count,
          cap: deps.tenantDailyCap,
        },
        "Project exceeded its daily trigger-email cap — dropping this " +
          "custom-graph dispatch. Backstop above the per-trigger hourly cap.",
      );
      return {
        channel: "email",
        didSend: true,
        capExhausted: "project-daily",
        missingVariables: [],
        renderErrors: [],
      };
    }
    const rendered = await renderTriggerEmail({
      subjectTemplate: trigger.emailSubjectTemplate,
      bodyTemplate: trigger.emailBodyTemplate,
      context,
      defaults,
    });
    if (rendered.errors.length > 0) {
      logger.warn(
        {
          triggerId: trigger.id,
          projectId: project.id,
          errors: rendered.errors,
        },
        "Graph-alert email render errors — fell back to default for affected parts",
      );
    }
    // The mailer sends one envelope per recipient and consults the gate for
    // each, so a retry after a partial failure resumes at the first recipient
    // the previous attempt never reached.
    await deps.sendEmail({
      triggerEmails: allowedRecipients,
      triggerId: trigger.id,
      projectId: project.id,
      subject: rendered.subject,
      html: rendered.html,
      isRecipientSent,
      recordRecipientSent,
    });
    // `didSend` stays true when the gate skipped everyone: the alert DID reach
    // its recipients — on the attempt that crashed before recording the
    // incident. The caller must open the incident on this retry, not treat the
    // fire as undelivered.
    return {
      channel: "email",
      didSend: true,
      missingVariables: rendered.missingVariables,
      renderErrors: rendered.errors,
    };
  }

  if (trigger.action === "SEND_SLACK_MESSAGE") {
    const templateType: SlackTemplateType | null =
      trigger.slackTemplateType === "block_kit" ? "block_kit" : "string";

    // Bot connection (ADR-041): post via the Web API with the gate open so the
    // alert's chart/table/alert blocks render.
    if (input.botDestination) {
      // A Slack channel is this fire's only "recipient" — gate it the same way
      // an email address is gated, or an outbox retry re-posts the alert.
      const botHash = destinationHash(`bot:${input.botDestination.channel}`);
      if (await isRecipientSent(botHash)) {
        logger.info(
          { triggerId: trigger.id, projectId: project.id },
          "Graph-alert Slack post already delivered for this fire — skipping re-post on retry",
        );
        return {
          channel: "slack",
          didSend: true,
          missingVariables: [],
          renderErrors: [],
        };
      }
      const rendered = await renderTriggerSlack({
        templateType,
        template: trigger.slackTemplate,
        context,
        defaults,
        allowGatedBlocks: true,
      });
      if (rendered.errors.length > 0) {
        logger.warn(
          {
            triggerId: trigger.id,
            projectId: project.id,
            errors: rendered.errors,
          },
          "Graph-alert Slack render errors — fell back to default",
        );
      }
      await deps.sendSlackBot({
        token: input.botDestination.token,
        channel: input.botDestination.channel,
        payload: rendered.payload,
        triggerName: trigger.name,
      });
      await recordRecipientSent(botHash);
      return {
        channel: "slack",
        didSend: true,
        missingVariables: rendered.missingVariables,
        renderErrors: rendered.errors,
      };
    }

    if (!slackWebhook) {
      logger.info(
        { triggerId: trigger.id, projectId: project.id },
        "Graph alert has no Slack webhook configured — skipping send",
      );
      return {
        channel: "slack",
        didSend: false,
        missingVariables: [],
        renderErrors: [],
      };
    }
    // Same at-most-once gate as the bot branch — the webhook URL is the
    // destination identity here.
    const webhookHash = destinationHash(slackWebhook);
    if (await isRecipientSent(webhookHash)) {
      logger.info(
        { triggerId: trigger.id, projectId: project.id },
        "Graph-alert Slack post already delivered for this fire — skipping re-post on retry",
      );
      return {
        channel: "slack",
        didSend: true,
        missingVariables: [],
        renderErrors: [],
      };
    }
    const rendered = await renderTriggerSlack({
      templateType,
      template: trigger.slackTemplate,
      context,
      defaults,
    });
    if (rendered.errors.length > 0) {
      logger.warn(
        {
          triggerId: trigger.id,
          projectId: project.id,
          errors: rendered.errors,
        },
        "Graph-alert Slack render errors — fell back to default",
      );
    }
    await deps.sendSlack({
      triggerWebhook: slackWebhook,
      triggerName: trigger.name,
      payload: rendered.payload,
    });
    await recordRecipientSent(webhookHash);
    return {
      channel: "slack",
      didSend: true,
      missingVariables: rendered.missingVariables,
      renderErrors: rendered.errors,
    };
  }

  if (trigger.action === "SEND_WEBHOOK") {
    // The whole webhook config, body template included, lives in
    // `actionParams` (ADR-040 §1) — no evaluator pre-extraction to thread.
    // Header values are stored as one ciphertext blob (ADR-040 §3),
    // decrypted just before the send below.
    const params = (trigger.actionParams ??
      {}) as Partial<WebhookStoredActionParams>;
    if (!params.url) {
      logger.info(
        { triggerId: trigger.id, projectId: project.id },
        "Graph alert has no webhook URL configured — skipping send",
      );
      return {
        channel: "webhook",
        didSend: false,
        missingVariables: [],
        renderErrors: [],
      };
    }
    // The endpoint URL is this fire's destination identity — gate it the same
    // way an email address or Slack channel is, or an outbox retry re-posts.
    const urlHash = destinationHash(`webhook:${params.url}`);
    if (await isRecipientSent(urlHash)) {
      logger.info(
        { triggerId: trigger.id, projectId: project.id },
        "Graph-alert webhook already delivered for this fire — skipping re-post on retry",
      );
      return {
        channel: "webhook",
        didSend: true,
        missingVariables: [],
        renderErrors: [],
      };
    }
    const rendered = await renderWebhookBody({
      template: params.bodyTemplate ?? null,
      context,
      defaultBody: defaults.webhookBody,
    });
    if (rendered.errors.length > 0) {
      logger.warn(
        {
          triggerId: trigger.id,
          projectId: project.id,
          errors: rendered.errors,
        },
        "Graph-alert webhook body render errors — fell back to default body",
      );
    }
    // Send + classify + log one attempt as a unit (ADR-040 §5/§6). A
    // non-2xx throws BEFORE the claim below, so a retryable failure is
    // actually retried; the delivery-log row is written either way.
    await deliverWebhook({
      send: deps.sendWebhook,
      recorder: deps.recordWebhookDelivery,
      projectId: project.id,
      triggerId: trigger.id,
      // The fire digest is this dispatch's stable identity — every outbox
      // retry of the same fire reuses it as the X-LangWatch-Event-Id so the
      // receiver dedupes (ADR-040 §5).
      eventId: `evt_${destinationHash(`event:${input.fireDigest}`)}`,
      url: params.url,
      method: params.method,
      headers: decryptWebhookHeaders(params),
      body: rendered.body,
      triggerName: trigger.name,
    });
    await recordRecipientSent(urlHash);
    return {
      channel: "webhook",
      didSend: true,
      missingVariables: rendered.missingVariables,
      renderErrors: rendered.errors,
    };
  }

  // Persist actions (ADD_TO_DATASET / ADD_TO_ANNOTATION_QUEUE) and any
  // future TriggerAction value never apply to graph alerts — the cron's
  // routing only ever dispatches notify channels here. Fail loud so a
  // misconfigured trigger dead-letters with an actionable operator signal
  // rather than silently no-op every fire (dispatch5015-002).
  logger.error(
    {
      triggerId: trigger.id,
      projectId: project.id,
      action: trigger.action,
    },
    "Graph alert action is not a notify channel — dead-lettering",
  );
  throw new DispatchError({
    message: `Graph alert action "${trigger.action}" is not supported — only SEND_EMAIL, SEND_SLACK_MESSAGE, and SEND_WEBHOOK apply to graph alerts.`,
    retryable: false,
  });
}
