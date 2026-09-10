/**
 * The AI Gateway, composed as its own feature. Six tRPC namespaces, one `ctx.app` slice
 * and two REST families, all over ONE application — which is the whole reason this is a
 * composition rather than a per-door port bag.
 */
import { HandledError } from "@langwatch/handled-error";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { virtualKeyBudgetInputSchema } from "@langwatch/gateway-contract";
import {
  gatewayServer,
  ModelCatalogGatewaySpendRatingAdapter,
  type GatewayRestInfrastructure,
  type GatewaySpendConfirmation,
} from "@langwatch/gateway-server";
import {
  MemoryGatewayAgentCacheEntryStore,
  RedisGatewayAgentCacheEntryStore,
} from "@langwatch/gateway-server/composition/gateway-agent-cache-store";
import { PrismaGatewayElevenLabsCredentialRepository } from "@langwatch/gateway-server/composition/gateway-elevenlabs-credentials";
import { PrismaGatewayRealtimeSessionRepository } from "@langwatch/gateway-server/composition/gateway-realtime-sessions";
import type { MonitorService } from "@langwatch/monitor-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { createApp } from "@langwatch/runtime-composition";
import type { SecretEncryption } from "@langwatch/secret-server";

import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import {
  composeApiGateway,
  type ApiGatewayClickHouse,
  type ApiGatewayIdempotency,
} from "../../app/api-gateway.composition.ts";

/** A capability this deployment did not compose, refused by name. */
class ApiCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiCapabilityUnavailableError";
  }
}

/** The other features' services the gateway reaches, named one by one. */
export type GatewayPeers = Readonly<{
  /** The project directory a virtual key's scope is resolved against. */
  projects: ProjectApi;
  /** The evaluators a guardrail rule runs, as the decision store reads them. */
  evaluators: EvaluatorApi;
  /** The monitors a guardrail attachment names. */
  monitors: MonitorService;
}>;

export type GatewayFeatureOptions = Readonly<{
  /**
   * Absent where this process opened no database; see the file docblock.
   * Narrowed to what this feature actually reads, so a caller composing a
   * fixture never needs a full process infrastructure double.
   */
  infrastructure: Pick<ApiTrpcInfrastructure, "prisma" | "authz"> | undefined;
  /** Absent where this process composed none of them; see the file docblock. */
  peers: GatewayPeers | undefined;
  /**
   * This process's ClickHouse, where the gateway ledger is projected. `null`
   * where the deployment opened none, which turns the spend source off by name
   * rather than by a zero nobody can tell from a key that spent nothing.
   */
  clickhouse: ApiGatewayClickHouse | null;
  /** The HMAC key a virtual key's stored secret is hashed under. */
  virtualKeyPepper: string | undefined;
  /** The receipt ledger the keyed REST creates run through, where one exists. */
  idempotency?: ApiGatewayIdempotency | undefined;
  /** Absent without encryption, preserving the agent-cache family's conditional mount. */
  agentCache?: GatewayRestInfrastructure["agentCache"];
  /** Absent where the process does not mount the vendor callback. */
  elevenLabsWebhook?: GatewayRestInfrastructure["elevenLabsWebhook"];
}>;

import { createGatewayTrpcRouters } from "./gateway-trpc.mount.ts";
import type { ComposedGatewayFeature } from "./gateway.composition.types.ts";
import { ApiGatewayModelProviderCredentials } from "./gateway-model-provider-credentials.adapter.ts";

export function composeGatewayAgentCache(options: {
  encryption: SecretEncryption | undefined;
  redis: RedisConnection | undefined;
}): GatewayFeatureOptions["agentCache"] {
  if (!options.encryption) return void 0;

  return {
    store: options.redis
      ? RedisGatewayAgentCacheEntryStore.create(options.redis)
      : MemoryGatewayAgentCacheEntryStore.create(),
    encryption: options.encryption,
  };
}

export function composeGatewayElevenLabsWebhook(options: {
  prisma: PrismaClient | undefined;
  encryption: SecretEncryption | undefined;
  spendConfirmation: GatewaySpendConfirmation | undefined;
}): GatewayFeatureOptions["elevenLabsWebhook"] {
  if (!options.prisma || !options.encryption || !options.spendConfirmation) return void 0;

  return {
    credentials: {
      providers: PrismaGatewayElevenLabsCredentialRepository.create({
        database: options.prisma,
      }),
      credentials: ApiGatewayModelProviderCredentials.create(options.encryption),
    },
    sessions: {
      sessions: PrismaGatewayRealtimeSessionRepository.create({ database: options.prisma }),
      spendRating: ModelCatalogGatewaySpendRatingAdapter.create(),
      spendConfirmation: options.spendConfirmation,
    },
  };
}

