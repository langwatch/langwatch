// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SlackNoticeMessage } from "@langwatch/internal-slack";
import { IncomingWebhook } from "@slack/webhook";

import { ScimSyncSummaryChannel } from "../scim-sync-summary.channel.ts";

const SLACK_TIMEOUT_MS = 10_000;

type SlackWebhook = Pick<IncomingWebhook, "send">;

/** Posts to the incoming webhook it was built with; the URL never leaves it. */
export class SlackScimSyncSummaryChannel extends ScimSyncSummaryChannel {
  private constructor(private readonly webhook: SlackWebhook) {
    super();
  }

  static create({
    webhookUrl,
    createWebhook = (url) => new IncomingWebhook(url, { timeout: SLACK_TIMEOUT_MS }),
  }: {
    webhookUrl: string;
    createWebhook?: (url: string) => SlackWebhook;
  }): SlackScimSyncSummaryChannel {
    return new SlackScimSyncSummaryChannel(createWebhook(webhookUrl));
  }

  async post(message: SlackNoticeMessage): Promise<void> {
    await this.webhook.send(message);
  }
}
