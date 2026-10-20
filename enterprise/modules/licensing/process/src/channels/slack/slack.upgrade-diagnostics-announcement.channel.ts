// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SlackNoticeMessage } from "@langwatch/internal-slack";
import { fetch as undiciFetch } from "undici";

import { UpgradeDiagnosticsAnnouncementChannel } from "../upgrade-diagnostics-announcement.channel.ts";

const SLACK_TIMEOUT_MS = 10_000;

type Post = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/** Posts to the incoming webhook it was built with; the URL never leaves it. */
export class SlackUpgradeDiagnosticsAnnouncementChannel extends UpgradeDiagnosticsAnnouncementChannel {
  private constructor(
    private readonly webhookUrl: string,
    private readonly send: Post,
  ) {
    super();
  }

  static create({
    webhookUrl,
    send = undiciFetch,
  }: {
    webhookUrl: string;
    send?: Post;
  }): SlackUpgradeDiagnosticsAnnouncementChannel {
    return new SlackUpgradeDiagnosticsAnnouncementChannel(webhookUrl, send);
  }

  async post(message: SlackNoticeMessage): Promise<void> {
    const response = await this.send(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Slack refused the post with status ${response.status}`);
  }
}
