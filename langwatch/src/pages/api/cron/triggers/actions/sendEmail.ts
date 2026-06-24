import { TriggerAction } from "@prisma/client";
import { createHash } from "crypto";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import {
  consumeEmailCapSlot,
  consumeTenantEmailCapSlot,
} from "~/server/event-sourcing/outbox/emailHourlyCap";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { ActionParams, TriggerContext } from "../types";

const logger = createLogger("langwatch:cron:triggers:sendEmail");

export const handleSendEmail = async (context: TriggerContext) => {
  const { trigger, triggerData, projectSlug } = context;
  const actionParams = trigger.actionParams as unknown as ActionParams;

  try {
    // ADR-031: the custom-graph cron path renders the same unsubscribe footer
    // as the outbox path, so it must honour the same suppression list and
    // hourly cap — otherwise those footers' links would be dead.
    const recipients = await getApp().emailSuppressions.filterSuppressed({
      projectId: trigger.projectId,
      triggerId: trigger.id,
      emails: actionParams.members ?? [],
    });
    if (recipients.length === 0) {
      logger.info(
        { triggerId: trigger.id, projectId: trigger.projectId },
        "All custom-graph trigger email recipients are suppressed — skipping send",
      );
      return;
    }

    // Stable per-dispatch digest over this run's trace/graph ids — identical
    // across cron ticks for the same matched set, distinct across runs. Backs
    // both the cap claim (so a re-tick doesn't burn a second slot) and the
    // per-recipient idempotency key prefix (ADR-031), mirroring the outbox
    // dispatcher's `dispatchDigest`.
    const dispatchDigest = createHash("sha256")
      .update(
        triggerData
          .map((d) => d.traceId ?? d.graphId ?? "")
          .sort()
          .join(","),
      )
      .digest("hex")
      .slice(0, 16);

    const capSlot = await consumeEmailCapSlot({
      projectId: trigger.projectId,
      triggerId: trigger.id,
      now: new Date(),
      cap: env.TRIGGER_EMAIL_HOURLY_CAP,
      dedupKey: `${trigger.projectId}/${trigger.id}:digest:${dispatchDigest}`,
    });
    if (!capSlot.allowed) {
      logger.error(
        {
          triggerId: trigger.id,
          projectId: trigger.projectId,
          count: capSlot.count,
          cap: env.TRIGGER_EMAIL_HOURLY_CAP,
        },
        "Custom-graph trigger exceeded its hourly email cap — dropping this dispatch",
      );
      return;
    }

    // ADR-031: per-PROJECT daily cap — a backstop ABOVE the per-trigger hourly
    // cap, run only once the hourly cap has passed and the recipient set is
    // known. Counts RECIPIENTS (`recipients.length`), the actual outbound email
    // volume, not dispatches. Over the cap this dispatch is dropped (WARN, no
    // send); the same `dispatchDigest`-derived dedupKey makes the count
    // idempotent across cron re-ticks.
    const tenantSlot = await consumeTenantEmailCapSlot({
      projectId: trigger.projectId,
      now: new Date(),
      cap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
      recipientCount: recipients.length,
      dedupKey: `${trigger.projectId}:tenant:${dispatchDigest}`,
    });
    if (!tenantSlot.allowed) {
      logger.warn(
        {
          triggerId: trigger.id,
          projectId: trigger.projectId,
          count: tenantSlot.count,
          cap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
        },
        "Project exceeded its daily trigger-email cap — dropping this " +
          "custom-graph dispatch. Backstop above the per-trigger hourly cap.",
      );
      return;
    }

    // Per-recipient idempotency (ADR-031): back the mailer's recipient gate
    // with the same TriggerSent claim store the outbox path uses, reachable
    // here via `getApp().triggers` (no new cross-module exports). A mid-loop
    // failure means the next cron tick skips recipients already delivered
    // instead of re-sending to them. Key shape matches the outbox dispatcher:
    // `rcpt:{dispatchDigest}:{recipientHash}` in the traceId field.
    const recipientClaimKey = (recipientHash: string) =>
      `rcpt:${dispatchDigest}:${recipientHash}`;
    const isRecipientSent = (recipientHash: string) =>
      getApp().triggers.isSendClaimed({
        triggerId: trigger.id,
        traceId: recipientClaimKey(recipientHash),
        projectId: trigger.projectId,
      });
    const recordRecipientSent = async (recipientHash: string) => {
      await getApp().triggers.claimSend({
        triggerId: trigger.id,
        traceId: recipientClaimKey(recipientHash),
        projectId: trigger.projectId,
      });
    };

    const triggerInfo = {
      triggerEmails: recipients,
      triggerData,
      triggerName: trigger.name,
      triggerId: trigger.id,
      projectId: trigger.projectId,
      projectSlug,
      triggerType: trigger.alertType ?? null,
      triggerMessage: trigger.message ?? "",
      isRecipientSent,
      recordRecipientSent,
    };

    await sendTriggerEmail(triggerInfo);
  } catch (error) {
    captureException(toError(error), {
      extra: {
        triggerId: trigger.id,
        projectId: trigger.projectId,
        action: TriggerAction.SEND_EMAIL,
      },
    });
  }
};
