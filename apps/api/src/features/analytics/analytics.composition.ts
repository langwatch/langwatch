/**
 * The analytics half of {@link ApiTrpcCollaborators}: the two application
 * slices the charted surfaces read off `ctx.app`, and the four port groups the
 * `analytics.*` and `graphs.*` namespaces reach for.
 *
 * Five packaged surfaces are served from one composition, and they are one
 * composition because they are one graph:
 *
 *   analytics.getTimeseries / dataForFilter / topUsedDocuments / feedbacks
 *   analytics.langWatchQL.*            (the workbench)
 *   analytics.savedWorkbenchCharts.*   (Dashboard's, under Analytics' namespace)
 *   graphs.*                           (a dashboard's chart-builder cards)
 *   dashboards.*                       (through {@link DashboardApp})
 *
 * The workbench's saved charts are validated by the SAME LangWatchQL service a
 * workbench statement runs on, and a dashboard's placeable card kinds are
 * gated by the SAME rollout flag the workbench navigation reads. A process that
 * composed those separately would have two answers to one question, and the
 * one that drifts is always the copy — so they are built here once and handed
 * out.
 *
 * ## Two ClickHouse identities, never one
 *
 * The charted reads and the filter pickers run on the APPLICATION's connection:
 * the queries over it are ours, so it may read what the schema holds. A
 * member's own submitted SQL runs on a SECOND, restricted identity — a
 * different database user with a row policy and a read-only profile — which
 * this module opens from its own configuration and never derives from the
 * first. That separation is the last line of defence for customer-authored
 * SQL, and it is structural here: the two arrive as different options and
 * neither can stand in for the other.
 *
 * ## What arrives as a port, and why
 *
 * Three capabilities belong to verticals this process does not yet compose, so
 * they arrive as options and DEGRADE FAIL-CLOSED when a deployment has none:
 * the member's content protections, the alert watching a graph card, and the
 * secret redaction over that alert's parameters. Each default is the safe
 * answer rather than the convenient one — content hidden, no alert, every
 * parameter dropped — because the unsafe direction of each is a disclosure.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import { filterFieldsEnum } from "@langwatch/analytics-contract";
import {
  AnalyticsAdapter,
  AnalyticsApp,
  FilterOptionsAdapter,
  LangWatchQLAdapter,
  LangWatchQLNotEnabledError,
  lwqlEnabled,
  MAX_LWQL_LENGTH,
  filterFieldRequiresKey,
  filterFieldRequiresSubkey,
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
  sharedFiltersInputSchema,
  timeseriesInputSchema,
  type AnalyticsTrpcPorts,
  type LangWatchQLService,
  type LangWatchQLTrpcPorts,
} from "@langwatch/analytics-server";
import type { Trigger } from "@langwatch/automation-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import {
  AnalyticsSavedWorkbenchChartPolicyAdapter,
  DashboardApp,
  mapDashboardSavedWorkbenchChartError,
  PostgresDashboardAdapter,
  WorkbenchAccessPort,
  WorkbenchAwareGraphVisibilityAdapter,
  type DashboardGraphAlertLookup,
  type GraphTrpcPorts,
  type SavedWorkbenchChartTrpcPorts,
} from "@langwatch/dashboard-server";
import {
  isContentVisible,
  isContentVisibleToPublic,
  type ContentCategory,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { PrismaDataPrivacyResolutionAdapter } from "@langwatch/data-privacy-server";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { ResourceScope } from "@langwatch/runtime-composition";
import { nanoid } from "nanoid";
import type { z } from "zod";
import type { ApiLangWatchQLConfigResolution } from "../../platform/config/api.config";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcFeatureMount } from "../../api.application";
import {
  createGraphTrpcRouter,
  createSavedWorkbenchChartTrpcRouter,
} from "../dashboard/dashboard-trpc.mount";
import { createAnalyticsTrpcRouter, createLangWatchQLTrpcRouter } from "./analytics-trpc.mount";

/**
 * The retention floor an evaluation read is bounded by when a project names no
 * policy of its own.
 *
 * The platform app's `PLATFORM_DEFAULT_RETENTION_DAYS`. Stated rather than
 * imported: the retention vertical has not moved, and a floor that silently
 * defaulted to the adapter's own 30 would quietly shorten every chart's window
 * on a deployment that never changed a setting.
 */
