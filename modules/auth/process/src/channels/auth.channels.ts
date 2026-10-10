import type { Auth0PasswordChannel } from "./auth0-password.channel.ts";
import type { CliDeviceSettlementChannel } from "./cli-device-settlement.channel.ts";
import type { PasswordResetMailChannel } from "./password-reset-mail.channel.ts";
import type { SignUpVerificationMailChannel } from "./sign-up-verification-mail.channel.ts";
import type { SignupAnnouncementChannel } from "./signup-announcement.channel.ts";

/** Every channel auth holds; sign-up announcements are absent without the Slack webhook. */
export interface AuthChannels {
  readonly cliSettlements: CliDeviceSettlementChannel;
  readonly signupAnnouncements: SignupAnnouncementChannel | undefined;
  readonly passwordResetMail: PasswordResetMailChannel;
  readonly signUpVerificationMail: SignUpVerificationMailChannel;
  readonly auth0Passwords: Auth0PasswordChannel;
}
