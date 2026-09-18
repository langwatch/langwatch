import { EventingAuthzAdapter } from "../eventing/authz-grant.pipeline.ts";
import {
  type AuthzAuditDatabase,
  PrismaAuthzAuditRepository,
} from "../repositories/prisma/prisma.authz-audit.repository.ts";
import {
  type AuthzProjectionDatabase,
  PrismaAuthzProjectionRepository,
} from "../repositories/prisma/prisma.authz-projection.repository.ts";
import type { AuthzPipeline } from "./postgres-authz.build.ts";

/** Every model the grants ledger's consumer half writes, and no other. */
export type AuthzGrantPipelineDatabase = AuthzProjectionDatabase & AuthzAuditDatabase;

export type PostgresAuthzPipelineOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: AuthzGrantPipelineDatabase;
};

/**
 * Postgres CONSUMER pipeline (producer is PostgresAuthzAdapter). Takes two
 * bindings (guarded writer, audit trail); no dispatcher, no connect (ADR-092).
 */
export class PostgresAuthzPipelineAdapter {
  static create(options: PostgresAuthzPipelineOptions): PostgresAuthzPipelineAdapter {
    return new PostgresAuthzPipelineAdapter(options);
  }

  private constructor(private readonly options: PostgresAuthzPipelineOptions) {}

  build(): AuthzPipeline {
    const { database } = this.options;
    return EventingAuthzAdapter.build({
      authzGrantsWriteStore: PrismaAuthzProjectionRepository.create(database),
      authzAuditTrailStore: PrismaAuthzAuditRepository.create(database),
    });
  }
}
