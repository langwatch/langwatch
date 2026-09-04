/**
 * The GATEWAY GROUP half of {@link ApiTrpcCollaborators}: the twenty
 * surfaces the AI Gateway and the governance console that steers it are
 * administered through.
 *
 *   virtualKeys.* / gatewayBudgets.* / gatewayCacheRules.* /
 *   gatewayGuardrails.* / gatewayUsage.* / gatewaySpendEvents.*
 *                            the gateway's own control plane, composed HERE
 *                            over this process's Prisma and ClickHouse
 *   personalVirtualKeys.* / routingPolicy.* / webhookEndpoints.*
 *                            the same graph's Enterprise half
 *   governance.* and the nine console surfaces beside it
 *                            what an organization is governed by
 *   subscription.* / currency.*
 *                            what it pays, and in which currency
 *
 * `github.*` used to be here too, and so did the `/` landing decision merged
 * into `governance.*`. Both compose themselves now — in
 * `features/github/github.composition.ts` and
 * `features/enterprise/governance-home.composition.ts` — off the shared
 * infrastructure. This half supplies only the `ctx.app.github` slice every
 * request context carries.
 *
 * ## This half OVERLAYS
 *
 * It folds onto a base and passes an absent base through untouched, the way the
 * analytics, execution, org-group and product-group halves do. It can genuinely
 * be missing: every surface here resolves an organization or a project through
 * the tenancy graph, and a process that composed none has no gateway to
 * administer.
 *
 * ## What is composed, and what is named absent
 *
 * The six CORE gateway namespaces are composed for real, off this process's own
 * graph — see {@link composeApiGateway}. Nothing about them is a port any more.
 *
 * `ApiEnterpriseApplicationPort.governance` is the fifteen Enterprise surfaces'
 * whole answer, and it is a port rather than a composition for a reason that is
 * a fence rather than a difficulty: `AppGovernanceRuntime.create` requires a
 * `GovernanceEventingPort` built from the ingestion-pull and pulled-usage
 * COMMAND registrations, and the event-sourcing runtime that owns them has not
 * moved out of the retired application. The only in-tree alternative is that
 * package's no-op eventing port, which would accept every ingestion-pull
 * command and queue none of them — a silent drop, which is the one thing a
 * named absence exists to prevent. Absent, all fifteen namespaces MOUNT and
 * every call refuses by name.
 *
 * The `/` landing decision is NOT behind that port. Its six signals are this
 * process's own — a row read, a plan lookup, a permission probe, a flag read —
 * and only the governance setup state comes off `ctx.app.governance`, which is
 * the same slice the five packaged `governance.*` procedures read.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { GithubService } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import type { MonitorService } from "@langwatch/monitor-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { ApiTrpcFeatureApplication } from "../app-trpc/app-trpc.context";
import type { GatewayTrpcPorts } from "../features/gateway/gateway-trpc.mount";
import {
  composeApiGateway,
  type ApiGatewayComposition,
  type ApiGatewayClickHousePort,
  type ApiGatewayIdempotencyPort,
} from "./api-gateway.composition";
import type { ApiEnterpriseApplicationPort } from "./api-trpc-collaborators.org-group.composition";

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

export type ApiGatewayGroupCollaboratorsOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The permission service this process authorizes every other surface with. */
  authz: AuthzService;
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
  /** The credential service an ingestion key is minted through. */
  apiKeys: ApiKeyService;
  /** The evaluators a guardrail runs, as the gateway's decision store reads them. */
  evaluators: EvaluatorService;
  /** The monitors a guardrail attachment names. */
  monitors: MonitorService;
  /** The GitHub App this deployment registered, blank where it registered none. */
  github: GithubService;
  /**
   * This process's ClickHouse, where the gateway's spend ledger is projected.
   * `null` where the deployment opened none.
   */
  clickhouse: ApiGatewayClickHousePort | null;
  /** The HMAC key a virtual key's stored secret is hashed under. */
  virtualKeyPepper: string | undefined;
  /** The receipt ledger the keyed gateway REST creates run through. */
  idempotency?: ApiGatewayIdempotencyPort | undefined;
  /** The Enterprise application, where the deployment composed one. */
  enterprise?: ApiEnterpriseApplicationPort | undefined;
  /** Names this process in every refusal above. */
  processName: string;
}>;

