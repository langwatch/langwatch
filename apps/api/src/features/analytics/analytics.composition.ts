/**
 * The analytics half of {@link ApiTrpcCollaborators}: the `ctx.app.analytics`
 * slice the charted surfaces read, and the two port groups the `analytics.*`
 * namespace reaches for.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import {
  filterFieldsEnum,
  LangWatchQLNotEnabledError,
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
  MAX_LWQL_LENGTH,
  sharedFiltersInputSchema,
  timeseriesInputSchema,
} from "@langwatch/analytics-contract";
import {
  AnalyticsApp,
  lwqlEnabled,
  filterFieldRequiresKey,
  filterFieldRequiresSubkey,
  type LangWatchQLService,
} from "@langwatch/analytics-server";
import type { LangWatchQLTrpcPorts } from "@langwatch/analytics-server/api-trpc/langwatch-ql";
import type { AuthzService } from "@langwatch/authz-contract";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import {
  isContentVisible,
  isContentVisibleToPublic,
  type ContentCategory,
  type DataPrivacyApi,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { ApiLangWatchQLConfigResolution } from "../../platform/config/api.config.ts";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context.ts";
import type { AnalyticsFeaturePorts, ApiAnalyticsReadPorts } from "./analytics-trpc.routers.ts";

/**
 * The retention floor an evaluation read is bounded by when a project names no policy of
 * its own. The platform app's `PLATFORM_DEFAULT_RETENTION_DAYS`.
 */
const DEFAULT_RETENTION_DAYS = 49;

/** Everything the analytics half is composed from. */
export type AnalyticsFeatureCollaborators = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The same AuthZ service the REST doors and the declared checks authorize through. */
  authz: AuthzService;
  /** Resolves a project's organization, for the rollout gate's targeting. */
  projects: ProjectApi;
  /**
   * The SAME resolved privacy policy the trace read stack redacts by, taken
   * rather than built: a chart and the traces behind it must not disagree about
   * which fields a project keeps.
   */
  dataPrivacy: DataPrivacyApi;
  /**
   * The process's ONE rollout store, composed by the feature-flag feature.
   */
  featureFlags: FeatureFlagApi;
  /** The application's own ClickHouse, or `null` where the process composed none. */
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  /** The restricted identity a member's own SQL runs as. */
  langWatchQL: ApiLangWatchQLConfigResolution | undefined;
  /** Releases the restricted identity's transport with the rest of the process. */
  resources: ResourceScope;
}>;

import type { ComposedAnalyticsFeature } from "./analytics.composition.types.ts";

/**
 * Composes the analytics half from this process's graph.
 */
