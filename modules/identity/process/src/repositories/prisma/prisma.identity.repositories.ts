import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption, RateLimiter } from "@langwatch/process-stores/members";

import { PrismaSsoConnectionAdminRepository } from "../../features/sso-connection/repositories/prisma/prisma.sso-connection-admin.repository.ts";
import { PrismaSsoConnectionProjectionRepository } from "../../features/sso-connection/repositories/prisma/prisma.sso-connection-projection.repository.ts";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
} from "../../features/sso-connection/repositories/prisma/prisma.sso-connection-reads.repository.ts";
import { PrismaSsoConnectionRegistrationRepository } from "../../features/sso-connection/repositories/prisma/prisma.sso-connection-registration.repository.ts";
import { PrismaSsoConnectionRoutingRepository } from "../../features/sso-connection/repositories/prisma/prisma.sso-connection-routing.repository.ts";
import { PrismaSsoCredentialRepository } from "../../features/sso-connection/repositories/prisma/prisma.sso-credential.repository.ts";
import { PrismaSsoEngineProviderRepository } from "../../features/sso-connection/repositories/prisma/prisma.sso-engine-provider.repository.ts";
import { PrismaSsoRegistrantReadRepository } from "../../features/sso-connection/repositories/prisma/prisma.sso-registrant.repository.ts";
import { newSsoAuthenticationActivityId } from "../../features/sso-connection/rules/sso-connection-id.rules.ts";
import { PrismaSsoDomainOwnershipRepository } from "../../features/sso-domain/repositories/prisma/prisma.sso-domain-ownership.repository.ts";
import { PrismaSsoDomainReproofTargetRepository } from "../../features/sso-domain/repositories/prisma/prisma.sso-domain-reproof.repository.ts";
import type { IdentityRepositories } from "../identity.repositories.ts";
import { RedisIdentityRateLimitRepository } from "../redis/redis.identity-rate-limit.repository.ts";
import { PrismaIdentityAccountRekeyRepository } from "./prisma.identity-account-rekey.repository.ts";
import { PrismaIdentityAccountsRepository } from "./prisma.identity-accounts.repository.ts";
import { PrismaIdentityBackfillRepository } from "./prisma.identity-backfill.repository.ts";
import { PrismaIdentityConnectionIssuersRepository } from "./prisma.identity-connection-issuers.repository.ts";
import { PrismaIdentityHeadsRepository } from "./prisma.identity-heads.repository.ts";
import { PrismaIdentityLatchRepository } from "./prisma.identity-latch.repository.ts";
import { PrismaIdentityLookupRepository } from "./prisma.identity-lookup.repository.ts";
import { PrismaIdentityMigrationRepository } from "./prisma.identity-migration.repository.ts";
import { PrismaIdentityPasskeyRemovalRepository } from "./prisma.identity-passkey-removal.repository.ts";
import { PrismaIdentityProjectionRepository } from "./prisma.identity-projection.repository.ts";
import { PrismaIdentityReservationRepository } from "./prisma.identity-reservations.repository.ts";
import { PrismaIdentityResolutionRepository } from "./prisma.identity-resolution.repository.ts";
import { PrismaIdentitySecretCarryRepository } from "./prisma.identity-secret-carry.repository.ts";
import { PrismaIdentitySignInAccountsRepository } from "./prisma.identity-signin-accounts.repository.ts";
import { PrismaIdentityUsersRepository } from "./prisma.identity-users.repository.ts";
import { PrismaIdentityVerificationRepository } from "./prisma.identity-verification.repository.ts";
import { PrismaJoinRequestAudienceRepository } from "./prisma.join-request-audience.repository.ts";
import { PrismaJoinRequestNotificationContextRepository } from "./prisma.join-request-notification-context.repository.ts";
import { PrismaJoinRequestProjectionRepository } from "./prisma.join-request-projection.repository.ts";
import {
  PrismaJoinCandidateRepository,
  PrismaJoinRequestReadRepository,
} from "./prisma.join-request.repository.ts";
import { PrismaLegacySsoOrganizationRepository } from "./prisma.legacy-sso-organization.repository.ts";
import { PrismaMfaEnrollmentProjectionRepository } from "./prisma.mfa-enrollment-projection.repository.ts";
import { PrismaMfaEnrollmentRepository } from "./prisma.mfa-enrollment.repository.ts";
import { PrismaSsoBreakGlassRepository } from "./prisma.sso-break-glass.repository.ts";
import { PrismaSsoMigrationEvidenceRepository } from "./prisma.sso-migration-evidence.repository.ts";
import { PrismaTwoStepVerificationRepository } from "./prisma.two-step-verification.repository.ts";

