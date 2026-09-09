/**
 * The operator back office, composed as its own feature.
 */
import { declareAuthzMiddleware, type AuthzPermission } from "@langwatch/authz-contract";
import type { AuthService } from "@langwatch/auth-contract";
import type { EventSourcing } from "@langwatch/eventing";
import { PrismaProcessStore, PrismaScheduledJobStore } from "@langwatch/eventing/server";
import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import { createLogger } from "@langwatch/observability";
import {
  AdminAuditSink,
  EventExplorerClickHouseRepository,
  EventExplorerService,
  EventingOpsIntrospectionAdapter,
  ManagerExplorerService,
  NoopSchedulerWakeService,
  OpsApp,
  PostgresOpsAdapter,
  ProcessAuditRepository,
  OpsSnapshotRedisPort,
  ProcessOpsPrismaRepository,
  RedisOpsSnapshotAdapter,
  type OpsCapability,
  type OpsEventExplorer,
  type OpsProcessExplorer,
  type OpsReplayRunner,
} from "@langwatch/ops-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { UserService } from "@langwatch/user-contract";
import type { ClickHouseClient } from "@clickhouse/client";
import type { RedisConnection } from "@langwatch/redis-client";
import { ResourceScope } from "@langwatch/runtime-composition";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiAuditPort } from "../../api-request.policy.ts";

/** The other features' services the operator surface reaches, named one by one. */
export type OpsPeers = Readonly<{
  /** The people a back-office read names, and the impersonation subject. */
  users: UserService;
  /** The browser session an impersonation is started and stopped against. */
  auth: AuthService;
  /** The projects a scheduled job and a back-office row are scoped to. */
  projects: ProjectService;
}>;

/** Everything the operator surface is composed from besides its peers. */
export type OpsFeatureCollaborators = Readonly<{
  prisma: ApiTrpcInfrastructure["prisma"];
  featureFlags: ApiTrpcInfrastructure["featureFlags"];
  audit: ApiAuditPort | undefined;
  /** The shared audit log every operator act is recorded on. */
  auditLog: ApiTrpcInfrastructure["auditLog"];
  users: UserService;
  auth: AuthService;
  projects: ProjectService;
  /** The deployment's operator allow-list, matched on a person's email. */
  adminEmails: readonly string[];
  /**
   * The install's shared event log. Cross-tenant by design: an operator has no
   * project id until they have already found the aggregate.
   */
  eventLogClient: ClickHouseClient | null;
  /** This process's own registrations, for the explorer's introspection half. */
  eventing: EventSourcing | undefined;
  /**
   * The connection the ops snapshot is published to by the worker. Reading it
   * is all this process does with it: the dashboard, its badge counts and its
   * live stream are all one artifact the writer already computed.
   */
  redis: RedisConnection | null;
  logger: Logger;
}>;

import type { ComposedOpsFeature } from "./ops.composition.types.ts";

/** Reports each operator absence, with what it costs. */
export abstract class ApiOpsAbsenceReport {
  abstract absent(capability: "replay-runtime" | "ops-snapshot"): void;
}

/** Writes each absence to the process log, once, at composition time. */
export class LoggedApiOpsAbsence extends ApiOpsAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiOpsAbsence {
    return new LoggedApiOpsAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "replay-runtime" | "ops-snapshot"): void {
    this.logger.warn({ capability }, OPS_CONSEQUENCE[capability]);
  }
}

const OPS_CONSEQUENCE = {
  "replay-runtime":
    "API process composed no projection replay runner: every replay call refuses by name. The process-manager fleet, the event-log explorer, the scheduled-job store, the admin allow-list, the impersonation ledger and the back-office reads answer for real.",
  "ops-snapshot":
    "API process composed no Redis: the operator dashboard, its badge counts and its live stream have no snapshot to read, so they answer empty rather than showing what the worker computed.",
} as const;

/** Composes the operator surface over this process's own graph. */
export function composeOpsFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: OpsPeers;
  adminEmails: readonly string[];
  eventLogClient: ClickHouseClient | null;
  eventing: EventSourcing | undefined;
  /** The connection the worker publishes the ops snapshot on, where one exists. */
  redis?: RedisConnection | null;
  /**
   * The process's own scope, which the snapshot reader's poll is registered on.
   * Without it the interval outlives a failed boot and keeps reading a Redis
   * the composition already closed, so the process never exits.
   */
  resources?: ResourceScope;
  report?: ApiOpsAbsenceReport;
}): ComposedOpsFeature {
  const collaborators: OpsFeatureCollaborators = {
    prisma: options.infrastructure.prisma,
    featureFlags: options.infrastructure.featureFlags,
    audit: options.infrastructure.audit,
    auditLog: options.infrastructure.auditLog,
    users: options.peers.users,
    auth: options.peers.auth,
    projects: options.peers.projects,
    adminEmails: options.adminEmails,
    eventLogClient: options.eventLogClient,
    eventing: options.eventing,
    redis: options.redis ?? null,
    logger: createLogger("langwatch:api:ops"),
  };
  // Unconditional: no replay runtime exists in the tree for any process to
  // compose, whatever this one is configured with.
  options.report?.absent("replay-runtime");
  if (!collaborators.redis) options.report?.absent("ops-snapshot");
  const app = composeOps(collaborators, collaborators.logger, options.resources);

  return { app };
}