const DEFAULT_RETENTION_DAYS = 49;

/** Everything the analytics half is composed from. */
export type AnalyticsFeatureCollaborators = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The same AuthZ service the REST doors and the declared checks authorize through. */
  authz: AuthzService;
  /** Resolves a project's organization, for the rollout gate's targeting. */
  projects: ProjectService;
  /**
   * The process's ONE rollout store, composed by the feature-flag feature.
   *
   * Taken rather than built: the workbench gate and the browser's own flag read
   * must never disagree about whether an account is inside the rollout, and
   * this half used to build a second `PostgresFeatureFlagAdapter` of its own.
   */
  featureFlags: FeatureFlagService;
  /** The application's own ClickHouse, or `null` where the process composed none. */
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  /** The restricted identity a member's own SQL runs as. */
  langWatchQL: ApiLangWatchQLConfigResolution | undefined;
  /** Releases the restricted identity's transport with the rest of the process. */
  resources: ResourceScope;
  /**
   * The alert watching a graph card.
   *
   * The two reads a card's bell renders, declared as themselves rather than as
   * an automation service: Dashboard depends on nothing else Automation owns,
   * and this process composes no automation vertical yet. Absent means a card
   * shows no alert — smaller, not wrong.
   */
  graphAlerts?: DashboardGraphAlertLookup;
  /**
   * Strips the provider secrets an alert's `actionParams` carries before the
   * row leaves the server.
   *
   * Absent drops every parameter rather than passing them through: an
   * encrypted Slack bot token or a webhook header value reaching a browser is
   * a disclosure, and an empty object is only a missing detail.
   */
  redactActionParams?: (
    action: Trigger["action"],
    actionParams: Record<string, unknown>,
  ) => Record<string, unknown>;
}>;

/** The two namespaces, the two `ctx.app` slices, and what the REST doors take. */
export type ComposedAnalyticsFeature = Readonly<{
  /**
   * `analytics.*` and `graphs.*`, on the process's own root.
   *
   * The first is one wire namespace assembled from three packaged transports,
   * exactly as the client has always called it: the charted reads at
   * `analytics.*`, the workbench at `analytics.lwql`, and the saved charts at
   * `analytics.savedWorkbenchCharts`. Merged here rather than at the record so
   * nothing outside this feature can add a fourth door onto the same name.
   */
  routers(mount: ApiTrpcFeatureMount): {
    analytics: ReturnType<ApiTrpcFeatureMount["root"]["mergeRouters"]>;
    graphs: ReturnType<typeof createGraphTrpcRouter>;
  };
  /** For `ctx.app.analytics`. */
  analytics: AnalyticsApp;
  /** For `ctx.app.dashboard`. */
  dashboard: DashboardApp;
  /**
   * The governed-SQL runner, the rollout switch it is behind, and the content
   * protections an API KEY resolves to — the three the public governed-SQL
   * REST family needs and the tRPC ports do not expose.
   *
   * Published rather than rebuilt at the REST mount: the workbench's door and
   * the API key's door must run one validator against one catalogue, or a
   * statement the browser refuses is a statement a key can still run.
   */
  langWatchQL: LangWatchQLService;
  featureFlags: FeatureFlagService;
  /** See {@link ApiAnalyticsProtections.resolveForApiKey}. */
  apiKeyProtections: (input: { projectId: string }) => Promise<LangWatchQLProtections>;
}>;

/**
 * Dashboard's card-placement gate, answered by LangWatchQL's own rollout flag.
 *
 * Dashboard states the question and this process answers it, so the feature
 * package never reads Analytics' server package to find out.
 */
class LangWatchQLWorkbenchAccess extends WorkbenchAccessPort {
  private constructor(
    private readonly dependencies: {
      featureFlags: FeatureFlagService;
      projects: ProjectService;
    },
  ) {
    super();
  }

  static create(dependencies: {
    featureFlags: FeatureFlagService;
    projects: ProjectService;
  }): LangWatchQLWorkbenchAccess {
    return new LangWatchQLWorkbenchAccess(dependencies);
  }

  isWorkbenchEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    return lwqlEnabled({
      featureFlags: this.dependencies.featureFlags,
      projectId,
      projects: this.dependencies.projects,
    });
  }
}

/** The filter fields this deployment offers, as the enum publishes them. */
export type ApiFilterField = (typeof filterFieldsEnum)["options"][number];

/** The charted reads' ports, with this deployment's two shared input schemas. */
export type ApiAnalyticsReadPorts = AnalyticsTrpcPorts<
  ApiTimeseriesInput,
  ApiReadInput,
  ApiFilterField,
  ApiTimeseriesInputWire,
  ApiReadInputWire
>;

/**
 * What each shared schema publishes to a CLIENT and hands to a HANDLER, named
 * apart because for these two they differ: `filters` carries a default, so the
 * wire may omit it while the parsed value always has it.
 */
type ApiReadInput = z.output<typeof sharedFiltersInputSchema>;
type ApiReadInputWire = z.input<typeof sharedFiltersInputSchema>;
type ApiTimeseriesInput = z.output<typeof timeseriesInputSchema>;
type ApiTimeseriesInputWire = z.input<typeof timeseriesInputSchema>;

/**
 * Composes the analytics half from this process's graph.
 *
 * Everything below is built exactly once: the LangWatchQL service is shared by
 * the workbench, the saved-chart policy and Dashboard's own service, and the
 * feature-flag service is shared by the rollout gate and the graph-visibility
 * policy — because in both cases two of them would be two answers to one
 * question.
 */
