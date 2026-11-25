// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SlackNoticeMessage } from "@langwatch/internal-slack";

import { ScimSyncSummaryChannel } from "../scim-sync-summary.channel.ts";

/** Records what would have been posted to the sign-ups channel, without a network call. */
export class MemoryScimSyncSummaryChannel extends ScimSyncSummaryChannel {
  readonly posted: SlackNoticeMessage[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryScimSyncSummaryChannel {
    return new MemoryScimSyncSummaryChannel();
  }

  async post(message: SlackNoticeMessage): Promise<void> {
    this.posted.push(message);
  }
}
