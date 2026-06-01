import { TriggerAction } from "@prisma/client";
import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";
import { captureException } from "~/utils/posthogErrorCapture";
import type { ActionParams, TriggerContext } from "../types";

export const handleSendSlackMessage = async (context: TriggerContext) => {
  const { trigger, triggerData, projectSlug } = context;
  const actionParams = trigger.actionParams as unknown as ActionParams;

  try {
    const triggerInfo = {
      triggerWebhook: actionParams.slackWebhook ?? "",
      triggerData,
      triggerName: trigger.name,
      projectSlug,
      triggerType: trigger.alertType ?? null,
      triggerMessage: trigger.message ?? "",
    };

    await sendSlackWebhook(triggerInfo);
  } catch (error) {
    // Capture with action-specific context, then rethrow so the caller skips
    // recording the alert as sent. sendSlackWebhook now throws DispatchError
    // (see dispatch-error-contract.feature) — swallowing here would undo the
    // contract for the legacy customGraphTrigger path.
    captureException(error, {
      extra: {
        triggerId: trigger.id,
        projectId: trigger.projectId,
        action: TriggerAction.SEND_SLACK_MESSAGE,
      },
    });
    throw error;
  }
};
