import type { EventSourcing } from "@langwatch/eventing";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores/members";

import { newSsoAuthenticationActivityId } from "../../rules/sso-connection-id.rules.ts";
import { EventingIdentityHistoryRepository } from "../eventing/eventing.identity-history.repository.ts";
import type {
  IdentityMigrationRepositories,
  IdentityRepositories,
} from "../identity.repositories.ts";
import { PrismaIdentityBackfillRepository } from "./prisma.identity-backfill.repository.ts";
import { PrismaIdentityHeadsRepository } from "./prisma.identity-heads.repository.ts";
import { PrismaIdentityLatchRepository } from "./prisma.identity-latch.repository.ts";
import { PrismaIdentityLookupRepository } from "./prisma.identity-lookup.repository.ts";
import { PrismaIdentityNewbornRepository } from "./prisma.identity-newborn.repository.ts";
import { PrismaIdentityProjectionRepository } from "./prisma.identity-projection.repository.ts";
import { PrismaIdentityReservationRepository } from "./prisma.identity-reservations.repository.ts";
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
import { PrismaMfaEnrollmentProjectionRepository } from "./prisma.mfa-enrollment-projection.repository.ts";
import { PrismaMfaEnrollmentRepository } from "./prisma.mfa-enrollment.repository.ts";
import { PrismaScimSyncProjectionRepository } from "./prisma.scim-sync-projection.repository.ts";
import { PrismaSsoBreakGlassRepository } from "./prisma.sso-break-glass.repository.ts";
import { PrismaSsoConnectionBackofficeRepository } from "./prisma.sso-connection-backoffice.repository.ts";
import { PrismaSsoConnectionProjectionRepository } from "./prisma.sso-connection-projection.repository.ts";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
} from "./prisma.sso-connection-reads.repository.ts";
import { PrismaSsoConnectionRegistrationRepository } from "./prisma.sso-connection-registration.repository.ts";
import { PrismaSsoConnectionRoutingRepository } from "./prisma.sso-connection-routing.repository.ts";
import { PrismaSsoCredentialRepository } from "./prisma.sso-credential.repository.ts";
import { PrismaSsoDomainOwnershipRepository } from "./prisma.sso-domain-ownership.repository.ts";
import { PrismaSsoDomainReproofTargetRepository } from "./prisma.sso-domain-reproof.repository.ts";
import { PrismaSsoEngineProviderRepository } from "./prisma.sso-engine-provider.repository.ts";
import { PrismaSsoMigrationEvidenceRepository } from "./prisma.sso-migration-evidence.repository.ts";
import { AdminEmailPlatformOperatorsRepository } from "./prisma.sso-platform-operators.repository.ts";
import { PrismaSsoRegistrantReadRepository } from "./prisma.sso-registrant.repository.ts";
import { PrismaTwoStepVerificationRepository } from "./prisma.two-step-verification.repository.ts";

/** The live tier: every identity row over the one Prisma client. */
export class PostgresIdentityRepositories {
  static readonly requires = ["prisma", "encryption", "adminEmails", "eventing"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      encryption: Encryption;
      adminEmails: readonly string[];
      eventing: EventSourcing;
    }>,
  ): IdentityRepositories {
    const database = members.prisma;
    // One address lock, shared by the guards and the identity fold (ADR-116 §6).
    const reservations = PrismaIdentityReservationRepository.create(database);

    return {
      heads: PrismaIdentityHeadsRepository.create(database),
      latch: PrismaIdentityLatchRepository.create(database),
      users: PrismaIdentityUsersRepository.create(database),
      signInAccounts: PrismaIdentitySignInAccountsRepository.create(database),
      ssoBreakGlass: PrismaSsoBreakGlassRepository.create(database),
      newborn: PrismaIdentityNewbornRepository.create(database),
      reservations,
      verification: PrismaIdentityVerificationRepository.create(database),
      backfill: PrismaIdentityBackfillRepository.create(database),
      mfaEnrollment: PrismaMfaEnrollmentRepository.create(database),
      twoStepVerification: PrismaTwoStepVerificationRepository.create(database),
      joinRequests: PrismaJoinRequestReadRepository.create(database),
      joinCandidates: PrismaJoinCandidateRepository.create(database),
      ssoConnections: PrismaSsoConnectionReadRepository.create(database),
      ssoConnectionRouting: PrismaSsoConnectionRoutingRepository.create({ database }),
      ssoStranding: PrismaSsoConnectionStrandingRepository.create(database),
      ssoRegistrationSlots: PrismaSsoConnectionRegistrationRepository.create(database),
      ssoBackoffice: PrismaSsoConnectionBackofficeRepository.create(database),
      ssoReproofTargets: PrismaSsoDomainReproofTargetRepository.create(database),
      ssoCredentials: PrismaSsoCredentialRepository.create(database, members.encryption),
      ssoEngineProviders: PrismaSsoEngineProviderRepository.create(database),
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
      scimSyncs: PrismaScimSyncProjectionRepository.create(database),
      secretCarry: PrismaIdentitySecretCarryRepository.create(database),
      joinRequestAudience: PrismaJoinRequestAudienceRepository.create(database),
      joinRequestNotificationContext:
        PrismaJoinRequestNotificationContextRepository.create(database),
      ssoPlatformOperators: AdminEmailPlatformOperatorsRepository.create({
        database,
        adminEmails: members.adminEmails,
      }),
      ssoDomainOwnership: PrismaSsoDomainOwnershipRepository.create(database),
      identityLookup: PrismaIdentityLookupRepository.create(database),
      identityHistory: EventingIdentityHistoryRepository.create({ eventing: members.eventing }),
    };
  }
}

/** The migration pass's rows over one client, sharing the one address lock (ADR-116 §6). */
export function identityMigrationRepositoriesOverPrisma(
  database: PrismaClient,
): IdentityMigrationRepositories {
  const reservations = PrismaIdentityReservationRepository.create(database);
  return {
    heads: PrismaIdentityHeadsRepository.create(database),
    users: PrismaIdentityUsersRepository.create(database),
    reservations,
    mfaEnrollment: PrismaMfaEnrollmentRepository.create(database),
    identityProjection: PrismaIdentityProjectionRepository.create({
      prisma: database,
      reservations,
    }),
    backfill: PrismaIdentityBackfillRepository.create(database),
    secretCarry: PrismaIdentitySecretCarryRepository.create(database),
    newborn: PrismaIdentityNewbornRepository.create(database),
    ssoDomainOwnership: PrismaSsoDomainOwnershipRepository.create(database),
  };
}
