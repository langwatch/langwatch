import { opsSecrets, type OpsServerConfig } from "@langwatch/ops-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import type { OpsChannels } from "../ops.channels.ts";
import { SlackBugReportNotifierChannel } from "../slack/slack.bug-report-notifier.channel.ts";
import { HttpCheckupProbeChannel } from "./http.checkup-probe.channel.ts";
import { HttpSlackAlertChannel } from "./http.slack-alert.channel.ts";
import { HttpUsageReportChannel } from "./http.usage-report.channel.ts";

/** The usage report, probes and bug-report alert go over HTTP to hosts ops does not own. */
export class HttpOpsChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: OpsServerConfig;
    secrets: ScopedSecrets;
  }): Promise<OpsChannels> {
    const bugReportNotifier = await secrets.into(opsSecrets.slackBugReportsBotToken, (botToken) =>
      SlackBugReportNotifierChannel.create({
        transport: HttpSlackAlertChannel.create(),
        config: {
          botToken,
          channel: config.bugReportSlackChannel,
          baseHost: config.publicBaseUrl,
        },
      }),
    );
    return {
      usageReport: HttpUsageReportChannel.create(),
      probes: HttpCheckupProbeChannel.create(),
      bugReportNotifier,
    };
  }
}
