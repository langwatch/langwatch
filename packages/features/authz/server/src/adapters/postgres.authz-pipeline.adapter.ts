import { EventingAuthzAdapter } from "./eventing.authz.adapter";
import type { AuthzPipeline } from "./postgres.authz.adapter";
import {
  type AuthzAuditDatabase,
  PrismaAuthzAuditRepository,
} from "../repositories/prisma/prisma.authz-audit.repository";
import {
  type AuthzProjectionDatabase,
  PrismaAuthzProjectionRepository,
} from "../repositories/prisma/prisma.authz-projection.repository";

/** Every model the grants ledger's consumer half writes, and no other. */
export type AuthzGrantPipelineDatabase = AuthzProjectionDatabase & AuthzAuditDatabase;

export type PostgresAuthzPipelineOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: AuthzGrantPipelineDatabase;
};

/**
 * The Postgres composition seam for the AuthZ grants ledger (ADR-092 §13).
 *
 * The ledger has two halves and only one of them needs an application. The
 * PRODUCER half is `PostgresAuthzAdapter`: the two contract services, the
 * revocation telemetry, the Redis epoch, the cutover gate and the command
 * dispatcher a request path resolves its sender from. The CONSUMER half — the
 * pipeline registered below — takes exactly two Postgres bindings: the read
 * model's guarded writer and the insert-only audit trail. Neither needs a
 * dispatcher, a cache, a feature flag or a live request, which is what lets a
 * background worker build this graph for itself rather than being handed a
 * definition another process assembled.
 *
 * `connect` is deliberately absent here. It hands a PRODUCER the senders the
 * registration produced, and a process that writes no grants has nobody to
 * hand them to; the application keeps its own `AuthzFeature.connect` for the
 * writers it hosts. A worker that called it would resolve a second dispatcher
 * for a ledger it never dispatches into.
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