export function composeAnalyticsFeature(
  options: AnalyticsFeatureCollaborators,
): ComposedAnalyticsFeature {
  const langWatchQL = LangWatchQLAdapter.create({
    connection: options.langWatchQL ?? null,
  });
  options.resources.own("API LangWatchQL identity", () => langWatchQL.close());

  const featureFlags = options.featureFlags;

  const analytics = AnalyticsApp.create({
    analytics: AnalyticsAdapter.create({
      // The adapter's own contract: `null` is a deployment without ClickHouse,
      // and its repository answers the refusal rather than this composition
      // guessing at one.
      resolveClient: async (tenantId) =>
        options.resolveClickHouseClient ? await options.resolveClickHouseClient(tenantId) : null,
      clickhouseEnabled: options.resolveClickHouseClient !== null,
      defaultRetentionDays: DEFAULT_RETENTION_DAYS,
    }),
    filterOptions: FilterOptionsAdapter.create({
      resolveClient: options.resolveClickHouseClient,
    }),
    langWatchQL,
  });

  const dashboard = DashboardApp.create({
    dashboard: PostgresDashboardAdapter.create({
      database: options.prisma,
      ids: { generate: () => nanoid() },
      // Both governors — the LangWatchQL validator over the SQL, the Vega-Lite
      // policy over the specification — measured against the protections the
      // WRITE arrived with, which every door resolves for its own caller.
      savedWorkbenchChartPolicy: AnalyticsSavedWorkbenchChartPolicyAdapter.create({ langWatchQL }),
      graphVisibility: WorkbenchAwareGraphVisibilityAdapter.create({
        workbenchAccess: LangWatchQLWorkbenchAccess.create({
          featureFlags,
          projects: options.projects,
        }),
      }),
      langWatchQL,
    }).build(),
    automation: options.graphAlerts ?? NO_GRAPH_ALERTS,
  });

  const protections = ApiAnalyticsProtections.create({
    authz: options.authz,
    dataPrivacy: PrismaDataPrivacyResolutionAdapter.create({
      prisma: options.prisma,
      projects: options.projects,
    }),
  });

  const workbenchEnabled = (projectId: string): Promise<boolean> =>
    lwqlEnabled({ featureFlags, projectId, projects: options.projects });

  /**
   * The rollout gate, chained AFTER the permission check so a caller is placed
   * by RBAC first and gated by the experiment second: a member who may not
   * touch the project must not learn from the answer whether the experiment is
   * on for it.
   *
   * The procedure builder's input generics belong to the feature package, so
   * the one `.use` it needs is named structurally rather than reached for
   * through an `any`.
   */
  const requireWorkbenchEnabled = <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure).use(
      async ({ input, next }: { input: unknown; next: () => unknown }) => {
        const projectId = (input as { projectId?: string }).projectId ?? "";
        if (!(await workbenchEnabled(projectId))) {
          // A typed handled error, not a bare FORBIDDEN: the boundary
          // serialises `code: "lwql_not_enabled"`, which is what the workbench
          // keys its copy off.
          throw new LangWatchQLNotEnabledError();
        }
        return next();
      },
    ) as unknown as TProcedure;

  const resolveProtections = (
    ctx: unknown,
    input: Readonly<{ projectId: string }>,
  ): Promise<LangWatchQLProtections> =>
    protections.resolve({ userId: actorId(ctx), projectId: input.projectId });

  /**
   * Who a session-authenticated execution runs as.
   *
   * The project's LangWatchQL secret is hashed into the tenant capability the
   * statement runs under: it is read server-side and must never leave the
   * calling procedure — no field of it may appear in a response.
   */
  const resolveRunCaller = async (ctx: unknown, input: Readonly<{ projectId: string }>) => {
    const project = await options.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, lwqlKey: true },
    });
    if (!project) {
      throw new NotFoundError("project_not_found", "Project", input.projectId);
    }
    return { project, protections: await resolveProtections(ctx, input) };
  };

  const savedChartPolicy = AnalyticsSavedWorkbenchChartPolicyAdapter.create({ langWatchQL });

  const ports = {
    reads: {
      // The two schemas are this process's because the same shapes are the
      // REST analytics body and the traces filter input: one definition, here,
      // is what keeps those surfaces from drifting.
      timeseriesInputSchema,
      sharedFiltersSchema: sharedFiltersInputSchema,
      filterFieldSchema: filterFieldsEnum,
      filterFieldRequiresKey,
      filterFieldRequiresSubkey,
    } as ApiAnalyticsReadPorts,

    workbench: {
      requireWorkbenchEnabled,
      isWorkbenchEnabled: (_ctx, input) => workbenchEnabled(input.projectId),
      maxStatementLength: MAX_LWQL_LENGTH,
      timeWindowSchema: lwqlTimeWindowSchema,
      granularityStepSchema: lwqlGranularityStepSchema,
      resolveProtections,
      resolveRunCaller,
    },

    savedCharts: {
      requireWorkbenchEnabled,
      timeWindowSchema: lwqlTimeWindowSchema,
      granularityStepSchema: lwqlGranularityStepSchema,
      resolveProtections,
      resolveRunCaller,
      // Admitted against the CALLER's own protections before it is stored,
      // which is the one place they are known: a member who cannot read costs
      // must not be able to save a chart that selects them.
      admitDefinition: (_ctx, input) =>
        savedChartPolicy.admit({
          projectId: input.projectId,
          protections: input.protections,
          definition: input.definition,
        }),
      mapError: mapDashboardSavedWorkbenchChartError,
    },
  } as AnalyticsFeaturePorts;

  const graphPorts: GraphTrpcPorts<ApiFilterField> = {
    filterFieldSchema: filterFieldsEnum,
    redactActionParams: (action, actionParams) =>
      options.redactActionParams ? options.redactActionParams(action, actionParams) : {},
  };

  return {
    routers: (mount) => analyticsRouters(mount, ports, graphPorts),
    analytics,
    dashboard,
    langWatchQL,
    featureFlags,
    apiKeyProtections: (input) => protections.resolveForApiKey(input),
  };
}

/** The two namespaces, built the one way whether the feature composed or not. */
function analyticsRouters(
  mount: ApiTrpcFeatureMount,
  ports: AnalyticsFeaturePorts,
  graphPorts: GraphTrpcPorts<ApiFilterField>,
) {
  return {
    analytics: mount.root.mergeRouters(
      createAnalyticsTrpcRouter({ ...mount, ports: ports.reads }),
      mount.root.router({
        lwql: createLangWatchQLTrpcRouter({ ...mount, ports: ports.workbench }),
        savedWorkbenchCharts: createSavedWorkbenchChartTrpcRouter({
          ...mount,
          ports: ports.savedCharts,
        }),
      }),
    ),
    graphs: createGraphTrpcRouter({ ...mount, ports: graphPorts }),
  };
}

