import { newUserNotice } from "@langwatch/internal-slack";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { SignupAnnouncementChannel } from "../../../channels/signup-announcement.channel.ts";

const DEFAULT_APP_URL = "https://app.langwatch.ai";

type SignupAnnouncementDeps = Readonly<{
  /** Absent where SLACK_CHANNEL_SIGNUPS is unset: each sign-up is skipped with a warning. */
  channel: SignupAnnouncementChannel | undefined;
  publicBaseUrl: string | undefined;
  logger: Pick<Logger, "warn">;
}>;

/** Main's join announcement: the new-user card, posted to LangWatch's own sign-ups channel. */
export class SignupAnnouncementService {
  private constructor(private readonly deps: SignupAnnouncementDeps) {}

  static create(deps: SignupAnnouncementDeps): SignupAnnouncementService {
    return new SignupAnnouncementService(deps);
  }

  async announceJoin(input: {
    userId: string;
    userName: string;
    userEmail: string;
    organizationId: string;
    organizationName: string;
  }): Promise<void> {
    const { channel, publicBaseUrl, logger } = this.deps;
    if (!channel) {
      logger.warn("SLACK_CHANNEL_SIGNUPS is not configured; skipping signup notification");
      return;
    }
    const appUrl = publicBaseUrl ?? DEFAULT_APP_URL;
    const origin = { environment: new URL(appUrl).host, sentAt: nowInstant().epochMilliseconds };
    await channel.post(
      newUserNotice.render({ props: { ...input, arrival: "sso", appUrl }, origin }),
    );
  }
}
