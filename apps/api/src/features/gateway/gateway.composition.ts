/**
 * The AI Gateway, composed as its own feature. Six tRPC namespaces, one `ctx.app` slice
 * and two REST families, all over ONE application — which is the whole reason this is a
 * composition rather than a per-door port bag.
 */
import { HandledError } from "@langwatch/handled-error";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { virtualKeyBudgetInputSchema } from "@langwatch/gateway-server";
import type { MonitorService } from "@langwatch/monitor-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import {
  composeApiGateway,
  type ApiGatewayClickHousePort,
  type ApiGatewayComposition,
  type ApiGatewayIdempotencyPort,
} from "../../app/api-gateway.composition";
import { createGatewayTrpcRouters } from "./gateway-trpc.mount";

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
  projects: ProjectService;
  /** The evaluators a guardrail rule runs, as the decision store reads them. */
  evaluators: EvaluatorService;
  /** The monitors a guardrail attachment names. */
  monitors: MonitorService;
}>;

export type GatewayFeatureOptions = Readonly<{
  /** Absent where this process opened no database; see the file docblock. */
  infrastructure: ApiTrpcInfrastructure | undefined;
  /** Absent where this process composed none of them; see the file docblock. */
  peers: GatewayPeers | undefined;
  /**
   * This process's ClickHouse, where the gateway ledger is projected. `null`
   * where the deployment opened none, which turns the spend source off by name
   * rather than by a zero nobody can tell from a key that spent nothing.
   */
  clickhouse: ApiGatewayClickHousePort | null;
  /** The HMAC key a virtual key's stored secret is hashed under. */
  virtualKeyPepper: string | undefined;
  /** The receipt ledger the keyed REST creates run through, where one exists. */
  idempotency?: ApiGatewayIdempotencyPort | undefined;
}>;

/** What the gateway's three kinds of door are given. */
export type ComposedGatewayFeature = Readonly<{
  /** The `ctx.app.gateway` slice, and what the two REST families are handed. */
  app: ApiTrpcFeatureApplication["gateway"];
  /**
   * Everything the composition opened, for the two doors that need more than the
   * application: the billing reconciliation family walks the spend store directly, and
   * the Go data plane materialises a key's warm-cache bundle against the decision store.
   */
  composition: ApiGatewayComposition | undefined;
  /** The six namespaces, built on the process's own root. */
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createGatewayTrpcRouters>;
}>;

/** Composes the gateway over this process's graph, or over its refusals. */
export function composeGatewayFeature(options: GatewayFeatureOptions): ComposedGatewayFeature {
  const { infrastructure, peers } = options;
  if (!infrastructure || !peers) return refusingGateway();

  const composition = composeApiGateway({
    prisma: infrastructure.prisma,
    authz: infrastructure.authz,
    projects: peers.projects,
    evaluators: peers.evaluators,
    monitors: peers.monitors,
    clickhouse: options.clickhouse,
    virtualKeyPepper: options.virtualKeyPepper,
    ...(options.idempotency ? { idempotency: options.idempotency } : {}),
  });

  return {
    app: composition.app,
    composition,
    // The one thing that could not follow the rest onto `GatewayApp`: a tRPC
    // input parser is fixed when the router is BUILT.
    router: (mount) =>
      createGatewayTrpcRouters({ ...mount, ports: { virtualKeys: composition.app.schemas } }),
  };
}

const logger: Pick<Logger, "info"> = createLogger("langwatch:api:gateway");

/**
 * The gateway on a process that composed none of its peers. The schemas are REAL — they
 * are this feature's own parsers, not a peer's, so the six namespaces build and publish
 * the same inputs they always did.
 */
function refusingGateway(): ComposedGatewayFeature {
  logger.info(
    {},
    "API composed no gateway application: the virtual keys, budgets, cache rules, guardrails, usage and spend-event surfaces all mount and refuse by name",
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

  return {
    app,
    composition: undefined,
    router: (mount) =>
      createGatewayTrpcRouters({ ...mount, ports: { virtualKeys: GATEWAY_INPUT_SCHEMAS } }),
  };
}

/**
 * The virtual-key input parsers, read off the package rather than off an
 * application this process may not have composed. They are the SAME parsers
 * {@link composeApiGateway} puts on the real application.
 */
const GATEWAY_INPUT_SCHEMAS = { virtualKeyBudgetInput: virtualKeyBudgetInputSchema };
