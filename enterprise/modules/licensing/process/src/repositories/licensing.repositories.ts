import type { ActivationCodeRepository } from "./activation-code.repository.ts";
import type { ConnectOrganizationRepository } from "./connect-organization.repository.ts";
import type { InstanceIdentityRepository } from "./instance-identity.repository.ts";
import type { IssuedLicenseRepository } from "./issued-license.repository.ts";
import type { LicensingRateLimitRepository } from "./licensing-rate-limit.repository.ts";
import type { MemberSeatRepository } from "./member-seat.repository.ts";
import type { OrganizationLicenseRepository } from "./organization-license.repository.ts";
import type { SelfHostedInstanceRepository } from "./self-hosted-instance.repository.ts";
import type { SignInProviderMountRepository } from "./sign-in-provider-mount.repository.ts";

/**
 * The stores this module owns. Chosen once, at boot, by the registry beside
 * this file; nothing below the app names a backend.
 */
export interface LicensingRepositories {
  readonly organizationLicenses: OrganizationLicenseRepository;
  readonly issuedLicenses: IssuedLicenseRepository;
  readonly activationCodes: ActivationCodeRepository;
  readonly selfHostedInstances: SelfHostedInstanceRepository;
  readonly connectOrganizations: ConnectOrganizationRepository;
  readonly instanceIdentity: InstanceIdentityRepository;
  readonly rateLimits: LicensingRateLimitRepository;
  /** sso's sign-in provider fact, applied by licensing's peer subscriber (ADR-179). */
  readonly signInProviderMounts: SignInProviderMountRepository;
  /** Read through organization's shares, never OrganizationApi (R-C1f, Q9). */
  readonly memberSeats: MemberSeatRepository;
}
