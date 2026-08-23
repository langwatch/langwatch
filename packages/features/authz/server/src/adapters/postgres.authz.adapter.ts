import {
  type AuthzGrantsService as AuthzGrantsServiceContract,
  type AuthzService as AuthzServiceContract,
} from "@langwatch/authz-contract";
import type { SystemMigration } from "@langwatch/system-migrations";
import {
  type AuthzEngineLedger,
  LegacyImportAuthzGrantMigration,
} from "../migrations/legacy-import.authz-grant.migration";
import type { AuthzEpochRedis } from "./redis.authz-epoch.adapter";
import { RedisAuthzEpochAdapter } from "./redis.authz-epoch.adapter";
import type { AuthzGrantWriteDatabase } from "../repositories/eventing/eventing.authz-grant.repository";
import { EventingAuthzGrantRepository } from "../repositories/eventing/eventing.authz-grant.repository";
import type { AuthzMigrationDatabase } from "../repositories/prisma/prisma.authz-migration.repository";
import { PrismaAuthzMigrationRepository } from "../repositories/prisma/prisma.authz-migration.repository";
import type { AuthzAuditDatabase } from "../repositories/prisma/prisma.authz-audit.repository";
import { PrismaAuthzAuditRepository } from "../repositories/prisma/prisma.authz-audit.repository";
import { PrismaAuthzProjectionRepository } from "../repositories/prisma/prisma.authz-projection.repository";
import { PrismaAuthzRevocationRepository } from "../repositories/prisma/prisma.authz-revocation.repository";
import type { AuthzRevocationTelemetry } from "../repositories/prisma/prisma.authz-revocation.repository";
import { RoutedAuthzListingRepository } from "../repositories/routed/routed.authz-listing.repository";
import { RoutedAuthzReadRepository } from "../repositories/routed/routed.authz-read.repository";
import { AuthzGrantsService } from "../services/authz-grants.service";
import {
  AuthzService,
  type AuthzServiceOptions,
} from "../services/authz.service";
import {
  type AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
  type AuthzLedgerDatabase,
  type EventingAuthzLedgerAdapterOptions,
  EventingAuthzLedgerAdapter,
} from "./eventing.authz-ledger.adapter";
import { EventingAuthzAdapter } from "./eventing.authz.adapter";
import {
  type AuthzCutoverDatabase,
  type AuthzCutoverFailureReporter,
  PostgresAuthzCutoverAdapter,
} from "./postgres.authz-cutover.adapter";

/**
 * The one structural Postgres capability the AuthZ feature needs. A runtime
 * may adapt a generated client to this type once at its composition boundary;
 * no generated database type crosses into the feature.
 */
export type PostgresAuthzDatabase = AuthzLedgerDatabase &
  AuthzGrantWriteDatabase &
  AuthzMigrationDatabase &
  AuthzCutoverDatabase &
  AuthzAuditDatabase;

export type PostgresAuthzAdapterOptions = {
  database: PostgresAuthzDatabase;
  redis: AuthzEpochRedis | null;
  dispatcher: AuthzGrantsCommandDispatcher;
  cutoverReporter: AuthzCutoverFailureReporter;
  revocationTelemetry: AuthzRevocationTelemetry;
  newBindingId: () => string;
  newCommandId?: () => string;
  now?: () => number;
  cacheEnabled?: () => boolean;
  demoProjectId?: () => string | undefined;
  cacheMaxAgeMs?: number;
  ledgerPoll?: { intervalMs: number; timeoutMs: number };
};

/** Public Eventing definition only; concrete projection/store types stay private. */
export type AuthzPipeline = ReturnType<EventingAuthzAdapter["build"]>;

export type PostgresAuthzBuild = Readonly<{
  authz: AuthzServiceContract;
  grants: AuthzGrantsServiceContract;
  pipeline: AuthzPipeline;
  migration: SystemMigration;
}>;

/**
 * The migration speaks the command vocabulary directly because it supplies
 * content-derived command IDs and business times. It resolves the same
 * dispatcher as live writes, so there is one producer topology and one
 * availability/error policy.
 */
class DispatcherAuthzEngineLedger implements AuthzEngineLedger {
  constructor(private readonly dispatcher: AuthzGrantsCommandDispatcher) {}

  private async commands(): Promise<AuthzGrantsCommandSenders> {
    return (await this.dispatcher.commands()).commands;
  }

  async attachGrant(
    args: Parameters<AuthzEngineLedger["attachGrant"]>[0],
  ): Promise<void> {
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

  async defineRole(
    args: Parameters<AuthzEngineLedger["defineRole"]>[0],
  ): Promise<void> {
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

  async changeGrantRole(
    args: Parameters<AuthzEngineLedger["changeGrantRole"]>[0],
  ): Promise<void> {
    await (
      await this.commands()
    ).changeGrantRole.send({
      tenantId: args.organizationId,
      ...args,
    });
  }

  async revokeGrant(
    args: Parameters<AuthzEngineLedger["revokeGrant"]>[0],
  ): Promise<void> {
    await (
      await this.commands()
    ).revokeGrant.send({
      tenantId: args.organizationId,
      ...args,
    });
  }

  async deleteRole(
    args: Parameters<AuthzEngineLedger["deleteRole"]>[0],
  ): Promise<void> {
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

  private constructor(private readonly options: PostgresAuthzAdapterOptions) {}

  build(): PostgresAuthzBuild {
    const epoch = RedisAuthzEpochAdapter.create({ redis: this.options.redis });
    const cutover = PostgresAuthzCutoverAdapter.create({
      database: this.options.database,
      reporter: this.options.cutoverReporter,
    });
    const selectHead = (organizationId: string) =>
      cutover.isOn({ organizationId });

    const revocation = PrismaAuthzRevocationRepository.create({
      database: this.options.database,
      telemetry: this.options.revocationTelemetry,
    });
    const ledgerOptions: EventingAuthzLedgerAdapterOptions = {
      database: this.options.database,
      dispatcher: this.options.dispatcher,
      cutover,
      epoch,
      revocation,
    };
    if (this.options.now) ledgerOptions.now = this.options.now;
    if (this.options.newCommandId) {
      ledgerOptions.newCommandId = this.options.newCommandId;
    }
    if (this.options.ledgerPoll) ledgerOptions.poll = this.options.ledgerPoll;
    const ledger = EventingAuthzLedgerAdapter.create(ledgerOptions);
    const grantRepository = EventingAuthzGrantRepository.create({
      database: this.options.database,
      writer: ledger,
      selectHead,
    });

    const authzOptions: AuthzServiceOptions = {
      repository: RoutedAuthzReadRepository.create({
        database: this.options.database,
        selectHead,
      }),
      listing: RoutedAuthzListingRepository.create({
        database: this.options.database,
        selectHead,
      }),
      epoch,
      isOnEngine: selectHead,
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
    });

    const pipeline = EventingAuthzAdapter.build({
      authzGrantsWriteStore: PrismaAuthzProjectionRepository.create(
        this.options.database,
      ),
      authzAuditTrailStore: PrismaAuthzAuditRepository.create(
        this.options.database,
      ),
    });
    const migration = LegacyImportAuthzGrantMigration.create({
      store: PrismaAuthzMigrationRepository.create(this.options.database),
      ledger: new DispatcherAuthzEngineLedger(this.options.dispatcher),
      now: this.options.now ?? Date.now,
    });

    return { authz, grants, pipeline, migration };
  }
}
