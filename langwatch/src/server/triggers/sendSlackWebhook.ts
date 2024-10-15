import { IncomingWebhook } from "@slack/webhook";
import * as Sentry from "../../../node_modules/@sentry/nextjs";
import { env } from "../../env.mjs";
import { type AlertType, AlertType as AlertTypeEnum } from "@prisma/client";

interface TriggerData {
  traceId: string;
  input: string;
  output: string;
}

export const sendSlackWebhook = async ({
  triggerWebhook,
  triggerData,
  triggerName,
  projectSlug,
  triggerType,
  triggerMessage,
}: {
  triggerWebhook: string;
  triggerData: TriggerData[];
  triggerName: string;
  projectSlug: string;
  triggerType: AlertType;
  triggerMessage: string;
}) => {
  const webhook = new IncomingWebhook(triggerWebhook);

  const traceIds = triggerData
    .map((data) => {
      return {
        traceId: data.traceId,
        input: data.input,
        output: data.output,
      };
    })
    .slice(0, 10);

  const traceLinks = traceIds.map((trace) => {
    return `\n<${env.BASE_HOST}/${projectSlug}/messages/${trace.traceId}|${
      trace.traceId
    }>
    ${
      !triggerMessage
        ? ` \n*Input:* ${trace.input}
    \n*Output:* ${trace.output}'\n`
        : ""
    }
    `;
  });

  const alertIcon = (alertType: AlertType) => {
    switch (alertType) {
      case AlertTypeEnum.INFO:
        return ":information_source:";
      case AlertTypeEnum.WARNING:
        return ":warning:";
      case AlertTypeEnum.CRITICAL:
        return ":red_circle:";
      default:
        return ":bell:";
    }
  };

  try {
    await webhook.send({
      text: `${alertIcon(triggerType)} LangWatch Trigger - *${triggerName}* 
       ${triggerMessage ? `\n\n*Msg:* ${triggerMessage}` : ""}
      \n${traceLinks.join("")}
      \nTo stop further notifications, please de-activate or delete your trigger <${
        env.BASE_HOST
      }/settings/triggers|here>`,
      username: "LangWatch",
      icon_emoji: ":robot_face:",
    });
  } catch (err) {
    Sentry.captureException(err);
  }
};