/** The live tier: every identity row over the one Prisma client. */
export class PostgresIdentityRepositories {
  static readonly requires = ["prisma", "encryption", "rateLimiter"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      encryption: Encryption;
      rateLimiter: RateLimiter;
    }>,
  ): IdentityRepositories {
    const database = members.prisma;
    // One address lock, shared by the guards and the identity fold (ADR-116 §6).
    const reservations = PrismaIdentityReservationRepository.create(database);

    return {
      heads: PrismaIdentityHeadsRepository.create(database),
      latch: PrismaIdentityLatchRepository.create(database),
      accounts: PrismaIdentityAccountsRepository.create(database),
      resolution: PrismaIdentityResolutionRepository.create(database),
      connectionIssuers: PrismaIdentityConnectionIssuersRepository.create(database),
      passkeyRemoval: PrismaIdentityPasskeyRemovalRepository.create(database),
      users: PrismaIdentityUsersRepository.create(database),
      signInAccounts: PrismaIdentitySignInAccountsRepository.create(database),
      accountRekey: PrismaIdentityAccountRekeyRepository.create(database),
      ssoBreakGlass: PrismaSsoBreakGlassRepository.create(database),
      reservations,
      verification: PrismaIdentityVerificationRepository.create(database),
      backfill: PrismaIdentityBackfillRepository.create(database),
      mfaEnrollment: PrismaMfaEnrollmentRepository.create(database),
      twoStepVerification: PrismaTwoStepVerificationRepository.create(database),
      joinRequests: PrismaJoinRequestReadRepository.create(database),
      joinCandidates: PrismaJoinCandidateRepository.create(database),
      ssoConnections: PrismaSsoConnectionReadRepository.create(database),
      ssoConnectionRouting: PrismaSsoConnectionRoutingRepository.create({ database }),
      legacySsoOrganizations: PrismaLegacySsoOrganizationRepository.create(database),
      ssoStranding: PrismaSsoConnectionStrandingRepository.create(database),
      ssoRegistrationSlots: PrismaSsoConnectionRegistrationRepository.create(database),
      ssoAdmin: PrismaSsoConnectionAdminRepository.create(database),
      ssoReproofTargets: PrismaSsoDomainReproofTargetRepository.create(database),
      ssoCredentials: PrismaSsoCredentialRepository.create(database, members.encryption),
      ssoEngineProviders: PrismaSsoEngineProviderRepository.create(database, members.encryption),
      ssoRegistrants: PrismaSsoRegistrantReadRepository.create(database),
      ssoMigrationEvidence: PrismaSsoMigrationEvidenceRepository.create(
        database,
        newSsoAuthenticationActivityId,
      ),
      identityProjection: PrismaIdentityProjectionRepository.create({
        prisma: database,
        reservations,
      }),
      mfaProjection: PrismaMfaEnrollmentProjectionRepository.create(database),
      joinRequestProjection: PrismaJoinRequestProjectionRepository.create(database),
      ssoConnectionHeads: PrismaSsoConnectionProjectionRepository.create(database),
      secretCarry: PrismaIdentitySecretCarryRepository.create(database),
      migration: PrismaIdentityMigrationRepository.create(database),
      joinRequestAudience: PrismaJoinRequestAudienceRepository.create(database),
      joinRequestNotificationContext:
        PrismaJoinRequestNotificationContextRepository.create(database),
      ssoDomainOwnership: PrismaSsoDomainOwnershipRepository.create(database),
      identityLookup: PrismaIdentityLookupRepository.create(database),
      rateLimits: RedisIdentityRateLimitRepository.create(members.rateLimiter),
    };
  }
}
