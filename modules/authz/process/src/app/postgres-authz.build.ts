import {
  type AuthzGrantsService as AuthzGrantsServiceContract,
  type AuthzService as AuthzServiceContract,
} from "@langwatch/authz-contract";
import type { StaticPipelineDefinition } from "@langwatch/eventing";
import type { SystemMigration } from "@langwatch/system-migrations";

import { EventingAuthzAdapter } from "../eventing/authz-grant.pipeline.ts";
import {
  type AuthzLedgerDatabase,
  type EventingAuthzLedgerAdapterOptions,
  EventingAuthzLedgerAdapter,
} from "../eventing/authz-grant.store.ts";
import {
  type AuthzEngineLedger,
  LegacyImportAuthzGrantMigration,
} from "../migrations/legacy-import.authz-grant.migration.ts";
import type { AuthzDatabase, AuthzReadRepository } from "../repositories/authz-read.repository.ts";
import type { AuthzRepositories } from "../repositories/authz.repositories.ts";
import type { AuthzGrantWriteDatabase } from "../repositories/eventing/eventing.authz-grant.repository.ts";
import { EventingAuthzGrantRepository } from "../repositories/eventing/eventing.authz-grant.repository.ts";
import { EventingAuthzListingRepository } from "../repositories/eventing/eventing.authz-listing.repository.ts";
import { EventingAuthzReadRepository } from "../repositories/eventing/eventing.authz-read.repository.ts";
import type { AuthzAuditDatabase } from "../repositories/prisma/prisma.authz-audit.repository.ts";
import { PrismaAuthzAuditRepository } from "../repositories/prisma/prisma.authz-audit.repository.ts";
import {
  type AuthzBindingDatabase,
  PrismaAuthzBindingRepository,
} from "../repositories/prisma/prisma.authz-binding.repository.ts";
import {
  type AuthzCutoverDatabase,
  PrismaAuthzCutoverRepository,
} from "../repositories/prisma/prisma.authz-cutover.repository.ts";
import type { PrismaAuthzGrantDatabase } from "../repositories/prisma/prisma.authz-grant.repository.ts";
import {
  type AuthzMembershipStampDatabase,
  PrismaAuthzMembershipStampRepository,
} from "../repositories/prisma/prisma.authz-membership-stamp.repository.ts";
import type { AuthzMigrationDatabase } from "../repositories/prisma/prisma.authz-migration.repository.ts";
import { PrismaAuthzMigrationRepository } from "../repositories/prisma/prisma.authz-migration.repository.ts";
import {
  type AuthzProjectionDatabase,
  PrismaAuthzProjectionRepository,
} from "../repositories/prisma/prisma.authz-projection.repository.ts";
import { PrismaAuthzRevocationRepository } from "../repositories/prisma/prisma.authz-revocation.repository.ts";
import type { AuthzEpochRedis } from "../repositories/redis/redis.authz-epoch.repository.ts";
import { RedisAuthzEpochRepository } from "../repositories/redis/redis.authz-epoch.repository.ts";
import { AuthzCutoverGateService } from "../services/authz-cutover-gate.service.ts";
import type {
  AuthzGrantsCommandDispatcher,
  AuthzGrantsCommandSenders,
} from "../services/authz-grants-command-dispatcher.service.ts";
import { AuthzGrantsService } from "../services/authz-grants.service.ts";
import { AuthzService, type AuthzServiceOptions } from "../services/authz.service.ts";

/**
 * The one structural Postgres capability the AuthZ feature needs. A runtime
 * may adapt a generated client to this type once at its composition boundary;
 * no generated database type crosses into the feature.
 */
export type PostgresAuthzDatabase = AuthzLedgerDatabase &
  AuthzGrantWriteDatabase &
  PrismaAuthzGrantDatabase &
  AuthzMigrationDatabase &
  AuthzCutoverDatabase &
  AuthzAuditDatabase &
  AuthzBindingDatabase &
  AuthzMembershipStampDatabase &
  AuthzProjectionDatabase;

export type PostgresAuthzAdapterOptions = {
  database: PostgresAuthzDatabase;
  /**
   * The rows the process selected at boot. A caller that composes this graph
   * by hand may omit them, and the two selectable rows are then built from the
   * structural database above.
   */
  repositories?: AuthzRepositories;
  redis: AuthzEpochRedis | null;
  dispatcher: AuthzGrantsCommandDispatcher;
  newBindingId: () => string;
  newCommandId?: () => string;
  now?: () => number;
  cacheEnabled?: () => boolean;
  demoProjectId?: () => string | undefined;
  cacheMaxAgeMs?: number;
  ledgerPoll?: { intervalMs: number; timeoutMs: number };
};

/** Public Eventing definition only; concrete projection/store types stay private. */
export type AuthzPipeline = StaticPipelineDefinition<any, any, any>;

export type PostgresAuthzBuild = Readonly<{
  authz: AuthzServiceContract;
  grants: AuthzGrantsServiceContract;
  pipeline: AuthzPipeline;
  migration: SystemMigration;
}>;

/**
 * The migration speaks the command vocabulary directly since it supplies
 * content-derived command IDs and business times, resolving the same
 * dispatcher as live writes for one producer topology and error policy.
 */
class DispatcherAuthzEngineLedger implements AuthzEngineLedger {
  constructor(private readonly dispatcher: AuthzGrantsCommandDispatcher) {}

