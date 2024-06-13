import { IncomingWebhook } from "@slack/webhook";
import * as Sentry from "../../../node_modules/@sentry/nextjs";
import { env } from "../../env.mjs";

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
}: {
  triggerWebhook: string;
  triggerData: TriggerData[];
  triggerName: string;
  projectSlug: string;
}) => {
  const webhook = new IncomingWebhook(triggerWebhook);

  const traceIds = triggerData
    .map((data) => {
      return { traceId: data.traceId, input: data.input, output: data.output };
    })
    .slice(0, 10);

  const traceLinks = traceIds.map((trace) => {
    return `\n<${env.NEXTAUTH_URL}/${projectSlug}/messages/${trace.traceId}|${trace.traceId}>
    \n*Input:* ${trace.input}
    \n*Output:* ${trace.output}'\n`;
  });

  try {
    await webhook.send({
      text: `🔔 LangWatch Trigger - *${triggerName}*\n\n${traceLinks.join("")}
      \n\n To stop further notifications, please de-activate or delete your trigger <${
        env.NEXTAUTH_URL
      }/settings/triggers|here>`,
      username: "LangWatch",
      icon_emoji: ":robot_face:",
    });
  } catch (err) {
    Sentry.captureException(err);
  }
};
