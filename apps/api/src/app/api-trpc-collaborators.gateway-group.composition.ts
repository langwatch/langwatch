/**
 * The GATEWAY GROUP half of {@link ApiTrpcCollaborators}: the twenty-one
 * surfaces the AI Gateway and the governance console that steers it are
 * administered through, plus the one namespace beside them that answers for the
 * organization's GitHub App.
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
 *   github.*                 the GitHub App its coding agents work through
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
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { GithubService } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import type { MonitorService } from "@langwatch/monitor-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { AnyApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../app-trpc/app-trpc.context";
import type { GatewayTrpcPorts } from "../features/gateway/gateway-trpc.mount";
import type { GovernanceHomeTrpcPorts } from "../features/enterprise/governance-home.mount";
import type { GithubTrpcMountPorts } from "../features/github/github-trpc.mount";
import type { ApiAuditPort } from "../api-request.policy";
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

/**
 * The rollout gate the governance console and the /me page are both behind.
 *
 * Stated here under the key the flag registry publishes it by, because the
 * landing decision reads it and the flag store this process composed is what
 * answers. Without it `/me` and `/governance` both 404, so the auto-detected
 * destination is gated on it too — a non-governance organization never lands
 * on `/me`.
 */
const GOVERNANCE_UI_FLAG = "release_ui_ai_governance_enabled";

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
  /** This deployment's flag store, for the console's own rollout gate. */
  featureFlags: FeatureFlagService;
  /** Which plan an organization is on: the landing decision's Enterprise test. */
  plans: Pick<PlanProvider, "getActivePlan">;
  /** The GitHub App this deployment registered, blank where it registered none. */
  github: GithubService;
  /** The audit trail a GitHub connection command is written to. */
  audit: ApiAuditPort | undefined;
  /**
   * This process's ClickHouse, where the gateway's spend ledger is projected.
   * `null` where the deployment opened none.
   */
  clickhouse: ApiGatewayClickHousePort | null;
  /** The HMAC key a virtual key's stored secret is hashed under. */
  virtualKeyPepper: string | undefined;
  /** Whether this installation bills through Stripe. */
  saasBilling: boolean;
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
  /** The six answers the `/` landing decision is gathered from. */
  governanceHome: GovernanceHomeTrpcPorts;
  /** Whether this installation bills through Stripe. */
  saasBilling: boolean;
  /** The `github` entry beside it: one namespace, two answers nobody else owns. */
  github: GithubTrpcMountPorts;
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
    governanceHome: governanceHomePorts(options),
    saasBilling: options.saasBilling,
    github: githubPorts(options, logger),
    gatewayApp: gateway.app,
    composition: gateway,
  };
}

/**
 * The six answers the `/` landing decision is gathered from.
 *
 * Every one of them runs on this process's own graph rather than on a service
 * locator the way the retired router's version did — which is what makes the
 * decision composable twice (a test, a second deployment shape) instead of
 * reachable only from a booted application.
 */
function governanceHomePorts(
  options: ApiGatewayGroupCollaboratorsOptions,
): GovernanceHomeTrpcPorts {
  const { prisma } = options;
  return {
    tryFindFirstProjectSlugForMember: async ({ organizationId, userId }) => {
      const project = await prisma.project.findFirst({
        where: {
          team: {
            organizationId,
            members: { some: { userId } },
            // Personal workspaces are the governance data home, never a
            // navigable organization project (ADR-038 v6).
            isPersonal: false,
          },
          archivedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: { slug: true },
      });
      return project?.slug ?? null;
    },

    tryFindFirstProjectSlug: async ({ organizationId }) => {
      const project = await prisma.project.findFirst({
        where: { team: { organizationId, isPersonal: false }, archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: { slug: true },
      });
      return project?.slug ?? null;
    },

    isEnterprisePlan: async ({ organizationId }) =>
      (await options.plans.getActivePlan({ organizationId })).type === "ENTERPRISE",

    canManageOrganization: ({ organizationId, userId }) =>
      options.authz.hasPermission({ userId, permission: "organization:manage", organizationId }),

    tryGetPinnedHomePath: async ({ userId }) => {
      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { lastHomePath: true },
      });
      return row?.lastHomePath ?? null;
    },

    governanceUiEnabled: ({ organizationId, userId }) =>
      options.featureFlags.isEnabled(GOVERNANCE_UI_FLAG as never, {
        kind: "organization",
        userId,
        organizationId,
      } as never),

    tryGetPrimaryIntent: async ({ organizationId }) => {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { primaryIntent: true },
      });
      return organization?.primaryIntent ?? null;
    },
  };
}

/**
 * The two answers `github.*` reaches that GitHub does not own.
 *
 * The organization is derived from the project rather than taken from the
 * client: the pull-request read is project-scoped because that is how a caller
 * reaches it, and a caller naming an organization id could otherwise ask about
 * another tenant's pull requests.
 */
function githubPorts(
  options: ApiGatewayGroupCollaboratorsOptions,
  logger: Logger,
): GithubTrpcMountPorts {
  return {
    tryResolveOrganizationForProject: async (projectId) => {
      const project = await options.prisma.project.findUnique({
        where: { id: projectId },
        select: { team: { select: { organizationId: true } } },
      });
      return project?.team.organizationId ?? undefined;
    },
    recordAudit: async (entry) => {
      await options.audit?.record({
        actorId: entry.userId,
        path: entry.action,
        input: { organizationId: entry.organizationId, ...entry.args },
        error: null,
      });
      logger.debug({ action: entry.action }, "recorded a GitHub connection command");
    },
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
): Pick<
  ApiTrpcFeatureApplication,
  "governance" | "governanceApp" | "sessionPolicy" | "webhooks"
> {
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

/**
 * Folds this half onto a collaborator set, leaving every other entry alone.
 *
 * An absent group passes the base through rather than replacing entries with
 * gaps: the seal is what refuses a set nobody filled, and it names what is
 * missing instead of mounting twenty-two namespaces over it.
 */
export function withApiGatewayGroupCollaborators(
  base: AnyApiTrpcCollaborators | undefined,
  group: ApiGatewayGroupCollaborators | undefined,
): AnyApiTrpcCollaborators | undefined {
  if (!base || !group) return base;
  return {
    ...base,
    gateway: group.gateway,
    governanceHome: group.governanceHome,
    saasBilling: group.saasBilling,
    github: group.github,
    application: {
      ...base.application,
      ...group.application,
    },
  } as unknown as AnyApiTrpcCollaborators;
}