/** The application slices and the port groups this half owns, composed together. */
export type ApiGatewayGroupCollaborators = Readonly<{
  /** The six `ctx.app` slices this half owns. */
  application: Pick<
    ApiTrpcFeatureApplication,
    "gateway" | "github" | "governance" | "governanceApp" | "sessionPolicy" | "webhooks"
  >;
  /** The virtual-key budget parser — fixed when the router is BUILT. */
  gateway: GatewayTrpcPorts;
  /**
   * The gateway application, for the two REST families that take it directly.
   *
   * Exposed as well as folded onto `ctx.app`: the public REST door is handed a
   * `GatewayApp` rather than a request context, and it has to be the SAME one
   * the browser's tRPC door reads or the two enforce different rules.
   */
  gatewayApp: ApiTrpcFeatureApplication["gateway"];
  /**
   * Everything the gateway composition opened, for the two doors that need
   * more than the application.
   *
   * The billing reconciliation REST family reads the SPEND STORE directly — a
   * cursor walk and a rollup, neither of which is an operation on a virtual
   * key — and the Go data plane's internal control plane materialises a key's
   * warm-cache bundle against the decision store. Both must be the SAME stores
   * the gateway application prices a budget against, so they are exposed here
   * rather than opened a second time by whoever needs them.
   */
  composition: ApiGatewayComposition;
}>;

/** Composes the gateway-group half from this process's own graph. */
export function composeApiGatewayGroupCollaborators(
  options: ApiGatewayGroupCollaboratorsOptions,
): ApiGatewayGroupCollaborators {
  const logger = createLogger(`${options.processName}:gateway-group`);

  const gateway = composeApiGateway({
    prisma: options.prisma,
    authz: options.authz,
    projects: options.projects,
    evaluators: options.evaluators,
    monitors: options.monitors,
    clickhouse: options.clickhouse,
    virtualKeyPepper: options.virtualKeyPepper,
    ...(options.idempotency ? { idempotency: options.idempotency } : {}),
  });

  return {
    application: {
      gateway: gateway.app,
      github: options.github,
      ...enterpriseGovernanceApplication(options, logger),
    },
    // The one member that could not follow the rest onto `GatewayApp`: a tRPC
    // input parser is fixed when the router is BUILT.
    gateway: { virtualKeys: gateway.app.schemas },
    gatewayApp: gateway.app,
    composition: gateway,
  };
}

/**
 * The four Enterprise `ctx.app` slices the fifteen governance and
 * gateway-governance surfaces read, or a refusal per capability.
 *
 * A refusing application rather than an absent one, because the fifteen
 * namespaces MOUNT either way: a console asking which ingestion sources an
 * organization has must be told this deployment cannot answer, and a namespace
 * that simply is not there tells it nothing at all.
 */
function enterpriseGovernanceApplication(
  options: ApiGatewayGroupCollaboratorsOptions,
  logger: Logger,
): Pick<ApiTrpcFeatureApplication, "governance" | "governanceApp" | "sessionPolicy" | "webhooks"> {
  const governance = options.enterprise?.governance;
  if (governance) return governance;

  logger.info(
    {},
    "API composed no Enterprise governance application: the governance console, the ingestion, department, AI-tool, activity, anomaly and session surfaces, the personal virtual keys, the routing policies and the webhook endpoints all mount and refuse by name",
  );

  const refuse = (capability: string) =>
    new Proxy({} as never, {
      get: () => () => {
        throw new ApiCapabilityUnavailableError(capability);
      },
      has: () => true,
    });

  return {
    governance: refuse(
      "Enterprise governance capability, so it can neither read nor command an organization's governance",
    ),
    governanceApp: refuse(
      "Enterprise governance application, so it can neither mint a personal virtual key nor read a routing policy",
    ),
    sessionPolicy: refuse(
      "Enterprise session-policy store, so it cannot read or set an organization's session rules",
    ),
    webhooks: refuse(
      "Enterprise webhook application, so it can neither list nor register a delivery endpoint",
    ),
  } as Pick<
    ApiTrpcFeatureApplication,
    "governance" | "governanceApp" | "sessionPolicy" | "webhooks"
  >;
}
