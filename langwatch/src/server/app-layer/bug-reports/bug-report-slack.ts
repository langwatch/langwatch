import type { BugReport } from "@prisma/client";
import { env } from "~/env.mjs";
import { postSlackChatMessage } from "../automations/delivery/slackWebApi";

/**
 * Team alert for a new bug report. Active only where the bot token is
 * configured (production); silently a no-op everywhere else so intake never
 * depends on Slack being reachable or configured.
 */
export async function notifyBugReportOnSlack({
  report,
}: {
  report: BugReport;
}): Promise<void> {
  const token = env.SLACK_BUG_REPORTS_BOT_TOKEN;
  if (!token) return;
  const channel = env.SLACK_BUG_REPORTS_CHANNEL ?? "#dev";

  const base = (env.BASE_HOST ?? "https://app.langwatch.ai").replace(
    /\/+$/,
    "",
  );
  const adminUrl = `${base}/ops/backoffice/bug-reports?report=${report.id}`;

  const summaryExcerpt = (report.summary ?? "").trim().slice(0, 600);
  const facts = [
    `*Kind:* ${report.kind}`,
    `*Source:* ${report.source}`,
    report.agent ? `*Agent:* ${report.agent}` : null,
    report.cliVersion ? `*CLI:* ${report.cliVersion}` : null,
    `*Project:* ${report.linkedProjectId ?? "not linked"}`,
    report.contactEmail ? `*Contact:* ${report.contactEmail}` : null,
  ]
    .filter(Boolean)
    .join("  •  ");

  await postSlackChatMessage({
    token,
    channel,
    payload: {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `📮 New bug report: ${report.title}`.slice(0, 150),
            emoji: true,
          },
        },
        { type: "section", text: { type: "mrkdwn", text: facts } },
        ...(summaryExcerpt.length > 0
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `>${summaryExcerpt.replaceAll("\n", "\n>")}`,
                },
              },
            ]
          : []),
        {
          type: "section",
          text: { type: "mrkdwn", text: `<${adminUrl}|Open in backoffice>` },
        },
      ],
    },
    triggerName: "agent-report",
  });
}
