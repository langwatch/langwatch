import { PostgresIdentityGuardsAdapter } from "./postgres.identity-guards.adapter";
import {
  IdentityPipelineDefinitionAdapter,
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
 * identifiers, and D06 two-step verification on the same aggregate).
 * The Postgres composition seam for the identity pipeline (ADR-101 / D01
 * The address lock is composed ONCE and shared (ADR-116 §6): the guards claim
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
    return IdentityPipelineDefinitionAdapter.create({
      identityProjectionStore: new PrismaIdentityProjectionRepository(database, reservations),
      identityGuards,
      mfaProjectionStore: new PrismaMfaEnrollmentProjectionRepository(database),
      mfaGuards,
    });
  }
}
