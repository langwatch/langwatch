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
    captureException(error, {
      extra: {
        triggerId: trigger.id,
        projectId: trigger.projectId,
        action: TriggerAction.SEND_EMAIL,
      },
    });
  }
};
