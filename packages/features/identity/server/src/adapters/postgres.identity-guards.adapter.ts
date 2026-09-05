import { CryptoIdentifierIdentityAdapter } from "./crypto.identifier-identity.adapter";
import { IdentityGuardsService } from "../services/identity-guards.service";
import type { IdentityReservationRepository } from "../repositories/identity-reservations.repository";
import { MfaGuardsService } from "../services/mfa-guards.service";
import {
  PrismaIdentityHeadsRepository,
  type PrismaIdentityHeadsDatabase,
} from "../repositories/prisma/prisma.identity-heads.repository";
import {
  PrismaIdentityReservationRepository,
  type PrismaIdentityReservationsDatabase,
} from "../repositories/prisma/prisma.identity-reservations.repository";
import {
  PrismaIdentityUsersRepository,
  type PrismaIdentityUsersDatabase,
} from "../repositories/prisma/prisma.identity-users.repository";
import {
  PrismaMfaEnrollmentRepository,
  type PrismaMfaEnrollmentDatabase,
} from "../repositories/prisma/prisma.mfa-enrollment.repository";

/** Every model the identity and two-step verification guards read, and no other. */
export type IdentityGuardsDatabase = PrismaIdentityHeadsDatabase &
  PrismaIdentityReservationsDatabase &
  PrismaIdentityUsersDatabase &
  PrismaMfaEnrollmentDatabase;

export type PostgresIdentityGuardsOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: IdentityGuardsDatabase;
};

/**
 * What a graph composing the identity ledger needs before it can refuse anything: the two guard
 * instances, and the address lock they claim through.
 * fold (ADR-116 §6): the guards claim an address before stating a fact and the
 */
export type IdentityGuardsComposition = {
  identityGuards: IdentityGuardsService;
  mfaGuards: MfaGuardsService;
  reservations: IdentityReservationRepository;
};

/**
 * The Postgres composition seam for the identity guards.
 */
export class PostgresIdentityGuardsAdapter {
  static create(options: PostgresIdentityGuardsOptions): PostgresIdentityGuardsAdapter {
    return new PostgresIdentityGuardsAdapter(options);
  }

  private constructor(private readonly options: PostgresIdentityGuardsOptions) {}

  build(): IdentityGuardsComposition {
    const { database } = this.options;
    const reservations = PrismaIdentityReservationRepository.create(database);
    return {
      identityGuards: IdentityGuardsService.create(
        PrismaIdentityHeadsRepository.create(database),
        PrismaIdentityUsersRepository.create(database),
        reservations,
        CryptoIdentifierIdentityAdapter.create(),
      ),
      mfaGuards: MfaGuardsService.create(PrismaMfaEnrollmentRepository.create(database)),
      reservations,
    };
  }
}
