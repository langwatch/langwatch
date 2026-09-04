/**
 * The operator back office, composed as its own feature.
 *
 * `ops.*` — the scheduled-job store, the admin allow-list, the impersonation
 * ledger, the event-log explorer and the back-office reads — plus the
 * `ctx.app.ops` slice every other surface's staff check reads, and the
 * platform-tier gate the whole namespace is behind.
 *
 * It used to be composed inside the agent group, because a scenario run and the
 * queues it travels on were read through one graph. They are not one graph: ops
 * reads the operations tables, the scheduler and the shared event log, and
 * nothing a scenario composes. So it composes itself, from the shared
 * infrastructure plus the three other features' services it names below.
 *
 * ## What answers, and what refuses by name
 *
 * The Postgres half answers for real. Three runtime capabilities do not, and
 * each says so by name rather than by an empty list: this process registers no
 * projections and no subscribers (its Eventing is producer-only), it holds no
 * Grafana configuration, and it runs no system migrations. The process-manager
 * fleet and the replay runner are refused for the reasons
 * {@link unavailableOperatorRuntime} gives.
 */
import { declareAuthzMiddleware, type AuthzPermission } from "@langwatch/authz-contract";
import type { AuthService } from "@langwatch/auth-contract";
import type { EventSourcing } from "@langwatch/eventing";
import { PrismaScheduledJobStore } from "@langwatch/eventing/server";
import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import { createLogger } from "@langwatch/observability";
import {
  AdminAuditSink,
  EventExplorerClickHouseRepository,
  EventExplorerService,
  EventingOpsIntrospectionAdapter,
  NoopSchedulerWakeService,
  OpsApp,
  PostgresOpsAdapter,
  type OpsCapability,
  type OpsEventExplorer,
  type OpsProcessExplorer,
  type OpsReplayRunner,
  type OpsTrpcPorts,
} from "@langwatch/ops-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { UserService } from "@langwatch/user-contract";
import type { ClickHouseClient } from "@clickhouse/client";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import type { ApiAuditPort } from "../../api-request.policy";
import { createOpsTrpcRouter } from "./ops-trpc.mount";
import { opsPolicyKit } from "./ops-policy-kit";

const OPS_EVENT_LOG_LOOKBACK_DAYS = 365;

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
  logger: Logger;
}>;

/** The operator application, its ports and the gate the namespace is behind. */
export type ComposedOpsFeature = Readonly<{
  /** The `ctx.app.ops` slice, which other surfaces' staff checks read. */
  app: OpsApp;
  /** `ops.*`, built on the process's own root and its own operator chain. */
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createOpsTrpcRouter>;
}>;

/** Reports each operator absence, with what it costs. */
export abstract class ApiOpsAbsenceReport {
  abstract absent(capability: "operator-runtime"): void;
}

/** Writes each absence to the process log, once, at composition time. */
export class LoggedApiOpsAbsence extends ApiOpsAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiOpsAbsence {
    return new LoggedApiOpsAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "operator-runtime"): void {
    this.logger.warn({ capability }, OPS_CONSEQUENCE[capability]);
  }
}

const OPS_CONSEQUENCE = {
  "operator-runtime":
    "API process composed no operator runtime: the process-manager fleet and the projection replay runner refuse by name. The event-log explorer, the scheduled-job store, the admin allow-list, the impersonation ledger and the back-office reads answer for real.",
} as const;