  private async commands(): Promise<AuthzGrantsCommandSenders> {
    return (await this.dispatcher.commands()).commands;
  }

  async attachGrant(args: Parameters<AuthzEngineLedger["attachGrant"]>[0]): Promise<void> {
    const { organizationId, commandId, grant } = args;
    await (
      await this.commands()
    ).attachGrant.send({
      tenantId: organizationId,
      organizationId,
      commandId,
      grant,
    });
  }

  async defineRole(args: Parameters<AuthzEngineLedger["defineRole"]>[0]): Promise<void> {
    const { organizationId, commandId, role, actor } = args;
    await (
      await this.commands()
    ).defineRole.send({
      tenantId: organizationId,
      organizationId,
      commandId,
      role,
      actor,
    });
  }

  async changeGrantRole(args: Parameters<AuthzEngineLedger["changeGrantRole"]>[0]): Promise<void> {
    await (
      await this.commands()
    ).changeGrantRole.send({
      tenantId: args.organizationId,
      ...args,
    });
  }

  async revokeGrant(args: Parameters<AuthzEngineLedger["revokeGrant"]>[0]): Promise<void> {
    await (
      await this.commands()
    ).revokeGrant.send({
      tenantId: args.organizationId,
      ...args,
    });
  }

  async deleteRole(args: Parameters<AuthzEngineLedger["deleteRole"]>[0]): Promise<void> {
    await (
      await this.commands()
    ).deleteRole.send({
      tenantId: args.organizationId,
      ...args,
    });
  }
}

/**
 * Deliberate root adapter: all private AuthZ persistence and Eventing pieces
 * are constructed here, while callers receive only the two contract services
 * and the explicit runtime registrations they must install.
 */
export class PostgresAuthzAdapter {
  static create(options: PostgresAuthzAdapterOptions): PostgresAuthzAdapter {
    return new PostgresAuthzAdapter(options);
  }

  /**
   * The engine's own reader over a Postgres client, for a host that needs to
   * see what the engine sees. Every decision reads the grants projection, so
   * this is that head; the repository stays private behind this one door.
   */
  static createReader({ database }: { database: AuthzDatabase }): AuthzReadRepository {
    return EventingAuthzReadRepository.create(database);
  }

  private constructor(private readonly options: PostgresAuthzAdapterOptions) {}

  build(): PostgresAuthzBuild {
    const { database } = this.options;
    const epoch = RedisAuthzEpochRepository.create({ redis: this.options.redis });
    const cutover = AuthzCutoverGateService.create({
      repository:
        this.options.repositories?.cutover ?? PrismaAuthzCutoverRepository.create({ database }),
    });
    // Migration completion still answers compatibility writes and legacy
    // API-key adoption; every decision and listing reads the grants head.
    const isOnEngine = (organizationId: string) => cutover.isOn({ organizationId });

    const revocation = PrismaAuthzRevocationRepository.create({
      database,
    });
    const ledgerOptions: EventingAuthzLedgerAdapterOptions = {
      database,
      dispatcher: this.options.dispatcher,
      epoch,
      revocation,
      membershipStamps: PrismaAuthzMembershipStampRepository.create({ database }),
    };
    if (this.options.now) ledgerOptions.now = this.options.now;
    if (this.options.newCommandId) {
      ledgerOptions.newCommandId = this.options.newCommandId;
    }
    if (this.options.ledgerPoll) ledgerOptions.poll = this.options.ledgerPoll;
    const ledger = EventingAuthzLedgerAdapter.create(ledgerOptions);
    const grantRepository = EventingAuthzGrantRepository.create({ database, writer: ledger });
    const bindingRepository =
      this.options.repositories?.bindings ?? PrismaAuthzBindingRepository.create({ database });

    const authzOptions: AuthzServiceOptions = {
      repository: EventingAuthzReadRepository.create(database),
      listing: EventingAuthzListingRepository.create(database),
      bindings: bindingRepository,
      epoch,
      isOnEngine,
      findEngineCutoverAt: (organizationId) => cutover.findFinalizedAt({ organizationId }),
    };
    if (this.options.cacheEnabled) {
      authzOptions.cacheEnabled = this.options.cacheEnabled;
    }
    if (this.options.demoProjectId) {
      authzOptions.demoProjectId = this.options.demoProjectId;
    }
    if (this.options.cacheMaxAgeMs !== undefined) {
      authzOptions.cacheMaxAgeMs = this.options.cacheMaxAgeMs;
    }
    const authz = AuthzService.create(authzOptions);
    const grants = AuthzGrantsService.create({
      repository: grantRepository,
      epoch,
      newBindingId: this.options.newBindingId,
      ledger,
      bindings: bindingRepository,
    });

    const pipeline = EventingAuthzAdapter.build({
      authzGrantsWriteStore: PrismaAuthzProjectionRepository.create(database),
      authzAuditTrailStore: PrismaAuthzAuditRepository.create(database),
    });
    const migration = LegacyImportAuthzGrantMigration.create({
      store: PrismaAuthzMigrationRepository.create(database),
      ledger: new DispatcherAuthzEngineLedger(this.options.dispatcher),
      now: this.options.now ?? Date.now,
    });

    return { authz, grants, pipeline, migration };
  }
}