/** The three port groups the `analytics.*` namespace is assembled from. */
type AnalyticsFeaturePorts = Readonly<{
  reads: ApiAnalyticsReadPorts;
  workbench: LangWatchQLTrpcPorts;
  savedCharts: SavedWorkbenchChartTrpcPorts;
}>;

/**
 * The analytics surfaces on a process that composed no graph to read them over.
 *
 * Both namespaces still mount, and every schema the record reads while it is
 * BUILDING them stays real — the two shared input schemas, the filter-field
 * enum, the workbench's time-window and granularity parsers and its statement
 * ceiling. A procedure cannot be constructed without its input parser, so a
 * refusing stand-in there would take the whole router down rather than the one
 * answer it cannot give. Only what a REQUEST reaches refuses, by name.
 */
export function refusingAnalyticsFeature(): ComposedAnalyticsFeature {
  const refuse = (): never => {
    throw new ApiAnalyticsUnavailableError("The analytics surface");
  };
  const refuseAsync = (): Promise<never> =>
    Promise.reject(new ApiAnalyticsUnavailableError("The analytics surface"));

  const workbench: LangWatchQLTrpcPorts = {
    // Applied while the procedure is built; it refuses when one is CALLED.
    requireWorkbenchEnabled: <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as ChainableProcedure).use(refuse) as TProcedure,
    isWorkbenchEnabled: refuseAsync,
    maxStatementLength: MAX_LWQL_LENGTH,
    timeWindowSchema: lwqlTimeWindowSchema,
    granularityStepSchema: lwqlGranularityStepSchema,
    resolveProtections: refuseAsync,
    resolveRunCaller: refuseAsync,
  } as LangWatchQLTrpcPorts;

  const ports: AnalyticsFeaturePorts = {
    reads: {
      timeseriesInputSchema,
      sharedFiltersSchema: sharedFiltersInputSchema,
      filterFieldSchema: filterFieldsEnum,
      filterFieldRequiresKey,
      filterFieldRequiresSubkey,
    } as ApiAnalyticsReadPorts,
    workbench,
    // Written out rather than spread from the workbench beside it: the two
    // surfaces name DIFFERENT request contexts, so the shared members are not
    // the same functions — one taking the workbench's context could not be
    // handed a saved chart's.
    savedCharts: {
      // Applied while the procedure is built; it refuses when one is CALLED.
      requireWorkbenchEnabled: <TProcedure>(procedure: TProcedure): TProcedure =>
        (procedure as ChainableProcedure).use(refuse) as TProcedure,
      timeWindowSchema: lwqlTimeWindowSchema,
      granularityStepSchema: lwqlGranularityStepSchema,
      resolveProtections: refuseAsync,
      resolveRunCaller: refuseAsync,
      admitDefinition: refuseAsync,
      mapError: mapDashboardSavedWorkbenchChartError,
    },
  };

  const refusingApplication = <T>(): T =>
    new Proxy(
      {},
      {
        get: () => refuse,
        has: () => true,
      },
    ) as T;

  return {
    routers: (mount) =>
      analyticsRouters(mount, ports, {
        filterFieldSchema: filterFieldsEnum,
        redactActionParams: () => ({}),
      }),
    analytics: refusingApplication<AnalyticsApp>(),
    dashboard: refusingApplication<DashboardApp>(),
    langWatchQL: refusingApplication<LangWatchQLService>(),
    featureFlags: refusingApplication<FeatureFlagService>(),
    apiKeyProtections: refuseAsync,
  };
}

/** A capability this deployment did not compose, refused by name. */
class ApiAnalyticsUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiAnalyticsUnavailableError";
  }
}

/** The `.use()` surface every tRPC procedure builder shares. */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/** The caller of one request, as the ports above read it. */
const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

/** A deployment with no automation vertical: no card carries an alert. */
const NO_GRAPH_ALERTS: DashboardGraphAlertLookup = {
  getByCustomGraphIds: () => Promise.resolve([]),
  tryGetByCustomGraphId: () => Promise.resolve(null),
};

