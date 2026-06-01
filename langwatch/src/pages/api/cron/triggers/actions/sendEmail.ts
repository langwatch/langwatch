import { TriggerAction } from "@prisma/client";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { captureException } from "~/utils/posthogErrorCapture";
import type { ActionParams, TriggerContext } from "../types";

export const handleSendEmail = async (context: TriggerContext) => {
  const { trigger, triggerData, projectSlug } = context;
  const actionParams = trigger.actionParams as unknown as ActionParams;

  try {
    const triggerInfo = {
      triggerEmails: actionParams.members ?? [],
      triggerData,
      triggerName: trigger.name,
      projectSlug,
      triggerType: trigger.alertType ?? null,
      triggerMessage: trigger.message ?? "",
    };

    await sendTriggerEmail(triggerInfo);
  } catch (error) {
    // Capture with action-specific context, then rethrow so the caller skips
    // recording the alert as sent. sendTriggerEmail now throws DispatchError
    // (see dispatch-error-contract.feature) — swallowing here would undo the
    // contract for the legacy customGraphTrigger path.
    captureException(error, {
      extra: {
        triggerId: trigger.id,
        projectId: trigger.projectId,
        action: TriggerAction.SEND_EMAIL,
      },
    });
    throw error;
  }
};