/**
 * The operator surface on a process that composed no graph to run it over. The
 * staff check still runs, so `ctx.app.ops` is never undefined and no other
 * surface has to branch on it.
 */
export function refusingOpsFeature(): ComposedOpsFeature {
  return { app: refusingOps<OpsApp>() };
}

/** One operator application, refused by name on every member. */
function refusingOps<T>(): T {
  return new Proxy(
    {},
    {
      get: () => (): never => {
        throw new ApiOpsUnavailableError("The operator back office");
      },
      has: () => true,
    },
  ) as T;
}

// ---------------------------------------------------------------------------
// The operator back office
// ---------------------------------------------------------------------------

/**
 * The operator application, over this process's own connections.
 */
function composeOps(
  options: OpsFeatureCollaborators,
  logger: Logger,
  resources: ResourceScope | undefined,
): OpsApp {
  const snapshots = options.redis
    ? RedisOpsSnapshotAdapter.create({ redis: ApiOpsSnapshotRedis.create(options.redis) })
    : null;
  // Polling starts here rather than on first read: the dashboard, the badge and
  // the live stream all read the last artifact this process pulled, so a reader
  // that had never polled would answer an empty fleet on the first open.
  snapshots?.start().catch((error) => {
    logger.error({ error }, "failed to start the ops snapshot reader");
  });
  // Registered in the same breath as the start, so the poll is released whether
  // this process drains or its composition fails half-built.
  if (snapshots) resources?.own("api ops snapshot reader", () => snapshots.stop());

  return OpsApp.create({
    dependencies: {
      users: options.users,
      auth: options.auth,
      projects: options.projects,
      auditLog: options.auditLog,
    },
    infrastructure: {
      createCapability: (peers): OpsCapability => {
        const operations = PostgresOpsAdapter.create({
          adminEmails: options.adminEmails,
          // Once the connection projection decides sign-in, editing the legacy
          // `ssoDomain`/`ssoProvider` strings changes nothing a person experiences,
          // so the backoffice refuses rather than accepting a no-op (ADR-117 §5).
          // The flip is one value in one place, which is what makes it reversible in
          // a hurry.
          legacySsoStringWritesRetired: process.env.SSOCONN_ROUTING === "enforce",
          database: options.prisma,
          audit: new ApiOpsAuditSink(options.audit, logger),
          auditLog: peers.auditLog,
          users: peers.users,
          auth: peers.auth,
          scheduler: {
            repository: new PrismaScheduledJobStore(options.prisma),
            // The scheduler's own polling backstop preserves correctness without a
            // wake, which is what makes the noop the package's answer rather than a
            // degradation this root invented.
            wake: NoopSchedulerWakeService.create(),
            projects: peers.projects,
          },
        }).build();

        return {
          ...operations,
          eventExplorer: composeEventExplorer(options),
          managerExplorer: composeManagerExplorer(options),
          replay: unavailableOperatorRuntime<OpsReplayRunner>("the projection replay runner"),
          // Read-only here: the worker holds the lease and writes the artifact, and
          // a second writer would publish a second answer for one fleet.
          snapshots,
        };
      },
      featureFlags: options.featureFlags,
      eventingIntrospection: EventingOpsIntrospectionAdapter.create(
        () => options.eventing?.definitions ?? [],
      ),
    },
    config: undefined,
    resources: new ResourceScope(),
  });
}

/**
 * The event-log explorer, over the install's own shared endpoint. Two collaborators, and
 * this process holds both.
 */
function composeEventExplorer(options: OpsFeatureCollaborators): OpsEventExplorer {
  const client = options.eventLogClient;
  if (!client) return unavailableOperatorRuntime<OpsEventExplorer>("the event-log explorer");

  return EventExplorerService.create({
    repo: EventExplorerClickHouseRepository.create({ client }),
    introspection: EventingOpsIntrospectionAdapter.create(
      () => options.eventing?.definitions ?? [],
    ),
  });
}

