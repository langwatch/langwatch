/**
 * The Langy conversation panel and the egress allow-list beside it, composed as
 * their own feature.
 *
 * `langy.*` and `langyEgress.*`, plus the `ctx.app.langy` slice both Langy
 * doors read. It used to be composed inside the agent group, next to the
 * scenario store, because both dispatch onto this process's producer-only
 * Eventing. Dispatching onto the same runtime is not being one graph: nothing
 * Langy reads is a scenario, and nothing a scenario reads is a conversation. So
 * it composes itself, from the shared infrastructure, the one peer it names,
 * and the conversation command sender the process registered.
 *
 * ## What answers, and what refuses by name
 *
 * The Postgres half and both live channels answer for real. Everything a TURN
 * needs to RUN is the worker's — resolving the model, reserving a pull-request
 * permit, minting a session key, provisioning a virtual key — so each refuses
 * by name rather than resolving into a turn that silently never runs.
 */
import type { FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import {
  FeatureFlagLangyUiActionSurfaceAdapter,
  LangyApp,
  LangyTokenBuffer,
  LangyTurnAccessStore,
  LangyTurnHandoffStore,
  LangyUiActionCatalogPort,
  LangyUiActionService,
  PostgresLangyAdapter,
  type LangyEgressTrpcPorts,
  type LangyTrpcPorts,
  type LangyTurnTechnicalPorts,
  type LangyUiActionDefinition,
  type LangyConversationCommands,
  type UiActionRedis,
} from "@langwatch/langy-server";
import { LangyNotEnabledError, renderLangyTurnContext } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiAuditPort } from "../../api-request.policy";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import {
  createLangyEgressTrpcRouter,
  createLangyTrpcRouter,
  type LangyTrpcGates,
} from "./langy-trpc.mount";

const LANGY_RELEASE_FLAG = "release_langy_enabled";

/** The other feature's service the Langy gates reach, named on its own. */
export type LangyPeers = Readonly<{
  /** The organization a project belongs to, which the rollout rule targets. */
  projects: ProjectService;
}>;

/** Everything the Langy feature is composed from besides its peer. */
export type LangyFeatureCollaborators = Readonly<{
  prisma: ApiTrpcInfrastructure["prisma"];
  featureFlags: ApiTrpcInfrastructure["featureFlags"];
  audit: ApiAuditPort | undefined;
  projects: ProjectService;
  /** All sixteen conversation writes, as this process produces them. */
  commands: LangyConversationCommands;
  /** The token buffer, the turn access store and the handoff store share it. */
  redis: RedisConnection | null;
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
}>;

/** The Langy application and the two routers built over it. */
export type ComposedLangyFeature = Readonly<{
  /** The `ctx.app.langy` slice both Langy doors read. */
  app: LangyApp;
  /** `langy.*` and `langyEgress.*`, behind the same two process gates. */
  routers(mount: ApiTrpcFeatureMount): {
    langy: ReturnType<typeof createLangyTrpcRouter>;
    langyEgress: ReturnType<typeof createLangyEgressTrpcRouter>;
  };
}>;

