/**
 * The tenancy graph, composed over this process's own Prisma client.
 *
 * This is the precondition the model gateway named and could not get:
 * `worker-model-provider.composition.ts` refuses to compose without
 * `projects`, `organizations` and `authorization`, so every deployment ran
 * with `withoutModelGateway("no-tenancy")` in its logs, topic clustering
 * refusing every model question and a Langy conversation keeping whatever
 * title it was given.
 *
 * The wall had two bricks and both are gone:
 *
 *  - `PostgresOrganizationAdapter` needs an `AuthzService` and an
 *    `AuthzGrantsService`, which only `PostgresAuthzAdapter` builds.
 *  - `PostgresAuthzAdapter` used to need a `prom-client` `Registry`, because
 *    its cutover reporter and revocation telemetry arrived as counters rather
 *    than as a port. A worker deliberately holds no process-global registry —
 *    two copies of `prom-client` serve an empty exposition and nobody notices
 *    — so that requirement made the feature uncomposable here. It is now
 *    `AuthzMetricsPort`, and this process passes none: the two series are
 *    operational, the API tier already renders them, and the behaviour behind
 *    them (the cutover warning, the direct-write record) still happens.
 *
 * The three services are returned as ONE value for the reason `apps/api`'s
 * `ApiTenancyComposition` returns its three that way: they are one graph. The
 * project service resolves a project's organization through the organization
 * service and the permission service answers for both, so a consumer handed
 * halves from two compositions would derive a scope nothing else in the
 * process agrees with.
 *
 * Every collaborator below the two adapters is the feature package's own —
 * the personal-workspace, team and group identity minters and the project
 * credential format. They mint PERSISTED formats, so a composition root that
 * restated any of them would write rows the other tier's queries do not find.
 */
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import { AuthzLedgerUnavailableError } from "@langwatch/authz-contract";
import {
  AuthzGrantsCommandDispatcher,
  KsuidAuthzBindingIdAdapter,
  PostgresAuthzAdapter,
  type AuthzGrantsCommandSenders,
} from "@langwatch/authz-server";
import type { AutomationSecretCrypto } from "@langwatch/automation-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  GroupIdentityAdapter,
  OrganizationSettingsSecretPort,
  PersonalWorkspaceDiagnosticsAdapter,
  PersonalWorkspaceIdentityAdapter,
  PostgresOrganizationAdapter,
  TeamIdentityAdapter,
} from "@langwatch/organization-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { ProjectService } from "@langwatch/project-contract";
import {
  PostgresProjectAdapter,
  ProjectCredentialsAdapter,
  ProjectDiagnosticsPort,
} from "@langwatch/project-server";
import type { RedisConnection } from "@langwatch/redis-client";
import type { WorkerConfig } from "../platform/config/worker.config";

/**
 * Reports what a composed tenancy graph does NOT serve on this tier.
 *
 * Stated at boot rather than discovered on the one call that raises: the graph
 * is composed either way and every read answers, so what this names is the one
 * half of it that does not.
 */
export abstract class WorkerTenancyAbsenceReportPort {
  /**
   * No grant COMMAND PRODUCER: this process is the ledger's consumer.
   *
   * `AuthzWorkerFeatureInstaller` registers the grants pipeline so this process
   * FOLDS grant events into the read model and the audit trail, and it
   * deliberately resolves no command senders — a process that writes no grants
   * has nobody to hand them to. Everything the tenancy graph is composed for
   * here is a read: which organization a project belongs to, which scopes a
   * provider row is visible in, whether a caller may read it.
   *
   * What that costs, exactly: a grant change for an organization ALREADY ON
   * THE LEDGER refuses by name with `authz_ledger_unavailable`. An
   * organization that has not cut over is unaffected — the ledger writer takes
   * its imperative Postgres path for those, here as on the API tier, and the
   * next genesis pass adopts the rows. Nothing in this process makes either
   * write today; the write half is composed because
   * `PostgresOrganizationAdapter` requires it structurally. Naming it is what
   * keeps a future caller from discovering the refusal on a customer's
   * membership change.
   */
  abstract withoutGrantWrites(): void;
}

/**
 * The tenancy graph this process composes, as one value.
 *
 * `authorization` rather than `authz` because that is the name the model
 * gateway's own option takes (`WorkerModelProviderTenancy`), and this value is
 * handed to it whole rather than spread into three arguments a caller could
 * mix.
 */
export type WorkerTenancy = Readonly<{
  projects: ProjectService;
  organizations: OrganizationService;
  authorization: AuthzService;
  /** The write half, composed but refusing; see `withoutGrantWrites`. */
  grants: AuthzGrantsService;
}>;

export type WorkerTenancyCompositionOptions = Readonly<{
  /**
   * The ONE typed Prisma client this process opened.
   *
   * The connection rather than the structural `WorkerDatabaseCompositionOptions`
   * every other composition here takes, and that is not an oversight:
   * `PostgresOrganizationAdapter` and `PostgresProjectAdapter` both declare
   * `database: PrismaClient` by type, so this is the one seam in the package
   * that needs the generated client itself. Passing it through means no cast
   * sits at the repository boundary — which is exactly what the typed-Prisma
   * seam asks for.
   */
  connection: PrismaConnection;
  /**
   * The deployment's stored-secret cipher, for an organization's settings.
   *
   * The SAME `resolveWorkerStoredSecretCipher` every other stored-secret
   * vertical in this process reads under. An organization's stored settings
   * and a project's stored secret are encrypted by one algorithm under one
   * key, so a second cipher here would write settings the other tier cannot
   * read. That the two ports are the same two methods is a decision, so it is
   * stated at this seam rather than assumed by an adapter that happens to fit
   * both.
   */
  encryption: AutomationSecretCrypto;
  /**
   * The queue's own Redis, or nothing on a deployment that configured none.
   *
   * It carries the permission cache's epoch counter and nothing else. Absent
   * disables the cache rather than failing a read, which is the same shape
   * `apps/api` composes.
   */
  redis?: RedisConnection | null;
  config: WorkerConfig;
  absence?: WorkerTenancyAbsenceReportPort;
  logger?: Logger;
}>;

