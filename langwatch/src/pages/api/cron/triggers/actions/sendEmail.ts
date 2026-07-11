import { TriggerAction } from "@prisma/client";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import {
  consumeEmailCapSlot,
  consumeTenantEmailCapSlot,
} from "~/server/event-sourcing/outbox/emailHourlyCap";
import { dispatchGraphAlertAction } from "~/server/event-sourcing/pipelines/shared/graphAlertActionDispatch";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { TriggerContext } from "../types";
import {
  buildCronGraphAlertInput,
  cronGraphAlertDeps,
} from "./graphAlertDispatch";

const logger = createLogger("langwatch:cron:triggers:sendEmail");

/**
 * Email a custom-graph alert from the cron path.
 *
 * The send itself goes through the shared `dispatchGraphAlertAction`, so the
 * cron renders the author's saved Liquid templates against `ALERT_TRIGGER_DEFAULTS`
 * — the very copy they previewed in the drawer — instead of the legacy React
 * email tree, which ignored the four template columns entirely.
 *
 * The email-only guards stay here, because Slack has no equivalent: the ADR-031
 * suppression list (sized here so the per-project cap can count recipients) and
 * the two hard caps.
 */
export const handleSendEmail = async (context: TriggerContext) => {
  const { trigger } = context;

  try {
    const input = buildCronGraphAlertInput(context);

    // ADR-031: the alert's unsubscribe footer must mean something — drop
    // recipients who used it before anything else runs. The dispatcher re-checks
    // (it is the single gate both paths share); this call is what sizes the
    // per-project cap below.
    const recipients = await getApp().emailSuppressions.filterSuppressed({
      projectId: trigger.projectId,
      triggerId: trigger.id,
      emails: input.recipients,
    });
    if (recipients.length === 0) {
      logger.info(
        { triggerId: trigger.id, projectId: trigger.projectId },
        "All custom-graph trigger email recipients are suppressed — skipping send",
      );
      return;
    }

    // `input.fireDigest` is the stable identity of THIS fire (see
    // `graphAlertFireDigest`): identical across cron re-ticks that have not yet
    // recorded the incident, distinct once the next incident opens. It backs
    // both cap claims — so a re-tick re-reads the count instead of burning a
    // second slot — and, inside the dispatcher, the per-recipient idempotency
    // keys.
    const capSlot = await consumeEmailCapSlot({
      projectId: trigger.projectId,
      triggerId: trigger.id,
      now: new Date(),
      cap: env.TRIGGER_EMAIL_HOURLY_CAP,
      dedupKey: `${trigger.projectId}/${trigger.id}:digest:${input.fireDigest}`,
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
    // send); the same fire digest makes the count idempotent across re-ticks.
    const tenantSlot = await consumeTenantEmailCapSlot({
      projectId: trigger.projectId,
      now: new Date(),
      cap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
      recipientCount: recipients.length,
      dedupKey: `${trigger.projectId}:tenant:${input.fireDigest}`,
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

    await dispatchGraphAlertAction({
      deps: cronGraphAlertDeps(),
      input: { ...input, recipients },
    });
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
