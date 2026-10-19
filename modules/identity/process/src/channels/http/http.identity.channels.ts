import { AuthApi } from "@langwatch/auth-contract";
import type { IdentityServerConfig } from "@langwatch/identity-contract";
import type { MailSender } from "@langwatch/mail";
import { NotificationService } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";
import { internalSlackSignupsWebhook, type ScopedSecrets } from "@langwatch/secrets";

import { DnsSsoDomainProofChannel } from "../dns.sso-domain-proof.channel.ts";
import type { IdentityChannels } from "../identity.channels.ts";
import { SesAddressConfirmationMailChannel } from "../ses/ses.address-confirmation-mail.channel.ts";
import { SesJoinRequestNotificationMailChannel } from "../ses/ses.join-request-notification-mail.channel.ts";
import { SesOrganizationMfaRequirementMailChannel } from "../ses/ses.organization-mfa-requirement-mail.channel.ts";
import { SesSsoDomainProofMailChannel } from "../ses/ses.sso-domain-proof-mail.channel.ts";
import { SlackSignupAnnouncementChannel } from "../slack/slack.signup-announcement.channel.ts";
import { LoggedSsoBreakGlassWarningChannel } from "../sso-break-glass-warning.channel.ts";
import { SSO_DOMAIN_PROOF_PUBLIC_EGRESS } from "../sso-domain-proof-file.channel.ts";
import { HttpsSsoDomainProofFileChannel } from "./http.sso-domain-proof-file.channel.ts";
import { HttpsSsoIssuerDiscoveryChannel } from "./http.sso-issuer-discovery.channel.ts";

/**
 * Auth bound for its reads and commands (a binding is no peer: round 34, round 48 A1-b/A1-c),
 * mail through notification, proofs and discovery behind the public egress fence.
 */
export class HttpIdentityChannels {
  static readonly requires = [] as const;
  static readonly binds = {
    authReads: AuthApi,
    authCommands: AuthApi,
    notifications: NotificationService,
  } as const;

  static async create({
    config,
    secrets,
    bound,
  }: {
    config: IdentityServerConfig;
    secrets: ScopedSecrets;
    bound: BoundApis<typeof HttpIdentityChannels.binds>;
  }): Promise<IdentityChannels> {
    const mailer: MailSender = { send: (content) => bound.notifications.sendEmail(content) };
    const baseUrl = config.publicBaseUrl ?? "";
    const signupAnnouncements = await secrets.into(internalSlackSignupsWebhook, (webhookUrl) =>
      webhookUrl ? SlackSignupAnnouncementChannel.create({ webhookUrl }) : undefined,
    );
    return {
      authReads: bound.authReads,
      authCommands: bound.authCommands,
      signupAnnouncements,
      addressConfirmationMail: SesAddressConfirmationMailChannel.create({ mailer, baseUrl }),
      joinRequestMail: SesJoinRequestNotificationMailChannel.create({ mailer, baseUrl }),
      organizationMfaMail: SesOrganizationMfaRequirementMailChannel.create({ mailer }),
      ssoDomainProofMail: SesSsoDomainProofMailChannel.create({ mailer, baseUrl }),
      ssoDomainProofs: DnsSsoDomainProofChannel.create({
        nameservers: config.ssoDomainProofDnsServers,
      }),
      ssoDomainProofFiles: HttpsSsoDomainProofFileChannel.create({
        policy: SSO_DOMAIN_PROOF_PUBLIC_EGRESS,
      }),
      // Auth owns the operator's IdP allowlist; asked per discovery, not at boot.
      ssoIssuerDiscovery: HttpsSsoIssuerDiscoveryChannel.create({
        policy: SSO_DOMAIN_PROOF_PUBLIC_EGRESS,
        dialableInternalOrigins: () => bound.authReads.findDialableIdentityProviderOrigins(),
      }),
      ssoBreakGlassWarnings: LoggedSsoBreakGlassWarningChannel.create(),
    };
  }
}
