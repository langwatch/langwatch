/**
 * The Langy conversation panel and the egress allow-list beside it, composed as their own
 * feature. `langy.*` and `langyEgress.*`, plus the `ctx.app.langy` slice both Langy doors
 * read.
 */
import type { FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import {
  FeatureFlagLangyUiActionSurfaceAdapter,
  LANGY_GITHUB_PRS_PER_DAY,
  LangyApp,
  LangyGithubPermitPort,
  LangyGithubPrCounterPort,
  LangyGithubPrQuotaService,
  LangyNavigateFallbackService,
  type LangyNavigateResourcePort,
  LangyBlockOtelMetricsAdapter,
  LangyTokenBufferRedisRepository,
  MemoryLangyRepositories,
  PostgresLangyRepositories,
  LangyUiActionCatalogPort,
  LangyUiActionService,
  type LangyEgressTrpcPorts,
  type LangyRelayCompositionOptions,
  type LangyLocalTrpcPorts,
  type LangyTrpcPorts,
  type LangyTurnTechnicalPorts,
  type LangyUiActionDefinition,
  type LangyConversationCommands,
  type UiActionRedis,
} from "@langwatch/langy-server";
import { LangyNotEnabledError, renderLangyTurnContext } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { ResourceScope } from "@langwatch/runtime-composition";

import type { ApiAuditPort } from "../../api-request.policy.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context.ts";
import { createPlatformUrlBuilder } from "../../app/api-rest-ports.ts";
import { createLangySetupSkillsTrpcRouters } from "./setup-skills-trpc.mount.ts";

const LANGY_RELEASE_FLAG = "release_langy_enabled";

/** The other feature's service the Langy gates reach, named on its own. */
export type LangyPeers = Readonly<{
  /** The organization a project belongs to, which the rollout rule targets. */
  projects: ProjectApi;
}>;

/** Everything the Langy feature is composed from besides its peer. */
export type LangyFeatureCollaborators = Readonly<{
  prisma: ApiTrpcInfrastructure["prisma"];
  featureFlags: ApiTrpcInfrastructure["featureFlags"];
  audit: ApiAuditPort | undefined;
  projects: ProjectApi;
  /** All sixteen conversation writes, as this process produces them. */
  commands: LangyConversationCommands;
  /** The token buffer, the turn access store and the handoff store share it. */
  redis: RedisConnection | null;
  /** The address the worker's relay frames and navigate fallbacks are built under. */
  publicBaseUrl: string | undefined;
  /** The fabric both live channels publish on. */
  broadcast: PresenceEmitterPort;
  /** The one project Langy never runs on, whatever a permission says. */
  demoProjectId: string | undefined;
  /** The shared counter the two Langy budgets meter through. */
  rateLimit: (input: {
    key: string;
    windowSeconds: number;
    max: number;
  }) => Promise<{ allowed: boolean; resetAt: number }>;
  processName: string;
  /**
   * Where a resource id Langy opens is read. Absent means only page names
   * resolve, which is the honest answer for a process holding none of the
   * eight directories a resource id names.
   */
  navigateResources: LangyNavigateResourcePort | undefined;
  /**
   * The developer's own machine (ADR-129). The SAME runtime the worker's REST
   * door reads — two over process memory would answer two different folders
   * for one conversation. Absent means every local procedure refuses by name.
   */
  local: LangyLocalTrpcPorts | undefined;
}>;

import type { ComposedLangyFeature } from "./langy.composition.types.ts";

/** Composes the Langy feature over this process's own graph. */
export function composeLangyFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: LangyPeers;
  commands: LangyConversationCommands;
  redis: RedisConnection | null;
  publicBaseUrl: string | undefined;
  broadcast: PresenceEmitterPort;
  demoProjectId: string | undefined;
  rateLimit: LangyFeatureCollaborators["rateLimit"];
  processName: string;
  navigateResources?: LangyNavigateResourcePort | undefined;
  local?: LangyLocalTrpcPorts | undefined;
}): ComposedLangyFeature {
  const collaborators: LangyFeatureCollaborators = {
    prisma: options.infrastructure.prisma,
    featureFlags: options.infrastructure.featureFlags,
    audit: options.infrastructure.audit,
    projects: options.peers.projects,
    commands: options.commands,
    redis: options.redis,
    publicBaseUrl: options.publicBaseUrl,
    broadcast: options.broadcast,
    demoProjectId: options.demoProjectId,
    rateLimit: options.rateLimit,
    processName: options.processName,
    navigateResources: options.navigateResources,
    local: options.local,
  };
  // The two namespaces, their ports and the two gates went with the transport
  // that took them; they return with the converted one.
  return {
    app: composeLangy(collaborators),
    routers: (mount) => createLangySetupSkillsTrpcRouters(mount.runtime),
  };
}

