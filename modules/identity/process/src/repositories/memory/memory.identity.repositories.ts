import type { IdentityFoldState } from "../../eventing/identity-state.projection.ts";
import type { JoinRequestFoldState } from "../../eventing/join-request-state.projection.ts";
import type { MfaFoldState } from "../../eventing/mfa-enrollment-state.projection.ts";
import type { SsoConnectionFoldState } from "../../eventing/sso-connection-state.projection.ts";
import type { IdentityRepositories } from "../identity.repositories.ts";
import { MemoryIdentityHistoryRepository } from "./memory.identity-history.repository.ts";
import { MemoryIdentityLatchRepository } from "./memory.identity-latch.repository.ts";
import { MemoryIdentityLookupRepository } from "./memory.identity-lookup.repository.ts";
import { MemoryIdentitySecretCarryRepository } from "./memory.identity-secret-carry.repository.ts";
import { MemoryIdentitySignInAccountsRepository } from "./memory.identity-signin-accounts.repository.ts";
import {
  MemoryIdentityBackfillRepository,
  MemoryIdentityHeadsRepository,
  MemoryIdentityNewbornRepository,
  MemoryIdentityReservationRepository,
  MemoryIdentityUsersRepository,
  MemoryIdentityVerificationRepository,
} from "./memory.identity-user.repositories.ts";
import { MemoryIdentityStore } from "./memory.identity.store.ts";
import { MemoryJoinRequestAudienceRepository } from "./memory.join-request-audience.repository.ts";
import { MemoryJoinRequestNotificationContextRepository } from "./memory.join-request-notification-context.repository.ts";
import {
  MemoryJoinCandidateRepository,
  MemoryJoinRequestReadRepository,
} from "./memory.join-request.repositories.ts";
import { MemoryMfaEnrollmentRepository } from "./memory.mfa-enrollment.repository.ts";
import { MemoryScimSyncProjectionRepository } from "./memory.scim-sync-projection.repository.ts";
import { MemorySsoBreakGlassRepository } from "./memory.sso-break-glass.repository.ts";
import { MemorySsoConnectionRegistrationRepository } from "./memory.sso-connection-registration.repository.ts";
import {
  MemorySsoConnectionBackofficeRepository,
  MemorySsoConnectionReadRepository,
  MemorySsoConnectionStrandingRepository,
} from "./memory.sso-connection.repositories.ts";
import { MemorySsoCredentialRepository } from "./memory.sso-credential.repository.ts";
import { MemorySsoDomainOwnershipRepository } from "./memory.sso-domain-ownership.repository.ts";
import { MemorySsoDomainReproofTargetRepository } from "./memory.sso-domain-reproof.repository.ts";
import { MemorySsoEngineProviderRepository } from "./memory.sso-engine-provider.repository.ts";
import { MemorySsoMigrationEvidenceRepository } from "./memory.sso-migration-evidence.repository.ts";
import { MemorySsoPlatformOperatorsRepository } from "./memory.sso-platform-operators.repository.ts";
import { MemorySsoRegistrantReadRepository } from "./memory.sso-registrant.repository.ts";
import { MemoryStateProjectionRepository } from "./memory.state-projection.repository.ts";
import { MemoryTwoStepVerificationRepository } from "./memory.two-step-verification.repository.ts";

/**
 * The "memory" tier: every identity repository the app is tested without a
 * database. One store behind all twelve rows, the way one Postgres
 * connection sits behind the Prisma tier.
 */
export class MemoryIdentityRepositories {
  static readonly requires = ["adminEmails"] as const;

  static create(members: Readonly<{ adminEmails: readonly string[] }>): IdentityRepositories {
    return identityRepositoriesOverMemory(MemoryIdentityStore.create(), members.adminEmails);
  }
}

/** The same tier over a store the caller keeps, for tests that seed rows. */
export function identityRepositoriesOverMemory(
  store: MemoryIdentityStore,
  adminEmails: readonly string[] = [],
): IdentityRepositories {
  return {
    heads: MemoryIdentityHeadsRepository.create(store),
    latch: MemoryIdentityLatchRepository.create(store),
    users: MemoryIdentityUsersRepository.create(store),
    signInAccounts: MemoryIdentitySignInAccountsRepository.create(store),
    newborn: MemoryIdentityNewbornRepository.create(store),
    reservations: MemoryIdentityReservationRepository.create(store),
    verification: MemoryIdentityVerificationRepository.create(store),
    backfill: MemoryIdentityBackfillRepository.create(store),
    mfaEnrollment: MemoryMfaEnrollmentRepository.create(store),
    twoStepVerification: MemoryTwoStepVerificationRepository.create(),
    joinRequests: MemoryJoinRequestReadRepository.create(store),
    joinCandidates: MemoryJoinCandidateRepository.create(store),
    ssoConnections: MemorySsoConnectionReadRepository.create(store),
    ssoStranding: MemorySsoConnectionStrandingRepository.create(store),
    ssoRegistrationSlots: MemorySsoConnectionRegistrationRepository.create(store),
    ssoBackoffice: MemorySsoConnectionBackofficeRepository.create(store),
    ssoReproofTargets: MemorySsoDomainReproofTargetRepository.create(store),
    ssoBreakGlass: MemorySsoBreakGlassRepository.create(store),
    ssoCredentials: MemorySsoCredentialRepository.create(store),
    ssoEngineProviders: MemorySsoEngineProviderRepository.create(store),
    ssoRegistrants: MemorySsoRegistrantReadRepository.create(store),
    ssoMigrationEvidence: MemorySsoMigrationEvidenceRepository.create(store),
    identityProjection: MemoryStateProjectionRepository.create<IdentityFoldState>(),
    mfaProjection: MemoryStateProjectionRepository.create<MfaFoldState>(),
    joinRequestProjection: MemoryStateProjectionRepository.create<JoinRequestFoldState>(),
    ssoConnectionHeads: MemoryStateProjectionRepository.create<SsoConnectionFoldState>(),
    scimSyncs: MemoryScimSyncProjectionRepository.create(),
    secretCarry: MemoryIdentitySecretCarryRepository.create(),
    joinRequestAudience: MemoryJoinRequestAudienceRepository.create(store),
    joinRequestNotificationContext: MemoryJoinRequestNotificationContextRepository.create(store),
    ssoPlatformOperators: MemorySsoPlatformOperatorsRepository.create({ store, adminEmails }),
    ssoDomainOwnership: MemorySsoDomainOwnershipRepository.create(store),
    identityLookup: MemoryIdentityLookupRepository.create(store),
    identityHistory: MemoryIdentityHistoryRepository.create(store),
  };
}
