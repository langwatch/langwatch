import {
  type AuthzGrantsService as AuthzGrantsServiceContract,
  type AuthzService as AuthzServiceContract,
} from "@langwatch/authz-contract";
import type { SystemMigration } from "@langwatch/system-migrations";
import type { StaticPipelineDefinition } from "@langwatch/eventing";
import { type AuthzMetricsPort, UncountedAuthzMetrics } from "../ports/authz-metrics.port";
import type { PostgresAuthzDatabase } from "../ports/postgres-authz-database.port";
import type { AuthzDatabase } from "../repositories/authz-read.repository";
import { PrismaAuthzReadRepository } from "../repositories/prisma/prisma.authz-read.repository";
import type {
  AuthzGrantsCommandDispatcher,
  AuthzGrantsCommandSenders,
} from "../ports/authz-grants-command-dispatcher.port";
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
import {
  type AuthzProjectionDatabase,
  PrismaAuthzProjectionRepository,
} from "../repositories/prisma/prisma.authz-projection.repository";
import {
  type AuthzBindingDatabase,
  PrismaAuthzBindingRepository,
} from "../repositories/prisma/prisma.authz-binding.repository";
import { PrismaAuthzRevocationRepository } from "../repositories/prisma/prisma.authz-revocation.repository";
import { RoutedAuthzListingRepository } from "../repositories/routed/routed.authz-listing.repository";
import { RoutedAuthzReadRepository } from "../repositories/routed/routed.authz-read.repository";
import { AuthzGrantsService } from "../services/authz-grants.service";
import { AuthzService, type AuthzServiceOptions } from "../services/authz.service";
import {
  type AuthzLedgerDatabase,
  type EventingAuthzLedgerAdapterOptions,
  EventingAuthzLedgerAdapter,
} from "./eventing.authz-ledger.adapter";
import { EventingAuthzAdapter } from "./eventing.authz.adapter";
import {
  type AuthzCutoverDatabase,
  PostgresAuthzCutoverAdapter,
} from "./postgres.authz-cutover.adapter";
import { ObservabilityAuthzCutoverAdapter } from "./observability.authz-cutover.adapter";
import { ObservabilityAuthzRevocationAdapter } from "./observability.authz-revocation.adapter";

/**
 * The one structural Postgres capability the AuthZ feature needs. A runtime
 * may adapt a generated client to this type once at its composition boundary;
 * no generated database type crosses into the feature.
 */
type InternalPostgresAuthzDatabase = AuthzLedgerDatabase &
  AuthzGrantWriteDatabase &
  AuthzMigrationDatabase &
  AuthzCutoverDatabase &
  AuthzAuditDatabase &
  AuthzBindingDatabase &
  AuthzProjectionDatabase;

export type PostgresAuthzAdapterOptions = {
  database: PostgresAuthzDatabase;
  redis: AuthzEpochRedis | null;
  dispatcher: AuthzGrantsCommandDispatcher;
  /**
   * Where the two AuthZ counters go, on a process that renders any.
   *
   * Optional, and that is the whole point of the port: the counters are
   * operational rather than load-bearing, so a process with no metric registry
   * composes the same graph and counts nothing. What is NOT optional is the
   * behaviour behind them — the cutover warning still logs and the revocation
   * still records — because both are built here from this one input rather
   * than handed in ready-made.
   */
  metrics?: AuthzMetricsPort;
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
   * see what the engine sees (the share ledger's cut-over check does). The
   * repository stays private; this is the one door to it.
   */
  static createReader({ database }: { database: PostgresAuthzDatabase }) {
    return PrismaAuthzReadRepository.create(database as unknown as AuthzDatabase);
  }

  private constructor(private readonly options: PostgresAuthzAdapterOptions) {}

  build(): PostgresAuthzBuild {
    const database = this.options.database as unknown as InternalPostgresAuthzDatabase;
    const metrics = this.options.metrics ?? UncountedAuthzMetrics.create();
    const epoch = RedisAuthzEpochAdapter.create({ redis: this.options.redis });
    const cutover = PostgresAuthzCutoverAdapter.create({
      database,
      // Composed here rather than received, so the WHEN of each counter is
      // described once for every process. A caller that passed its own
      // reporter would be a second description of "warn, then increment".
      reporter: ObservabilityAuthzCutoverAdapter.create({
        counter: metrics.engineGateReadFailureCounter(),
      }),
    });
    const selectHead = (organizationId: string) => cutover.isOn({ organizationId });

    const revocation = PrismaAuthzRevocationRepository.create({
      database,
      telemetry: ObservabilityAuthzRevocationAdapter.create({
        counter: (reason) => metrics.revocationCounter(reason),
      }),
    });
    const ledgerOptions: EventingAuthzLedgerAdapterOptions = {
      database,
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
      database,
      writer: ledger,
      selectHead,
    });
    const bindingRepository = PrismaAuthzBindingRepository.create(database);

    const authzOptions: AuthzServiceOptions = {
      repository: RoutedAuthzReadRepository.create({
        database,
        selectHead,
      }),
      listing: RoutedAuthzListingRepository.create({
        database,
        selectHead,
      }),
      bindings: bindingRepository,
      epoch,
      isOnEngine: selectHead,
      tryGetEngineCutoverAt: (organizationId) => cutover.tryGetFinalizedAt({ organizationId }),
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
