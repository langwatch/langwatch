import type { AuthApi } from "@langwatch/auth-contract";

import type { AddressConfirmationMailChannel } from "./address-confirmation-mail.channel.ts";
import type { JoinRequestNotificationMailChannel } from "./join-request-notification-mail.channel.ts";
import type { OrganizationMfaRequirementMailChannel } from "./organization-mfa-requirement-mail.channel.ts";
import type { SignupAnnouncementChannel } from "./signup-announcement.channel.ts";
import type { SsoBreakGlassWarningChannel } from "./sso-break-glass-warning.channel.ts";
import type { SsoDomainProofFileChannel } from "./sso-domain-proof-file.channel.ts";
import type { SsoDomainProofMailChannel } from "./sso-domain-proof-mail.channel.ts";
import type { SsoDomainProofChannel } from "./sso-domain-proof.channel.ts";
import type { SsoIssuerDiscoveryChannel } from "./sso-issuer-discovery.channel.ts";

/** Every channel identity holds, auth's bound reads and commands among them (record §5). */
export interface IdentityChannels {
  /**
   * Auth's reads: the provider and the social methods it mounted (A1-b; the secrets and the SSO
   * licence stay in auth), the IdP origins it dials, and what its sessions and accounts say (A1-c).
   */
  readonly authReads: Pick<
    AuthApi,
    | "resolveAuthProvider"
    | "findMountedSocialMethodIds"
    | "findDialableIdentityProviderOrigins"
    | "findFederatedAccountProviders"
    | "countLegacySsoAccess"
    | "listBrowserSessions"
    | "findSessionAmr"
    | "findAssertedAmrForIdentifiers"
  >;
  /** Auth's commands whose doors stay identity's (D-IA2 B): the link, the revokes, the reset
   *  and the sweep. */
  readonly authCommands: Pick<
    AuthApi,
    | "linkProviderAccount"
    | "revokeAllBrowserSessions"
    | "endBrowserSessionsForIdentifier"
    | "disableTwoStepVerification"
    | "retireLegacySsoAccess"
  >;
  /** Absent where the deployment names no sign-ups Slack webhook. */
  readonly signupAnnouncements: SignupAnnouncementChannel | undefined;
  readonly addressConfirmationMail: AddressConfirmationMailChannel;
  readonly joinRequestMail: JoinRequestNotificationMailChannel;
  readonly organizationMfaMail: OrganizationMfaRequirementMailChannel;
  readonly ssoDomainProofMail: SsoDomainProofMailChannel;
  readonly ssoDomainProofs: SsoDomainProofChannel;
  readonly ssoDomainProofFiles: SsoDomainProofFileChannel;
  readonly ssoIssuerDiscovery: SsoIssuerDiscoveryChannel;
  readonly ssoBreakGlassWarnings: SsoBreakGlassWarningChannel;
}
