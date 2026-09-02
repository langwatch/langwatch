import { IdentityGuards } from "../guards";
import type { IdentityReservationRepository } from "../identity-reservations.repository";
import { MfaGuards } from "../mfa-guards";
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
 * What a graph composing the identity ledger needs before it can refuse
 * anything: the two guard instances, and the address lock they claim through.
 *
 * The lock is returned rather than kept private because it is SHARED with the
 * fold (ADR-116 §6): the guards claim an address before stating a fact and the
 * projection releases it once no live identifier of that user carries the
 * value. Two instances would still work — the table is the truth — but a
 * caller holding only the guards could not release, and a caller building its
 * own would have to reach past this seam to do it.
 */
export type IdentityGuardsComposition = {
  identityGuards: IdentityGuards;
  mfaGuards: MfaGuards;
  reservations: IdentityReservationRepository;
};

/**
 * The Postgres composition seam for the identity guards.
 *
 * Every read behind them is plain Postgres over models this schema already
 * carries — the `Identifier` heads, the legacy `User` columns the
 * cross-population collision guard consults, the address lock, and the
 * `MfaEnrollment` head — so a process holding a typed client composes them
 * rather than receiving them from a tier that already had one. That is what
 * lets the background worker build the identity pipeline for itself instead of
 * being handed a definition the application assembled.
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
      identityGuards: new IdentityGuards(
        PrismaIdentityHeadsRepository.create(database),
        PrismaIdentityUsersRepository.create(database),
        reservations,
      ),
      mfaGuards: new MfaGuards(PrismaMfaEnrollmentRepository.create(database)),
      reservations,
    };
  }
}