export function composeAnalyticsFeature(
  options: AnalyticsFeatureCollaborators,
): ComposedAnalyticsFeature {
  const featureFlags = options.featureFlags;

  const analytics = AnalyticsApp.create({
    infrastructure: {
      resolveClickHouseClient: options.resolveClickHouseClient,
      clickhouseEnabled: options.resolveClickHouseClient !== null,
      defaultRetentionDays: DEFAULT_RETENTION_DAYS,
    },
    config: {
      langwatchQl: options.langWatchQL ?? {
        url: undefined,
        username: undefined,
        password: undefined,
        database: undefined,
        tenantSetting: undefined,
      },
    },
    dependencies: {},
    resources: options.resources,
  });

  // Compatibility port for the still application-owned saved-chart routes.
  // The implementation is the AnalyticsApi; LangWatchQL itself is owned by
  // AnalyticsApp and closed through the feature resource scope.
  const langWatchQL: LangWatchQLService = {
    get available() {
      return analytics.isLangWatchQLAvailable();
    },
    close: () => Promise.resolve(),
    describeSchema: (input) => analytics.describeLangWatchQLSchema(input),
    validate: (input) => analytics.validateLangWatchQL(input),
    execute: (input) => analytics.executeLangWatchQL(input),
  };

  const protections = ApiAnalyticsProtections.create({
    authz: options.authz,
    dataPrivacy: options.dataPrivacy,
  });

  const workbenchEnabled = (projectId: string): Promise<boolean> =>
    lwqlEnabled({ featureFlags, projectId, projects: options.projects });

  /**
   * The rollout gate, chained AFTER the permission check so a caller is placed by RBAC
   * first and gated by the experiment second: a member who may not touch the project must
   * not learn from the answer whether the experiment is on for it.
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
    resolveProtectionsFor({ actorId: actorId(ctx), projectId: input.projectId });

  const resolveProtectionsFor = (input: {
    actorId: string;
    projectId: string;
  }): Promise<LangWatchQLProtections> =>
    protections.resolve({ userId: input.actorId, projectId: input.projectId });

  /**
   * Who a session-authenticated execution runs as. The project's LangWatchQL secret is
   * hashed into the tenant capability the statement runs under: it is read server-side
   * and must never leave the calling procedure — no field of it may appear in a response.
   */
  const resolveRunCallerFor = async (input: { actorId: string; projectId: string }) => {
    const project = await options.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, lwqlKey: true },
    });
    if (!project) {
      throw new NotFoundError("project_not_found", "Project", input.projectId);
    }
    return { project, protections: await resolveProtectionsFor(input) };
  };

  const resolveRunCaller = (ctx: unknown, input: Readonly<{ projectId: string }>) =>
    resolveRunCallerFor({ actorId: actorId(ctx), projectId: input.projectId });

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
  } as AnalyticsFeaturePorts;

  return {
    analytics,
    dashboardPorts: {
      isWorkbenchEnabled: ({ projectId }) => workbenchEnabled(projectId),
      resolveProtections: resolveProtectionsFor,
      resolveRunCaller: resolveRunCallerFor,
    },
    langWatchQL,
    featureFlags,
    apiKeyProtections: (input) => protections.resolveForApiKey(input),
  };
}

/**
 * The analytics surfaces on a process that composed no graph to read them over.
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
    analytics: refusingApplication<AnalyticsApp>(),
    dashboardPorts: {
      isWorkbenchEnabled: refuseAsync,
      resolveProtections: refuseAsync,
      resolveRunCaller: refuseAsync,
    },
    langWatchQL: refusingApplication<LangWatchQLService>(),
    featureFlags: refusingApplication<FeatureFlagApi>(),
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

/**
 * What one member may read of a project's content, as LangWatchQL's catalogue asks it.
 * Three booleans, from two independent sources, and they are independent on purpose.
 */
export class ApiAnalyticsProtections {
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
   * What an API KEY may see, which is a different question from what a person may see.
   *
   * Content categories resolve as they do for a caller with no session, because a key is
   * not a member. Costs are the credential's OWN question: a scoped key holds `cost:view`
   * or it does not, and it is asked here through the same `hasApiKeyPermission` the route
   * chain enforces a declared permission with. A legacy project key predates RBAC and
   * carries full project access by design, so for that credential class alone the answer
   * is yes without a lookup.
   */
  async resolveForApiKey(input: {
    projectId: string;
    credential: RestCredentialPrincipal;
  }): Promise<LangWatchQLProtections> {
    const canSeeCosts = await this.keyPermitted(input.credential, "cost:view");
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
      return { canSeeCosts, canSeeCapturedInput: false, canSeeCapturedOutput: false };
    }
    return {
      canSeeCosts,
      canSeeCapturedInput: isContentVisibleToPublic(policy.categories.input),
      canSeeCapturedOutput: isContentVisibleToPublic(policy.categories.output),
    };
  }

  /** One permission, asked of the CREDENTIAL rather than of whoever holds it. */
  private keyPermitted(
    credential: RestCredentialPrincipal,
    permission: "cost:view",
  ): Promise<boolean> {
    if (credential.kind !== "apiKey") return Promise.resolve(true);
    return this.dependencies.authz.hasApiKeyPermission({
      apiKeyId: credential.apiKeyId,
      userId: credential.userId,
      organizationId: credential.organizationId,
      scope: { type: "project", id: credential.projectId, teamId: credential.teamId },
      permission,
    });
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
