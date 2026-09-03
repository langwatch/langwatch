import { PostgresIdentityGuardsAdapter } from "./postgres.identity-guards.adapter";
import {
  createIdentityPipeline,
  type IdentityPipeline,
} from "./identity-pipeline-definition.adapter";
import { PrismaIdentityProjectionRepository } from "../repositories/prisma/prisma.identity-projection.repository";
import { PrismaMfaEnrollmentProjectionRepository } from "../repositories/prisma/prisma.mfa-enrollment-projection.repository";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/** Every model the identity ledger reads or writes, and no other. */
export type IdentityPipelineDatabase = PrismaClient;

export type PostgresIdentityPipelineOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: IdentityPipelineDatabase;
};

/**
 * The Postgres composition seam for the identity pipeline (ADR-101 / D01
 * identifiers, and D06 two-step verification on the same aggregate).
 *
 * Every dependency the pipeline takes is a Postgres binding: the `Identifier`
 * head and its cursor, the `MfaEnrollment` head, and the guard reads over
 * both plus the legacy `User` columns. None of them needs an application, a
 * mailer, an identity provider or a better-auth instance, which is what lets
 * a background worker build this graph for itself rather than being handed a
 * definition another process assembled.
 *
 * The address lock is composed ONCE and shared (ADR-116 §6): the guards claim
 * an address before stating a fact, and the fold releases it once no live
 * identifier of that user carries the value. Two instances would still agree —
 * the table is the truth — but the fold reaching a lock the guards never saw
 * is the kind of split this seam exists to make unexpressible.
 */
export class PostgresIdentityPipelineAdapter {
  static create(options: PostgresIdentityPipelineOptions): PostgresIdentityPipelineAdapter {
    return new PostgresIdentityPipelineAdapter(options);
  }

  private constructor(private readonly options: PostgresIdentityPipelineOptions) {}

  build(): IdentityPipeline {
    const { database } = this.options;
    const { identityGuards, mfaGuards, reservations } = PostgresIdentityGuardsAdapter.create({
      database,
    }).build();
    return createIdentityPipeline({
      identityProjectionStore: new PrismaIdentityProjectionRepository(database, reservations),
      identityGuards,
      mfaProjectionStore: new PrismaMfaEnrollmentProjectionRepository(database),
      mfaGuards,
    });
  }
}
