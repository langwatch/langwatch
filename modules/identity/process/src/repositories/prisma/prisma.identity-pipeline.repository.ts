import { PostgresIdentityGuardsAdapter } from "../../repositories/prisma/prisma.identity-guards.repository.ts";
import {
  IdentityPipelineDefinitionAdapter,
  type IdentityPipeline,
} from "../../services/identity-pipeline-definition.service.ts";
import { PrismaIdentityProjectionRepository } from "./prisma.identity-projection.repository.ts";
import { PrismaMfaEnrollmentProjectionRepository } from "./prisma.mfa-enrollment-projection.repository.ts";
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
