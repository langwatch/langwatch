import type { SlackNoticeMessage } from "@langwatch/internal-slack";

/** LangWatch's own sign-ups Slack channel; never a Slack a customer configured. */
export abstract class SignupAnnouncementChannel {
  abstract post(message: SlackNoticeMessage): Promise<void>;
}
