import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { IdentityRepositories } from "../identity.repositories.ts";
import { PrismaIdentityBackfillRepository } from "./prisma.identity-backfill.repository.ts";
import { PrismaIdentityHeadsRepository } from "./prisma.identity-heads.repository.ts";
import { PrismaIdentityLatchRepository } from "./prisma.identity-latch.repository.ts";
import { PrismaIdentityNewbornRepository } from "./prisma.identity-newborn.repository.ts";
import { PrismaIdentityReservationRepository } from "./prisma.identity-reservations.repository.ts";
import { PrismaIdentityUsersRepository } from "./prisma.identity-users.repository.ts";
import { PrismaIdentityVerificationRepository } from "./prisma.identity-verification.repository.ts";
import {
  PrismaJoinCandidateRepository,
  PrismaJoinRequestReadRepository,
} from "./prisma.join-request.repository.ts";
import { PrismaMfaEnrollmentRepository } from "./prisma.mfa-enrollment.repository.ts";
import { PrismaSsoConnectionBackofficeRepository } from "./prisma.sso-connection-backoffice.repository.ts";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
} from "./prisma.sso-connection-reads.repository.ts";

/** The live tier: every identity row over the one Prisma client. */
export class PostgresIdentityRepositories {
  static readonly requires = ["prisma"] as const;

  static create(members: Readonly<{ prisma: PrismaClient }>): IdentityRepositories {
    const database = members.prisma;

    return {
      heads: PrismaIdentityHeadsRepository.create(database),
      latch: PrismaIdentityLatchRepository.create(database),
      users: PrismaIdentityUsersRepository.create(database),
      newborn: PrismaIdentityNewbornRepository.create(database),
      reservations: PrismaIdentityReservationRepository.create(database),
      verification: PrismaIdentityVerificationRepository.create(database),
      backfill: PrismaIdentityBackfillRepository.create(database),
      mfaEnrollment: PrismaMfaEnrollmentRepository.create(database),
      joinRequests: PrismaJoinRequestReadRepository.create(database),
      joinCandidates: PrismaJoinCandidateRepository.create(database),
      ssoConnections: PrismaSsoConnectionReadRepository.create(database),
      ssoStranding: PrismaSsoConnectionStrandingRepository.create(database),
      ssoBackoffice: PrismaSsoConnectionBackofficeRepository.create(database),
    };
  }
}
