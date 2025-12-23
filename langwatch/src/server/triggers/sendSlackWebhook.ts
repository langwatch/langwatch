import { type AlertType, AlertType as AlertTypeEnum } from "@prisma/client";
import { IncomingWebhook } from "@slack/webhook";
import type { Trace } from "~/server/tracer/types";
import { env } from "../../env.mjs";
import { captureException } from "../../utils/posthogErrorCapture";

interface TriggerData {
  traceId?: string;
  graphId?: string;
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
        graphId: data.graphId,
        input: data.input,
        output: data.output,
        events: data.fullTrace?.events ?? [],
      };
    })
    .slice(0, 10);

  const getLink = (data: { traceId?: string; graphId?: string }) => {
    // Check if this is a custom graph trigger
    if (data.graphId) {
      return `${env.BASE_HOST}/${projectSlug}/analytics/custom/${data.graphId}`;
    }
    // Regular trace link
    if (data.traceId) {
      return `${env.BASE_HOST}/${projectSlug}/messages/${data.traceId}`;
    }
    return "#";
  };

  const getDisplayText = (data: { traceId?: string; graphId?: string }) => {
    // For custom graphs, show a more user-friendly text
    if (data.graphId) {
      return "View Graph";
    }
    return data.traceId ?? "View";
  };

  const traceLinks = traceIds.map((trace) => {
    const isCustomGraph = !!trace.graphId;
    
    return `\n<${getLink(trace)}|${getDisplayText(trace)}>
    ${
      !triggerMessage && !isCustomGraph
        ? ` \n*Input:* ${trace.input}
    \n*Output:* ${trace.output}'\n`
        : ""
    }
      ${!isCustomGraph && (trace.events ?? [])
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
    captureException(err);
  }
};
