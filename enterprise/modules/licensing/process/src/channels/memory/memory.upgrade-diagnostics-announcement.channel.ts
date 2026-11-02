// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SlackNoticeMessage } from "@langwatch/internal-slack";

import { UpgradeDiagnosticsAnnouncementChannel } from "../upgrade-diagnostics-announcement.channel.ts";

/** Records every post; one composed to refuse throws instead. */
export class MemoryUpgradeDiagnosticsAnnouncementChannel extends UpgradeDiagnosticsAnnouncementChannel {
  readonly posts: SlackNoticeMessage[] = [];

  private constructor(private readonly refusal: Error | undefined) {
    super();
  }

  static create({ refuse }: { refuse?: Error } = {}): MemoryUpgradeDiagnosticsAnnouncementChannel {
    return new MemoryUpgradeDiagnosticsAnnouncementChannel(refuse);
  }

  async post(message: SlackNoticeMessage): Promise<void> {
    if (this.refusal) throw this.refusal;
    this.posts.push(message);
  }
}
