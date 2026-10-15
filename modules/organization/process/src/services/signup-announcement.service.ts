import {
  newOrganizationNotice,
  newUserNotice,
  type SlackNoticeMessage,
} from "@langwatch/internal-slack";
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

/** Main's sign-up announcements: the organisation and join cards, to our own channel. */
export class SignupAnnouncementService {
  private constructor(private readonly deps: SignupAnnouncementDeps) {}

  static create(deps: SignupAnnouncementDeps): SignupAnnouncementService {
    return new SignupAnnouncementService(deps);
  }

  /** Onboarding created the organization: the new-organization card. */
  async announceNewOrganization(input: {
    userId: string;
    userName?: string | null;
    userEmail: string | null;
    organizationId: string;
    organizationName: string;
    phoneNumber?: string | undefined;
    signUpData?: Record<string, unknown> | undefined;
  }): Promise<void> {
    const campaign = input.signUpData?.["utmCampaign"];
    await this.#post(({ appUrl }) =>
      newOrganizationNotice.render({
        props: {
          userId: input.userId,
          userName: input.userName,
          userEmail: input.userEmail,
          organizationId: input.organizationId,
          organizationName: input.organizationName,
          phoneNumber: input.phoneNumber,
          utmCampaign: typeof campaign === "string" ? campaign : undefined,
          appUrl,
        },
        origin: this.#origin(appUrl),
      }),
    );
  }

  /** Somebody joined an organization that already existed: the join card. */
  async announceJoin(input: {
    userId: string;
    userName?: string | null;
    userEmail: string | null;
    organizationId: string;
    organizationName: string;
  }): Promise<void> {
    await this.#post(({ appUrl }) =>
      newUserNotice.render({
        props: { ...input, arrival: "invitation", appUrl },
        origin: this.#origin(appUrl),
      }),
    );
  }

  #origin(appUrl: string) {
    return { environment: new URL(appUrl).host, sentAt: nowInstant().epochMilliseconds };
  }

  async #post(render: (input: { appUrl: string }) => SlackNoticeMessage): Promise<void> {
    const { channel, publicBaseUrl, logger } = this.deps;
    if (!channel) {
      logger.warn("SLACK_CHANNEL_SIGNUPS is not configured; skipping signup notification");
      return;
    }
    await channel.post(render({ appUrl: publicBaseUrl ?? DEFAULT_APP_URL }));
  }
}
