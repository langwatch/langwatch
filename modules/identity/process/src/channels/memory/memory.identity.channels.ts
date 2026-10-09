import { AuthApi } from "@langwatch/auth-contract";
import type { IdentityServerConfig } from "@langwatch/identity-contract";
import type { MailSender } from "@langwatch/mail";
import { NotificationService } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";

import type { IdentityChannels } from "../identity.channels.ts";
import { SesAddressConfirmationMailChannel } from "../ses/ses.address-confirmation-mail.channel.ts";
import { SesJoinRequestNotificationMailChannel } from "../ses/ses.join-request-notification-mail.channel.ts";
import { SesOrganizationMfaRequirementMailChannel } from "../ses/ses.organization-mfa-requirement-mail.channel.ts";
import { SesSsoDomainProofMailChannel } from "../ses/ses.sso-domain-proof-mail.channel.ts";
import { MemorySignupAnnouncementChannel } from "./memory.signup-announcement.channel.ts";
import { MemorySsoBreakGlassWarningChannel } from "./memory.sso-break-glass-warning.channel.ts";
import { MemorySsoDomainProofFileChannel } from "./memory.sso-domain-proof-file.channel.ts";
import { MemorySsoDomainProofChannel } from "./memory.sso-domain-proof.channel.ts";
import { MemorySsoIssuerDiscoveryChannel } from "./memory.sso-issuer-discovery.channel.ts";

/** Proofs, discovery and announcements in-process; mail goes to notification, a peer here too. */
export class MemoryIdentityChannels {
  static readonly requires = [] as const;
  static readonly binds = {
    authReads: AuthApi,
    authCommands: AuthApi,
    notifications: NotificationService,
  } as const;

  static create({
    config,
    bound,
  }: {
    config: IdentityServerConfig;
    bound: BoundApis<typeof MemoryIdentityChannels.binds>;
  }): IdentityChannels {
    const mailer: MailSender = { send: (content) => bound.notifications.sendEmail(content) };
    const baseUrl = config.publicBaseUrl ?? "";
    return {
      authReads: bound.authReads,
      authCommands: bound.authCommands,
      signupAnnouncements: MemorySignupAnnouncementChannel.create(),
      addressConfirmationMail: SesAddressConfirmationMailChannel.create({ mailer, baseUrl }),
      joinRequestMail: SesJoinRequestNotificationMailChannel.create({ mailer, baseUrl }),
      organizationMfaMail: SesOrganizationMfaRequirementMailChannel.create({ mailer }),
      ssoDomainProofMail: SesSsoDomainProofMailChannel.create({ mailer, baseUrl }),
      ssoDomainProofs: MemorySsoDomainProofChannel.create(),
      ssoDomainProofFiles: MemorySsoDomainProofFileChannel.create(),
      ssoIssuerDiscovery: MemorySsoIssuerDiscoveryChannel.create(),
      ssoBreakGlassWarnings: MemorySsoBreakGlassWarningChannel.create(),
    };
  }
}