/**
 * Installs the gateway on this process: it boots the module at `role: "api"`
 * over the graph the process opened, or answers the refusing twin where the
 * process opened none of it.
 */
export async function installApiGateway(
  options: GatewayFeatureOptions,
): Promise<ComposedGatewayFeature> {
  const { infrastructure, peers } = options;
  if (!infrastructure || !peers) {
    const restApp = await installGatewayRestAvailability(options);
    return refusingGateway(restApp, options);
  }

  const composition = await composeApiGateway({
    prisma: infrastructure.prisma,
    authz: infrastructure.authz,
    projects: peers.projects,
    evaluators: peers.evaluators,
    monitors: peers.monitors,
    clickhouse: options.clickhouse,
    virtualKeyPepper: options.virtualKeyPepper,
    ...(options.idempotency ? { idempotency: options.idempotency } : {}),
    ...(options.agentCache ? { agentCache: options.agentCache } : {}),
    ...(options.elevenLabsWebhook ? { elevenLabsWebhook: options.elevenLabsWebhook } : {}),
  });

  return {
    app: composition.app,
    composition,
    routers: (mount) => createGatewayTrpcRouters(mount.runtime),
    restServices: gatewayRestServices(composition.app, options),
  };
}

async function installGatewayRestAvailability(
  options: GatewayFeatureOptions,
): Promise<ApiTrpcFeatureApplication["gateway"] | undefined> {
  if (!options.agentCache && !options.elevenLabsWebhook) return void 0;

  const infrastructure: GatewayRestInfrastructure = {
    ...(options.agentCache ? { agentCache: options.agentCache } : {}),
    ...(options.elevenLabsWebhook ? { elevenLabsWebhook: options.elevenLabsWebhook } : {}),
  };
  const runtime = await createApp({ name: "langwatch-api" })
    .withInfrastructure({})
    .withModule(gatewayServer, { infrastructure })
    .boot({ role: "api" });

  return runtime.module(gatewayServer).provided;
}

function gatewayRestServices(
  app: ApiTrpcFeatureApplication["gateway"],
  options: GatewayFeatureOptions,
): ComposedGatewayFeature["restServices"] {
  return {
    ...(options.agentCache ? { agentCache: () => app } : {}),
    ...(options.elevenLabsWebhook ? { elevenLabsWebhook: () => app } : {}),
  };
}

const logger: Pick<Logger, "info"> = createLogger("langwatch:api:gateway");

/**
 * The gateway on a process that composed none of its peers. The schemas are REAL — they
 * are this feature's own parsers, not a peer's, so the six namespaces build and publish
 * the same inputs they always did.
 */
function refusingGateway(
  restApp?: ApiTrpcFeatureApplication["gateway"],
  options?: GatewayFeatureOptions,
): ComposedGatewayFeature {
  logger.info(
    {},
    "API installed no gateway application: the virtual keys, budgets, cache rules, guardrails, usage and spend-event surfaces all mount and refuse by name",
  );

  const app = new Proxy({} as ApiTrpcFeatureApplication["gateway"], {
    get: (_target, member) =>
      member === "schemas"
        ? GATEWAY_INPUT_SCHEMAS
        : () => {
            throw new ApiCapabilityUnavailableError(
              "AI Gateway application, so it can neither read nor command a virtual key",
            );
          },
    has: () => true,
  });

  // The six converted namespaces mount either way, so a client's inferred
  // types never depend on the deployment shape; every call then refuses by
  // name instead of showing a tenant with no budgets in it.
  return {
    app,
    composition: undefined,
    routers: (mount) => createGatewayTrpcRouters(mount.runtime),
    restServices: restApp && options ? gatewayRestServices(restApp, options) : {},
  };
}

/**
 * The virtual-key input parsers, read off the package rather than off an
 * application this process may not have composed. They are the SAME parsers
 * {@link composeApiGateway} puts on the real application.
 */
const GATEWAY_INPUT_SCHEMAS = { virtualKeyBudgetInput: virtualKeyBudgetInputSchema };
