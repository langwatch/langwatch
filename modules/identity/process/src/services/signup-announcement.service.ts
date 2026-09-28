import { newUserNotice } from "@langwatch/internal-slack";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { SignupAnnouncementChannel } from "../channels/signup-announcement.channel.ts";

const DEFAULT_APP_URL = "https://app.langwatch.ai";

type SignupAnnouncementDeps = Readonly<{
  /** Absent where SLACK_CHANNEL_SIGNUPS is unset: each sign-up is skipped with a warning. */
  channel: SignupAnnouncementChannel | undefined;
  publicBaseUrl: string | undefined;
  logger: Pick<Logger, "warn">;
}>;

/** Main's sign-up announcement: the new-user notice, posted to LangWatch's own sign-ups channel. */
export class SignupAnnouncementService {
  private constructor(private readonly deps: SignupAnnouncementDeps) {}

  static create(deps: SignupAnnouncementDeps): SignupAnnouncementService {
    return new SignupAnnouncementService(deps);
  }

  async announce(input: {
    userName: string;
    userEmail: string;
    organizationName: string;
  }): Promise<void> {
    const { channel, publicBaseUrl, logger } = this.deps;
    if (!channel) {
      logger.warn("SLACK_CHANNEL_SIGNUPS is not configured; skipping signup notification");
      return;
    }
    const origin = {
      environment: new URL(publicBaseUrl ?? DEFAULT_APP_URL).host,
      sentAt: nowInstant().epochMilliseconds,
    };
    await channel.post(newUserNotice.render({ props: input, origin }));
  }
}
