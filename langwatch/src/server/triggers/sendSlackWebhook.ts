import { IncomingWebhook } from "@slack/webhook";
import * as Sentry from "../../../node_modules/@sentry/nextjs";
import { env } from "../../env.mjs";
import { type AlertType, AlertType as AlertTypeEnum } from "@prisma/client";
import { type Trace } from "~/server/tracer/types";

interface TriggerData {
  traceId: string;
  input: string;
  output: string;
  fullTrace: Trace;
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
  triggerType: AlertType | null;
  triggerMessage: string;
}) => {
  const webhook = new IncomingWebhook(triggerWebhook);

  const traceIds = triggerData
    .map((data) => {
      return {
        traceId: data.traceId,
        input: data.input,
        output: data.output,
        events: data.fullTrace?.events ?? [],
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
      ${(trace.events ?? [])
        .map((event: any) => {
          return `\n*Event Type:* ${event.event_type}
          ${Object.entries(event.metrics || {})
            .map(([key, value]) => `\n*${key}:* ${value as string}`)
            .join("")}
          ${Object.entries(event.event_details || {})
            .map(([key, value]) => `\n*${key}:* ${value as string}`)
            .join("")}
          \n-------------------`;
        })
        .join("")}
     `;
  });

  const alertIcon = (alertType: AlertType | null) => {
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
      \n${traceLinks.join("")}`,
      username: "LangWatch",
      icon_emoji: ":robot_face:",
    });
  } catch (err) {
    Sentry.captureException(err);
  }
};