/**
 * The process-manager fleet, over the same rows the managers themselves run on: the
 * instance store, the fleet counts, the operator audit trail, and this process's own
 * pipeline registrations.
 */
function composeManagerExplorer(options: OpsFeatureCollaborators): OpsProcessExplorer {
  return ManagerExplorerService.create({
    store: PrismaProcessStore.create({ database: options.prisma }),
    fleet: ProcessOpsPrismaRepository.create({ prisma: options.prisma }),
    audit: ProcessAuditRepository.create({ prisma: options.prisma, auditLog: options.auditLog }),
    introspection: EventingOpsIntrospectionAdapter.create(
      () => options.eventing?.definitions ?? [],
    ),
  });
}

/**
 * One operator explorer, refused by name on every method.
 */
function unavailableOperatorRuntime<T>(capability: string): T {
  return new Proxy(
    {},
    {
      get: () => () => Promise.reject(new ApiOpsUnavailableError(capability)),
      has: () => true,
    },
  ) as T;
}

/**
 * The four Redis commands the snapshot artifact is held under, named as the package asks
 * for them. `set` and `incr` belong to the writer, which is the worker's; this process
 * composes the whole port because the artifact is one key shape, not two.
 */
class ApiOpsSnapshotRedis extends OpsSnapshotRedisPort {
  static create(redis: RedisConnection): ApiOpsSnapshotRedis {
    return new ApiOpsSnapshotRedis(redis);
  }

  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown> {
    return this.redis.eval(script, numberOfKeys, ...args) as Promise<unknown>;
  }

  set(
    key: string,
    value: string,
    expiryMode: "EX",
    expirySeconds: number,
    condition: "NX",
  ): Promise<unknown> {
    return this.redis.set(key, value, expiryMode, expirySeconds, condition);
  }

  tryGet(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }
}

/** Bridges the operations package's audit sink onto this process's trail. */
class ApiOpsAuditSink extends AdminAuditSink {
  constructor(
    private readonly audit: ApiAuditPort | undefined,
    private readonly logger: Logger,
  ) {
    super();
  }

  async record(entry: {
    userId: string;
    action: string;
    args?: unknown;
    req?: unknown;
  }): Promise<void> {
    if (!this.audit) {
      this.logger.warn(
        { action: entry.action },
        "operator action not audited: this process composed no audit sink",
      );
      return;
    }
    await this.audit.record(entry as unknown as Parameters<ApiAuditPort["record"]>[0]);
  }
}

/**
 * The platform-tier operator gate. Custom rather than a permission, and declared as such
 * so the router sweep counts it: it resolves the deployment's admin allow-list into an
 * ops scope no procedure input carries.
 */
export function composeOpsCheck(ops: Pick<OpsApp, "isAdmin">) {
  return ({
    permission,
    throwOnDeny = true,
  }: {
    permission: AuthzPermission;
    throwOnDeny?: boolean;
  }) =>
    declareAuthzMiddleware(
      {
        kind: "custom",
        reason:
          "platform-tier operator check: resolves the admin allow-list into an ops scope no procedure input carries",
        permissions: [permission],
      },
      async ({ ctx, next }: { ctx: unknown; next: () => Promise<unknown> }) => {
        const context = ctx as {
          session?: {
            user?: { email?: string | null; impersonator?: { email?: string | null } };
          } | null;
          opsScope?: { kind: "platform" | "none" };
          permissionChecked?: boolean;
        };
        const user = context.session?.user;
        if (!user) throw new ApiOpsUnauthenticatedError();

        const isPlatformAdmin =
          ops.isAdmin({ email: user.email }) || ops.isAdmin({ email: user.impersonator?.email });
        const scope: { kind: "platform" | "none" } = isPlatformAdmin
          ? { kind: "platform" }
          : { kind: "none" };

        if (scope.kind === "none" && throwOnDeny) {
          throw new ApiOperatorForbiddenError();
        }

        context.opsScope = scope;
        // The fail-closed backstop reads this: without it the chain would
        // refuse a procedure this check just passed.
        context.permissionChecked = true;
        return next();
      },
    );
}

/** An operator capability this process does not run, refused by name. */
class ApiOpsUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiOpsUnavailableError";
  }
}

/** The operator surface reached without a signed-in session. */
class ApiOpsUnauthenticatedError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "Sign in to reach the operator surface.", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ApiOpsUnauthenticatedError";
  }
}

/** A signed-in caller who is not on the deployment's operator allow-list. */
class ApiOperatorForbiddenError extends HandledError {
  declare readonly code: "forbidden";

  constructor() {
    super("forbidden", "You do not have permission to access ops resources.", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ApiOperatorForbiddenError";
  }
}