/** One Langy application, refused by name on every member. */
export function refusingLangyFeature(): ComposedLangyFeature {
  const app = new Proxy(
    {},
    {
      get: () => (): never => {
        throw new ApiLangyUnavailableError("The Langy conversation surface");
      },
      has: () => true,
    },
  ) as LangyApp;

  return {
    app,
    routers: (mount) => createLangySetupSkillsTrpcRouters(mount.runtime),
  };
}

/** A Langy capability this process does not run, refused by name. */
class ApiLangyUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiLangyUnavailableError";
  }
}

function composeLangy(options: LangyFeatureCollaborators): LangyApp {
  const redis = options.redis;
  // The tier the process can honestly serve: Redis when the deployment has a
  // connection, and the in-memory twin when it does not. The turn ports below
  // still read `redis` directly for the rows that are per-connection rather
  // than per-row - a blocking tail borrows its own connection.
  const repositories = redis
    ? PostgresLangyRepositories.create({ redis })
    : MemoryLangyRepositories.create();
  // The daily pull-request budget, metered on the SAME connection the token
  // buffer and the turn stores use. Without Redis the service answers every
  // reservation `allowed` and reports nothing reserved, which is what a
  // deployment holding no counter can honestly say.
  const prQuota = ApiLangyGithubPrPermits.create(
    LangyGithubPrQuotaService.create({
      counter: redis ? ApiLangyGithubPrCounter.create(redis) : null,
    }),
  );

  const turns: LangyTurnTechnicalPorts = {
    // Resolving the model a turn runs on refuses rather than inventing one: a
    // guessed model bills a customer's key against a provider they did not
    // choose. The worker composition makes the same call for its title
    // generator, and for the same reason.
    models: {
      resolve: () => Promise.reject(new ApiLangyUnavailableError("Resolving the Langy model")),
    },
    // No agent manager on a web process: dispatching is the worker's.
    worker: null,
    tokenBuffer: redis ? LangyTokenBufferRedisRepository.create({ redis }) : null,
    permits: prQuota,
    perDayPrCap: LANGY_GITHUB_PRS_PER_DAY,
    sessionKeys: {
      mint: () => Promise.reject(new ApiLangyUnavailableError("Minting a Langy session key")),
      revoke: () => Promise.resolve(),
    },
    // The one turn port that answers for real here: rendering the composer's
    // context chips is pure, and the contract package owns it.
    context: { tryRender: renderLangyTurnContext },
    uiActionSurface: FeatureFlagLangyUiActionSurfaceAdapter.create(options.featureFlags),
    metrics: { count: () => undefined },
    accessStore: repositories.turnAccess,
    handoffStore: repositories.turnHandoff,
  };

  const relay = composeLangyRelay(options, redis);
  return LangyApp.create({
    dependencies: {},
    repositories,
    infrastructure: {
      database: options.prisma,
      turns,
      credentials: {
        sessionKeys: {
          mint: () => Promise.reject(new ApiLangyUnavailableError("Minting a Langy session key")),
          revokeManaged: () => Promise.resolve("refused" as const),
        },
        virtualKeys: {
          provision: () =>
            Promise.reject(new ApiLangyUnavailableError("Provisioning a Langy virtual key")),
        },
        github: {
          enabled: false,
          mintTurnToken: () => Promise.resolve(null),
        },
        runtime: {
          workerCallbackUrl: undefined,
          workerGatewayBaseUrl: undefined,
          mirrorProjectId: undefined,
        },
      },
      commands: options.commands,
      events: null,
      blockMetrics: LangyBlockOtelMetricsAdapter.create(),
      redis,
      broadcast: options.broadcast,
      ...(redis ? { feedbackPromptRedis: redis } : {}),
      ...(relay ? { relay } : {}),
    },
    config: { agentUrl: undefined, internalSecret: undefined },
    resources: new ResourceScope(),
  });
}

