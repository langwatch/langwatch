import type { JoinRequestFoldState } from "../../features/join-request/eventing/join-request-state.projection.ts";
import type { MfaFoldState } from "../../features/mfa/eventing/mfa-enrollment-state.projection.ts";
import type { SsoConnectionFoldState } from "../../features/sso-connection/eventing/sso-connection-state.projection.ts";
import { MemorySsoConnectionHistoryRepository } from "../../features/sso-connection/repositories/memory/memory.sso-connection-history.repository.ts";
import { MemorySsoConnectionRegistrationRepository } from "../../features/sso-connection/repositories/memory/memory.sso-connection-registration.repository.ts";
import { MemorySsoConnectionRoutingRepository } from "../../features/sso-connection/repositories/memory/memory.sso-connection-routing.repository.ts";
import {
  MemorySsoConnectionAdminRepository,
  MemorySsoConnectionReadRepository,
  MemorySsoConnectionStrandingRepository,
} from "../../features/sso-connection/repositories/memory/memory.sso-connection.repositories.ts";
import { MemorySsoCredentialRepository } from "../../features/sso-connection/repositories/memory/memory.sso-credential.repository.ts";
import { MemorySsoEngineProviderRepository } from "../../features/sso-connection/repositories/memory/memory.sso-engine-provider.repository.ts";
import { MemorySsoRegistrantReadRepository } from "../../features/sso-connection/repositories/memory/memory.sso-registrant.repository.ts";
import { MemorySsoDomainOwnershipRepository } from "../../features/sso-domain/repositories/memory/memory.sso-domain-ownership.repository.ts";
import { MemorySsoDomainReproofTargetRepository } from "../../features/sso-domain/repositories/memory/memory.sso-domain-reproof.repository.ts";
import type { IdentityRepositories } from "../identity.repositories.ts";
import { MemoryIdentityAccountRekeyRepository } from "./memory.identity-account-rekey.repository.ts";
import { MemoryIdentityLatchRepository } from "./memory.identity-latch.repository.ts";
import { MemoryIdentityLookupRepository } from "./memory.identity-lookup.repository.ts";
import { MemoryIdentityMigrationRepository } from "./memory.identity-migration.repository.ts";
import { MemoryIdentityProjectionRepository } from "./memory.identity-projection.repository.ts";
import { MemoryIdentityRateLimitRepository } from "./memory.identity-rate-limit.repository.ts";
import { MemoryIdentitySecretCarryRepository } from "./memory.identity-secret-carry.repository.ts";
import { MemoryIdentitySignInAccountsRepository } from "./memory.identity-signin-accounts.repository.ts";
import {
  MemoryIdentityAccountsRepository,
  MemoryIdentityConnectionIssuersRepository,
  MemoryIdentityPasskeyRemovalRepository,
  MemoryIdentityResolutionRepository,
} from "./memory.identity-storage.repositories.ts";
import {
  MemoryIdentityBackfillRepository,
  MemoryIdentityHeadsRepository,
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
import { MemoryLegacySsoOrganizationRepository } from "./memory.legacy-sso-organization.repository.ts";
import { MemoryMfaEnrollmentRepository } from "./memory.mfa-enrollment.repository.ts";
import { MemorySsoBreakGlassRepository } from "./memory.sso-break-glass.repository.ts";
import { MemorySsoMigrationEvidenceRepository } from "./memory.sso-migration-evidence.repository.ts";
import { MemoryStateProjectionRepository } from "./memory.state-projection.repository.ts";
import { MemoryTwoStepVerificationRepository } from "./memory.two-step-verification.repository.ts";

/**
 * The "memory" tier: every identity repository the app is tested without a
 * database. One store behind all twelve rows, the way one Postgres
 * connection sits behind the Prisma tier.
 */
export class MemoryIdentityRepositories {
  static readonly requires = [] as const;

  static create(): IdentityRepositories {
    return identityRepositoriesOverMemory(MemoryIdentityStore.create());
  }
}

/** The same tier over a store the caller keeps, for tests that seed rows. */
export function identityRepositoriesOverMemory(store: MemoryIdentityStore): IdentityRepositories {
  return {
    heads: MemoryIdentityHeadsRepository.create(store),
    latch: MemoryIdentityLatchRepository.create(store),
    accounts: MemoryIdentityAccountsRepository.create(),
    resolution: MemoryIdentityResolutionRepository.create(),
    connectionIssuers: new MemoryIdentityConnectionIssuersRepository(),
    passkeyRemoval: new MemoryIdentityPasskeyRemovalRepository(),
    users: MemoryIdentityUsersRepository.create(store),
    signInAccounts: MemoryIdentitySignInAccountsRepository.create(store),
    accountRekey: MemoryIdentityAccountRekeyRepository.create(store),
    reservations: MemoryIdentityReservationRepository.create(store),
    verification: MemoryIdentityVerificationRepository.create(store),
    backfill: MemoryIdentityBackfillRepository.create(store),
    mfaEnrollment: MemoryMfaEnrollmentRepository.create(store),
    twoStepVerification: MemoryTwoStepVerificationRepository.create(),
    joinRequests: MemoryJoinRequestReadRepository.create(store),
    joinCandidates: MemoryJoinCandidateRepository.create(store),
    ssoConnections: MemorySsoConnectionReadRepository.create(store),
    ssoConnectionRouting: MemorySsoConnectionRoutingRepository.create({ store }),
    legacySsoOrganizations: MemoryLegacySsoOrganizationRepository.create(),
    ssoStranding: MemorySsoConnectionStrandingRepository.create(store),
    ssoRegistrationSlots: MemorySsoConnectionRegistrationRepository.create(store),
    ssoAdmin: MemorySsoConnectionAdminRepository.create(store),
    ssoConnectionHistory: MemorySsoConnectionHistoryRepository.create(),
    ssoReproofTargets: MemorySsoDomainReproofTargetRepository.create(store),
    ssoBreakGlass: MemorySsoBreakGlassRepository.create(store),
    ssoCredentials: MemorySsoCredentialRepository.create(store),
    ssoEngineProviders: MemorySsoEngineProviderRepository.create(store),
    ssoRegistrants: MemorySsoRegistrantReadRepository.create(store),
    ssoMigrationEvidence: MemorySsoMigrationEvidenceRepository.create(store),
    identityProjection: MemoryIdentityProjectionRepository.create(),
    mfaProjection: MemoryStateProjectionRepository.create<MfaFoldState>(),
    joinRequestProjection: MemoryStateProjectionRepository.create<JoinRequestFoldState>(),
    ssoConnectionHeads: MemoryStateProjectionRepository.create<SsoConnectionFoldState>(),
    secretCarry: MemoryIdentitySecretCarryRepository.create(),
    migration: MemoryIdentityMigrationRepository.create(store),
    joinRequestAudience: MemoryJoinRequestAudienceRepository.create(store),
    joinRequestNotificationContext: MemoryJoinRequestNotificationContextRepository.create(store),
    ssoDomainOwnership: MemorySsoDomainOwnershipRepository.create(store),
    identityLookup: MemoryIdentityLookupRepository.create(store),
    rateLimits: MemoryIdentityRateLimitRepository.create(),
  };
}
