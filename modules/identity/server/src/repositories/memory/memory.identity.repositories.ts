import type { IdentityRepositories } from "../identity.repositories.ts";
import { MemoryIdentityStore } from "./memory-identity.store.ts";
import {
  MemoryIdentityBackfillRepository,
  MemoryIdentityHeadsRepository,
  MemoryIdentityNewbornRepository,
  MemoryIdentityReservationRepository,
  MemoryIdentityUsersRepository,
  MemoryIdentityVerificationRepository,
} from "./memory.identity-user.repositories.ts";
import { MemoryIdentityLatchRepository } from "./memory.identity-latch.repository.ts";
import {
  MemoryJoinCandidateRepository,
  MemoryJoinRequestReadRepository,
} from "./memory.join-request.repositories.ts";
import { MemoryMfaEnrollmentRepository } from "./memory.mfa-enrollment.repository.ts";
import {
  MemorySsoConnectionBackofficeRepository,
  MemorySsoConnectionReadRepository,
  MemorySsoConnectionStrandingRepository,
} from "./memory.sso-connection.repositories.ts";

/**
 * The "memory" tier: every identity repository the app is tested without a
 * database. One store behind all twelve rows, the way one Postgres connection
 * sits behind the Prisma tier - an identifier written through one row is what
 * the others answer from.
 */
export class MemoryIdentityRepositories {
  static readonly requires = [] as const;

  static create(): IdentityRepositories {
    return MemoryIdentityRepositories.over(MemoryIdentityStore.create());
  }

  /** The same tier over a store the caller keeps, for tests that seed rows. */
  static over(store: MemoryIdentityStore): IdentityRepositories {
    return {
      heads: MemoryIdentityHeadsRepository.create(store),
      latch: MemoryIdentityLatchRepository.create(store),
      users: MemoryIdentityUsersRepository.create(store),
      newborn: MemoryIdentityNewbornRepository.create(store),
      reservations: MemoryIdentityReservationRepository.create(store),
      verification: MemoryIdentityVerificationRepository.create(store),
      backfill: MemoryIdentityBackfillRepository.create(store),
      mfaEnrollment: MemoryMfaEnrollmentRepository.create(store),
      joinRequests: MemoryJoinRequestReadRepository.create(store),
      joinCandidates: MemoryJoinCandidateRepository.create(store),
      ssoConnections: MemorySsoConnectionReadRepository.create(store),
      ssoStranding: MemorySsoConnectionStrandingRepository.create(store),
      ssoBackoffice: MemorySsoConnectionBackofficeRepository.create(store),
    };
  }
}