/**
 * Composes the graph where this process opened a client, and says so when it
 * did not.
 *
 * There is one gate and it is the database, because there is nothing smaller
 * to compose: an organization service with no client answers no organization,
 * and a project service over it resolves every project to no scopes at all —
 * which reads on the screen as "you have configured no providers" for a
 * customer who has configured several.
 */
export function tryCreateWorkerTenancy(
  options: Omit<WorkerTenancyCompositionOptions, "connection"> & {
    connection: PrismaConnection | undefined;
  },
): WorkerTenancy | undefined {
  if (!options.connection) return undefined;
  return createWorkerTenancy({ ...options, connection: options.connection });
}

/** Composes the organization, project and permission services from one client. */
export function createWorkerTenancy(options: WorkerTenancyCompositionOptions): WorkerTenancy {
  const logger = options.logger ?? createLogger(options.config.serviceName);
  const database = options.connection.client;
  const bindingIds = KsuidAuthzBindingIdAdapter.create();

  options.absence?.withoutGrantWrites();

  const built = PostgresAuthzAdapter.create({
    // The typed client satisfies the feature's structural database port on its
    // own terms: `PostgresAuthzDatabase` describes its delegates in `unknown`
    // arguments so no generated type crosses into the package, and a guarded
    // `PrismaClient` is assignable to every one of them. No assertion sits at
    // this seam, and none should.
    database,
    redis: options.redis ?? null,
    dispatcher: new WorkerUnregisteredAuthzGrantCommands(),
    // No metrics: this process renders an empty Prometheus exposition on
    // purpose and every series it records goes out over OTLP, so a registry
    // handed to AuthZ here would collect samples nothing scrapes.
    newBindingId: () => bindingIds.newBindingId(),
    cacheEnabled: () => options.config.authz.epochCacheEnabled,
    demoProjectId: () => options.config.authz.demoProjectId,
  }).build();

  const organizations = PostgresOrganizationAdapter.create({
    database,
    identities: PersonalWorkspaceIdentityAdapter.create(),
    teamIdentities: TeamIdentityAdapter.create(),
    groupIdentities: GroupIdentityAdapter.create(),
    authz: built.authz,
    grants: built.grants,
    settingsSecrets: WorkerOrganizationSettingsSecretAdapter.create({
      encryption: options.encryption,
    }),
    diagnostics: PersonalWorkspaceDiagnosticsAdapter.create(logger),
  }).build();

  // `keyMap` and `storedObjects` are deliberately absent, exactly as they are
  // on the API tier: both are reach-outs a project DELETION makes — the
  // ClickHouse key map and the stored-object application — and the adapter
  // declares them optional because absence is a supported shape. This process
  // deletes no project.
  const projects = PostgresProjectAdapter.create({
    database,
    credentials: ProjectCredentialsAdapter.create(),
    organizations,
    diagnostics: WorkerProjectDiagnostics.create(logger),
  }).build();

  return { projects, organizations, authorization: built.authz, grants: built.grants };
}

/**
 * Refuses a grant command immediately and by name.
 *
 * The packaged `EventingAuthzCommandDispatcherAdapter` waits five seconds for
 * a `connect` that a producer's registration performs, then refuses. That is
 * the right shape where the connection is merely LATE; here it never comes,
 * because this process registers the grants pipeline as a CONSUMER and
 * resolves no senders — so a wait would stall a caller for five seconds on the
 * way to the same answer. The error is the contract's own, so a caller that
 * can retry reads the same code it would read from a tier whose ledger was
 * genuinely unavailable.
 */
class WorkerUnregisteredAuthzGrantCommands extends AuthzGrantsCommandDispatcher {
  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    throw new AuthzLedgerUnavailableError();
  }
}

/**
 * The organization service's settings cipher, delegated to this process's own.
 *
 * `OrganizationSettingsSecretPort` and the stored-secret cipher are the same
 * two methods over the same at-rest format. The two live in packages that may
 * not depend on each other, so what crosses between them is this root's
 * decision that they are one cipher.
 */
class WorkerOrganizationSettingsSecretAdapter extends OrganizationSettingsSecretPort {
  static create(options: {
    encryption: AutomationSecretCrypto;
  }): WorkerOrganizationSettingsSecretAdapter {
    return new WorkerOrganizationSettingsSecretAdapter(options.encryption);
  }

  private constructor(private readonly encryption: AutomationSecretCrypto) {
    super();
  }

  encrypt(value: string): string {
    return this.encryption.encrypt(value);
  }

  decrypt(value: string): string {
    return this.encryption.decrypt(value);
  }
}

/**
 * The project service's diagnostics, on this process's own structured logger.
 *
 * `capture` exists because a project operation can fail in a way nothing above
 * it can act on, and the platform app answered that by handing the error to
 * Sentry. This tier has no Sentry; what it has is the logger every other
 * failure in the process reaches.
 */
class WorkerProjectDiagnostics extends ProjectDiagnosticsPort {
  static create(logger: Logger): WorkerProjectDiagnostics {
    return new WorkerProjectDiagnostics(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  error(context: Record<string, unknown>, message: string): void {
    this.logger.error(context, message);
  }

  capture(error: Error, context: Record<string, unknown>): void {
    this.logger.error({ ...context, error }, "Project operation failed");
  }
}