/**
 * What one member may read of a project's content, as LangWatchQL's catalogue
 * asks it.
 *
 * Three booleans, from two independent sources, and they are independent on
 * purpose. Spend follows the caller's own PERMISSION — `cost:view`, the same
 * question the declared check on a cost-oriented read asks — while captured
 * input and output follow the project's DATA-PRIVACY policy, because whether a
 * conversation may be read is a customer setting rather than a role.
 *
 * It fails closed twice over. A policy that cannot be resolved hides content
 * rather than exposing it, and a `restrict` rule whose audience names groups is
 * refused here, because this process cannot yet resolve a member's group
 * membership and the safe reading of "I do not know whether you are in the
 * audience" is no.
 */
class ApiAnalyticsProtections {
  static create(dependencies: {
    authz: AuthzService;
    dataPrivacy: {
      getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
    };
  }): ApiAnalyticsProtections {
    return new ApiAnalyticsProtections(dependencies);
  }

  private readonly logger: Pick<Logger, "error"> = createLogger("langwatch:api:analytics");

  private constructor(
    private readonly dependencies: {
      authz: AuthzService;
      dataPrivacy: {
        getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
      };
    },
  ) {}

  async resolve(input: { userId: string; projectId: string }): Promise<LangWatchQLProtections> {
    const [canSeeCosts, isMember, isAdmin] = await Promise.all([
      this.permitted(input, "cost:view"),
      this.permitted(input, "traces:view"),
      this.permitted(input, "project:update"),
    ]);

    let policy: ResolvedDataPrivacy;
    try {
      policy = await this.dependencies.dataPrivacy.getResolvedForProject({
        projectId: input.projectId,
      });
    } catch (error) {
      // Fail closed: a resolver or database failure must not expose content a
      // restrict rule would otherwise hide.
      this.logger.error(
        { error, projectId: input.projectId },
        "data-privacy policy resolution failed; hiding captured content (fail-closed)",
      );
      return { canSeeCosts, canSeeCapturedInput: false, canSeeCapturedOutput: false };
    }

    const visible = (category: ContentCategory): boolean =>
      isContentVisible(policy.categories[category], {
        isAdmin,
        isMember,
        isMemberRole: isMember,
        isViewer: isMember && !isAdmin,
        // Neither is resolvable from this process's graph, and both widen
        // rather than narrow, so both stay false.
        isProjectOwner: false,
        groupIds: [],
      });

    return {
      canSeeCosts,
      canSeeCapturedInput: visible("input"),
      canSeeCapturedOutput: visible("output"),
    };
  }

  /**
   * What an API KEY may see, which is a different question from what a person
   * may see.
   *
   * A project key carries full project access by design — it predates RBAC and
   * every role that can hold one grants `cost:view` — so costs are visible.
   * Captured content is NOT: it follows the project's own data-privacy policy
   * read for a caller with no session, which is exactly what a `restrict` rule
   * is for. Fail-closed on a resolution failure, for the same reason the
   * member's resolution is.
   */
  async resolveForApiKey(input: { projectId: string }): Promise<LangWatchQLProtections> {
    let policy: ResolvedDataPrivacy;
    try {
      policy = await this.dependencies.dataPrivacy.getResolvedForProject({
        projectId: input.projectId,
      });
    } catch (error) {
      this.logger.error(
        { error, projectId: input.projectId },
        "data-privacy policy resolution failed; hiding captured content (fail-closed)",
      );
      return { canSeeCosts: true, canSeeCapturedInput: false, canSeeCapturedOutput: false };
    }
    return {
      canSeeCosts: true,
      canSeeCapturedInput: isContentVisibleToPublic(policy.categories.input),
      canSeeCapturedOutput: isContentVisibleToPublic(policy.categories.output),
    };
  }

  private permitted(
    input: { userId: string; projectId: string },
    permission: "cost:view" | "traces:view" | "project:update",
  ): Promise<boolean> {
    return this.dependencies.authz.hasPermission({
      userId: input.userId,
      permission,
      projectId: input.projectId,
    });
  }
}