/** Composes the Langy feature over this process's own graph. */
export function composeLangyFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: LangyPeers;
  commands: LangyConversationCommands;
  redis: RedisConnection | null;
  broadcast: PresenceEmitterPort;
  demoProjectId: string | undefined;
  rateLimit: LangyFeatureCollaborators["rateLimit"];
  processName: string;
}): ComposedLangyFeature {
  const collaborators: LangyFeatureCollaborators = {
    prisma: options.infrastructure.prisma,
    featureFlags: options.infrastructure.featureFlags,
    audit: options.infrastructure.audit,
    projects: options.peers.projects,
    commands: options.commands,
    redis: options.redis,
    broadcast: options.broadcast,
    demoProjectId: options.demoProjectId,
    rateLimit: options.rateLimit,
    processName: options.processName,
  };
  const app = composeLangy(collaborators);
  const gates = composeLangyGates(collaborators);

  return {
    app,
    routers: (mount) => ({
      langy: createLangyTrpcRouter({
        ...mount,
        ports: composeLangyPorts(collaborators, app),
        gates,
      }),
      langyEgress: createLangyEgressTrpcRouter({
        ...mount,
        ports: composeLangyEgressPorts(collaborators),
        gates,
      }),
    }),
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
  const gates: LangyTrpcGates = {
    refuseDemoProject: async ({ next }: { next: () => unknown }) => next(),
    enforceLangyAccess: async (): Promise<never> => {
      throw new ApiLangyUnavailableError("The Langy conversation surface");
    },
  };

  return {
    app,
    routers: (mount) => ({
      langy: createLangyTrpcRouter({ ...mount, ports: refusingLangyPorts(), gates }),
      langyEgress: createLangyEgressTrpcRouter({
        ...mount,
        ports: { recordAudit: async () => undefined },
        gates,
      }),
    }),
  };
}

/** Every conversation port, refused by name for the same one reason. */
function refusingLangyPorts(): LangyTrpcPorts {
  const refuse = (): never => {
    throw new ApiLangyUnavailableError("The Langy conversation surface");
  };
  return {
    checkMessageRateLimit: refuse,
    checkWarmRateLimit: refuse,
    recordProductEvent: refuse,
    uiActions: { claim: refuse, complete: refuse },
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
  const adapter = PostgresLangyAdapter.create({ database: options.prisma });
  const redis = options.redis;

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
    tokenBuffer: redis ? LangyTokenBuffer.create({ redis }) : null,
    permits: {
      reserve: () =>
        Promise.reject(new ApiLangyUnavailableError("Reserving a Langy pull-request permit")),
      release: () => Promise.resolve(),
      check: () =>
        Promise.reject(new ApiLangyUnavailableError("Reading the Langy pull-request budget")),
    },
    // Zero rather than a number: with no permit store there is no budget to
    // spend, and a positive cap would advertise one.
    perDayPrCap: 0,
    sessionKeys: {
      mint: () => Promise.reject(new ApiLangyUnavailableError("Minting a Langy session key")),
      revoke: () => Promise.resolve(),
    },
    // The one turn port that answers for real here: rendering the composer's
    // context chips is pure, and the contract package owns it.
    context: { render: renderLangyTurnContext },
    uiActionSurface: FeatureFlagLangyUiActionSurfaceAdapter.create(options.featureFlags),
    metrics: { count: () => undefined },
    accessStore: redis ? LangyTurnAccessStore.create({ redis }) : null,
    handoffStore: redis ? LangyTurnHandoffStore.create({ redis }) : null,
  };

  const service = adapter.build({
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
    ...(redis ? { feedbackPromptRedis: redis } : {}),
  });

  return LangyApp.create({
    langy: service,
    redis: redis as unknown as Parameters<typeof LangyApp.create>[0]["redis"],
    broadcast: options.broadcast,
  });
}

/**
 * The two Langy budgets, the analytics sink and the UI-action channel.
 *
 * The budgets meter through the SAME counter the public REST surface and the
 * identity half's throttles use, so a caller has one budget per rule rather
 * than one per surface. They fail OPEN when the counter has no Redis, which is
 * the behaviour the platform host pinned: a chat that stops working because the
 * cache is down is worse than an unmetered minute.
 */
function composeLangyPorts(options: LangyFeatureCollaborators, langy: LangyApp): LangyTrpcPorts {
  const logger = createLogger(`${options.processName}:langy`);
  const uiActions = () =>
    LangyUiActionService.create({
      redis: options.redis as unknown as UiActionRedis,
      conversations: {
        findByIdVisible: (args) => langy.tryFindVisible(args),
      },
      buffer: LangyTokenBuffer.create({ redis: options.redis }),
      actions: new UnavailableApiLangyUiActionCatalog(),
    });

  const budget = (input: { userId: string; projectId: string }, key: string, max: number) =>
    options
      .rateLimit({ key: `${key}:${input.projectId}:${input.userId}`, windowSeconds: 60, max })
      .then(({ allowed }) => ({ allowed }))
      .catch(() => ({ allowed: true }));

  return {
    // 30 messages a minute and 60 warms, the two budgets the platform host set.
    // Restated here because they are this process's policy rather than Langy's,
    // and the module that held them is one this migration deletes.
    checkMessageRateLimit: (input) => budget(input, "langy:rl:msg", 30),
    checkWarmRateLimit: (input) => budget(input, "langy:rl:warm", 60),
    recordProductEvent: ({ userId, projectId, event }) => {
      logger.info(
        { userId, projectId, event },
        "langy product event not recorded: this process composes no product-analytics sink",
      );
    },
    uiActions: {
      claim: (input) => uiActions().claim(input),
      complete: (input) => uiActions().complete(input),
    },
  };
}

/**
 * The page-action catalogue, absent.
 *
 * The only catalogue that exists is the experiments workbench's, and it is a
 * browser module: a Langy server package may not reach it and neither may this
 * composition root. Every kind therefore reads as unknown, which refuses a
 * DISPATCH by name. The two procedures this record mounts — `claimUiAction` and
 * `completeUiAction` — never consult it, so the page half of the channel works
 * whole.
 */
class UnavailableApiLangyUiActionCatalog extends LangyUiActionCatalogPort {
  tryFind(_kind: string): LangyUiActionDefinition | null {
    return null;
  }
}

/**
 * The two gates every customer-facing Langy procedure carries, built here
 * because neither is a permission.
 */
function composeLangyGates(options: LangyFeatureCollaborators) {
  /**
   * Refuses the demo project outright.
   *
   * `project:view` is granted to every authenticated user on the demo project,
   * so a permission check alone would expose whatever Langy chat somebody left
   * there. The server never runs Langy on the demo project, so the refusal is
   * explicit and it runs BEFORE the rollout gate.
   */
  const refuseDemoProject = async ({
    input,
    next,
  }: {
    input: { projectId?: string };
    next: () => unknown;
  }) => {
    if (options.demoProjectId && input.projectId === options.demoProjectId) {
      throw new NotFoundError("not_found", "Langy", input.projectId);
    }
    return next();
  };

  /**
   * The authoritative internal-only rollout decision, LAST in the chain so
   * membership is always proven by RBAC before the flag is read.
   *
   * The organization is resolved from the project rather than read off the
   * input: every project-scoped procedure carries only a `projectId`, and
   * evaluating an ORG-targeted rule with no organization at all is what made an
   * opted-in account read as "not enabled".
   */
  const enforceLangyAccess = async ({
    ctx,
    input,
    next,
  }: {
    ctx: unknown;
    input: { projectId?: string; organizationId?: string };
    next: () => unknown;
  }) => {
    const userId = (ctx as ApiTrpcPortsContext).actor().id;
    const organizationId =
      input.organizationId ??
      (input.projectId ? await options.projects.getOrganizationId(input.projectId) : undefined);

    const target: FeatureFlagTarget = input.projectId
      ? {
          kind: "project",
          userId,
          projectId: input.projectId,
          ...(organizationId ? { organizationId } : {}),
        }
      : organizationId
        ? { kind: "organization", userId, organizationId }
        : { kind: "user", userId };

    if (!(await options.featureFlags.isEnabled(LANGY_RELEASE_FLAG, target))) {
      // A typed handled error, not a bare NOT_FOUND: the client tells a rollout
      // gate apart from a load failure by the code on the wire.
      throw new LangyNotEnabledError();
    }
    return next();
  };

  return { refuseDemoProject, enforceLangyAccess };
}

/** The audit trail an egress allow-list change is recorded on. */
function composeLangyEgressPorts(options: LangyFeatureCollaborators): LangyEgressTrpcPorts {
  const audit = options.audit;
  const logger = createLogger(`${options.processName}:langy-egress`);
  return {
    recordAudit: async (entry) => {
      if (!audit) {
        logger.warn(
          { projectId: entry.projectId, action: entry.action },
          "langy egress change not audited: this process composed no audit sink",
        );
        return;
      }
      // Awaited rather than fired and forgotten: an allow-list change is a
      // network policy, and the record of who widened it is part of the write.
      try {
        await audit.record(entry as unknown as Parameters<ApiAuditPort["record"]>[0]);
      } catch (error) {
        logger.error({ error, action: entry.action }, "langy egress audit failed");
      }
    },
  };
}
