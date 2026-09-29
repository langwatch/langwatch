import type { SlackNoticeMessage } from "@langwatch/internal-slack";

import { SignupAnnouncementChannel } from "../signup-announcement.channel.ts";

/** Records what would have been posted to the sign-ups channel, without a network call. */
export class MemorySignupAnnouncementChannel extends SignupAnnouncementChannel {
  readonly posted: SlackNoticeMessage[] = [];

  private constructor() {
    super();
  }

  static create(): MemorySignupAnnouncementChannel {
    return new MemorySignupAnnouncementChannel();
  }

  async post(message: SlackNoticeMessage): Promise<void> {
    this.posted.push(message);
  }
}