/**
 * The live edge the worker pushes turn frames through. Absent without Redis or
 * a public address: the relay route then refuses by name instead of relaying
 * to nowhere. Navigate fallbacks resolve under the asking project's own slug.
 */
function composeLangyRelay(
  options: LangyFeatureCollaborators,
  redis: RedisConnection | null,
): LangyRelayCompositionOptions | undefined {
  if (!redis || !options.publicBaseUrl) return undefined;
  const fallback = LangyNavigateFallbackService.create({
    projects: {
      trySlugOf: async (projectId) =>
        (await options.projects.tryGetSummaryById(projectId))?.slug ?? null,
    },
    platformUrl: createPlatformUrlBuilder(options.publicBaseUrl),
    ...(options.navigateResources ? { resources: options.navigateResources } : {}),
  });
  return {
    redis,
    baseHost: options.publicBaseUrl,
    resolveResourceUrl: (input) => fallback.tryResolveUrl(input),
    logger: createLogger(`${options.processName}:langy-relay`),
  };
}

/**
 * The page-action catalogue, absent. The only catalogue that exists is the experiments
 * workbench's, and it is a browser module: a Langy server package may not reach it and
 * neither may this composition root.
 */
class UnavailableApiLangyUiActionCatalog extends LangyUiActionCatalogPort {
  tryFind(_kind: string): LangyUiActionDefinition | null {
    return null;
  }
}

/**
 * The daily pull-request counter, on this process's own Redis. `eval` is
 * declared because the quota service releases a permit through a Lua
 * check-and-decrement; without it the release falls back to a read-then-decr
 * that can underflow the bucket and grant unlimited permits.
 */
class ApiLangyGithubPrCounter extends LangyGithubPrCounterPort {
  static create(redis: RedisConnection): ApiLangyGithubPrCounter {
    return new ApiLangyGithubPrCounter(redis);
  }

  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  tryGet(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  decr(key: string): Promise<number> {
    return this.redis.decr(key);
  }

  incrby(key: string, amount: number): Promise<number> {
    return this.redis.incrby(key, amount);
  }

  expire(key: string, seconds: number): Promise<unknown> {
    return this.redis.expire(key, seconds);
  }

  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown> {
    return this.redis.eval(script, numKeys, ...args) as Promise<unknown>;
  }
}

/** The turn's three permit calls, on the feature package's quota service. */
class ApiLangyGithubPrPermits extends LangyGithubPermitPort {
  static create(quota: LangyGithubPrQuotaService): ApiLangyGithubPrPermits {
    return new ApiLangyGithubPrPermits(quota);
  }

  private constructor(private readonly quota: LangyGithubPrQuotaService) {
    super();
  }

  reserve(input: { userId: string }): Promise<{
    reserved: boolean;
    allowed: boolean;
    resetAt: number;
  }> {
    return this.quota.reservePermit(input);
  }

  release(input: { userId: string }): Promise<void> {
    return this.quota.releasePermit(input);
  }

  check(input: { userId: string }): Promise<{ allowed: boolean }> {
    return this.quota.usage(input);
  }
}