/** Composes the operator surface over this process's own graph. */
export function composeOpsFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: OpsPeers;
  adminEmails: readonly string[];
  eventLogClient: ClickHouseClient | null;
  eventing: EventSourcing | undefined;
  report?: ApiOpsAbsenceReport;
}): ComposedOpsFeature {
  const collaborators: OpsFeatureCollaborators = {
    prisma: options.infrastructure.prisma,
    featureFlags: options.infrastructure.featureFlags,
    audit: options.infrastructure.audit,
    users: options.peers.users,
    auth: options.peers.auth,
    projects: options.peers.projects,
    adminEmails: options.adminEmails,
    eventLogClient: options.eventLogClient,
    eventing: options.eventing,
    logger: createLogger("langwatch:api:ops"),
  };
  // Both remaining legs are unconditional: this process runs no process
  // managers whatever it is configured with, and no replay runtime exists in
  // the tree for any process to compose.
  options.report?.absent("operator-runtime");
  const app = composeOps(collaborators, collaborators.logger);

  return {
    app,
    router: (mount) =>
      createOpsTrpcRouter({
        root: mount.root,
        protectedProcedure: mount.protectedProcedure,
        policy: opsPolicyKit(mount.middlewares, composeOpsCheck(app)),
        ports: composeOpsPorts(),
      }),
  };
}

/**
 * The operator surface on a process that composed no graph to run it over.
 *
 * The namespace still mounts and the staff check still runs, so `ctx.app.ops`
 * is never undefined and no other surface has to branch on it. Every call
 * refuses by name instead, which is what tells an operator that this process
 * holds no operations graph rather than that they are not staff.
 */
