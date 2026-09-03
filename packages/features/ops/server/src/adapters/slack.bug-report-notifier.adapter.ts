import type { BugReport } from "@langwatch/prisma-client/generated";
import { BugReportNotifierPort } from "../ports/bug-report-intake.ports";

/**
 * Posts one Block Kit message. The deployment binds its own Slack Web API
 * client here; ops owns what the alert says.
 */
export interface OpsSlackAlertTransport {
  post(input: {
    token: string;
    channel: string;
    payload: { blocks: unknown[] };
    triggerName: string;
  }): Promise<void>;
}

export interface SlackBugReportNotifierConfig {
  /** Bot token. Blank or absent makes the notifier a no-op. */
  botToken?: string | undefined;
  /** Destination channel; defaults to `#dev` the way the application did. */
  channel?: string | undefined;
  /** Public application origin the backoffice deep link is built from. */
  baseHost?: string | undefined;
}

const DEFAULT_CHANNEL = "#dev";
const DEFAULT_BASE_HOST = "https://app.langwatch.ai";

/**
 * Team alert for a new bug report. Active only where the bot token is
 * configured (production); silently a no-op everywhere else so intake never
 * depends on Slack being reachable or configured.
 */
export class SlackBugReportNotifierAdapter extends BugReportNotifierPort {
  private constructor(
    private readonly transport: OpsSlackAlertTransport,
    private readonly config: SlackBugReportNotifierConfig,
  ) {
    super();
  }

  static create(input: {
    transport: OpsSlackAlertTransport;
    config: SlackBugReportNotifierConfig;
  }): SlackBugReportNotifierAdapter {
    return new SlackBugReportNotifierAdapter(input.transport, input.config);
  }

  async notify({ report }: { report: BugReport }): Promise<void> {
    const token = this.config.botToken;
    if (!token) return;
    const channel = this.config.channel ?? DEFAULT_CHANNEL;

    const base = (this.config.baseHost ?? DEFAULT_BASE_HOST).replace(/\/+$/, "");
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
      .join("  \u2022  ");

    await this.transport.post({
      token,
      channel,
      payload: {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `\ud83d\udcee New bug report: ${report.title}`.slice(0, 150),
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
}