export function refusingOpsFeature(): ComposedOpsFeature {
  const app = refusingOps<OpsApp>();

  return {
    app,
    router: (mount) =>
      createOpsTrpcRouter({
        root: mount.root,
        protectedProcedure: mount.protectedProcedure,
        policy: opsPolicyKit(mount.middlewares, composeOpsCheck(app)),
        ports: composeOpsPorts(),
      }),
  };
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
 * The operator application, over the Postgres half of the operations capability.
 *
 * `redis` is deliberately NOT passed. The adapter's own invariant is that a
 * Redis connection demands a queue payload decoder, and decoding a queued job's
 * payload needs the tiered blob store — Redis blobs plus the project's own
 * object storage — which the stored-object vertical has not moved. Passing
 * Redis without the decoder throws at build; passing a decoder that cannot read
 * offloaded payloads would render a queue view that silently omits the large
 * jobs. So the queue and blob views take the package's own no-Redis form and
 * the absence is reported.
 */
function composeOps(options: OpsFeatureCollaborators, logger: Logger): OpsApp {
  const operations = PostgresOpsAdapter.create({
    adminEmails: options.adminEmails,
    database: options.prisma,
    audit: new ApiOpsAuditSink(options.audit, logger),
    users: options.users,
    auth: options.auth,
    scheduler: {
      repository: new PrismaScheduledJobStore(options.prisma),
      // The scheduler's own polling backstop preserves correctness without a
      // wake, which is what makes the noop the package's answer rather than a
      // degradation this root invented.
      wake: NoopSchedulerWakeService.create(),
      projects: options.projects,
    },
  }).build();

  return OpsApp.create({
    ops: Object.assign(operations, {
      eventExplorer: composeEventExplorer(options),
      managerExplorer: unavailableOperatorRuntime<OpsProcessExplorer>("the process-manager fleet"),
      replay: unavailableOperatorRuntime<OpsReplayRunner>("the projection replay runner"),
      snapshots: null,
    }) as OpsCapability,
    featureFlags: options.featureFlags,
    projects: options.projects,
  });
}

/**
 * The event-log explorer, over the install's own shared endpoint.
 *
 * Two collaborators, and this process holds both. The REPOSITORY takes one
 * client because its three reads are cross-tenant by design — "which
 * aggregates exist", "which match this string", "what happened to this one" —
 * and the shared endpoint is the install's own event log. A tenant-keyed
 * resolver cannot serve them: there is no project id until the operator has
 * already found the aggregate.
 *
 * The INTROSPECTION half is read off the pipeline definitions this process
 * registered, resolved lazily on every call because the agent-side pipelines
 * are registered by this same composition a few lines above. Producer-only
 * registration keeps the definition WHOLE — the runtime declines to RUN the
 * managers, it does not drop the declaration — so the projections an operator
 * picks in the replay wizard are the same names the worker folds under. A
 * process that registered none answers an empty list, which is the true answer
 * rather than a missing one.
 */
function composeEventExplorer(options: OpsFeatureCollaborators): OpsEventExplorer {
  const client = options.eventLogClient;
  if (!client) return unavailableOperatorRuntime<OpsEventExplorer>("the event-log explorer");

  return new EventExplorerService(
    new EventExplorerClickHouseRepository(client),
    EventingOpsIntrospectionAdapter.create(() => options.eventing?.definitions ?? []),
  );
}

/**
 * One operator explorer, refused by name on every method.
 *
 * A Proxy rather than twenty-seven written stand-ins: these three types are
 * structural views over the operations vocabulary, so what this file has to say
 * about them is one sentence — "this process has none" — and writing it out per
 * method would bury that in boilerplate a new method would silently escape.
 *
 * Two callers are left, and what each waits on is NOT the same thing:
 *
 *   - the PROCESS-MANAGER FLEET wants `ManagerExplorerService` over
 *     `PrismaProcessStore`, `ProcessOpsPrismaRepository` and an introspection
 *     adapter. Every part exists; what is unsettled is whether a PRODUCER-ONLY
 *     process should render a fleet at all — it runs none of the machines the
 *     table lists, and the rows would be the worker's. That is a decision, not
 *     a wiring gap, and it is deliberately left open.
 *   - the REPLAY RUNNER is the one genuine absence: `OpsReplayRuntimePort` has
 *     no implementation anywhere in the tree, so `ReplayService` cannot be
 *     constructed at all.
 *
 * The EVENT-LOG EXPLORER used to be a third. It waited on an accessor for the
 * shared endpoint, which `ApiClickHouseInfrastructure` now publishes as
 * `resolveSharedClient`; it is composed by {@link composeEventExplorer} and
 * refuses only where a deployment has no shared endpoint to read.
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
 * The four operator ports, each answering for the PROCESS rather than for the
 * operations service.
 *
 * Three of them describe a runtime this process does not run: it registers no
 * pipelines (its Eventing is producer-only), it holds no Grafana configuration,
 * and it runs no system migrations. Each says so by name or by an explicit
 * "none", rather than by an empty list that reads as "nothing is registered".
 */
function composeOpsPorts(): OpsTrpcPorts {
  return {
    // An explicitly empty registry, not a refusal: this process genuinely
    // registers no projections and no subscribers, so "none" is the true
    // answer rather than a missing one.
    listPipelineRegistrations: () => ({ projections: [], eventSubscribers: [] }),
    getEventLogSearchWindow: () => ({
      searchLookbackDays: OPS_EVENT_LOG_LOOKBACK_DAYS,
      // Null is "we cannot say", which is the honest answer for a process that
      // reads no table TTL configuration.
      hotTierDays: null,
      hotTierEnvVar: null,
    }),
    tryGetGrafanaLinkConfig: () => null,
    systemMigrations: unavailableOperatorRuntime<OpsTrpcPorts["systemMigrations"]>(
      "The system-migrations runner",
    ),
  };
}

/**
 * The platform-tier operator gate.
 *
 * Custom rather than a permission, and declared as such so the router sweep
 * counts it: it resolves the deployment's admin allow-list into an ops scope no
 * procedure input carries. Two details it must keep, because both are
 * load-bearing:
 *
 *  - the IMPERSONATOR's own grant carries through. An impersonation session
 *    rewrites the session user to the customer being debugged, so reading only
 *    that identity would hide the operator surface at exactly the moment an
 *    admin opened it to look at somebody's account.
 *  - `throwOnDeny: false` REPORTS "no access" instead of refusing, which is
 *    what lets the global menu poll the scope on every page load.
 */
function composeOpsCheck(ops: OpsApp) {
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

        const scope: { kind: "platform" | "none" } =
          ops.isAdmin({ email: user.email }) || ops.isAdmin({ email: user.impersonator?.email })
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
