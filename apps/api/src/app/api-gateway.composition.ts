/**
 * The AI Gateway's application, composed once for this process. Moved whole out of
 * `platform/app/src/server/app-layer/presets.ts`, where it was `composeGatewayApp` over
 * an `AppDependencies["gateway"]` bag the App built.
 */
import type { ApiKeyPermissionScope, AuthzService } from "@langwatch/authz-contract";
import {
  GatewayApp,
  GatewayApplicableBudgetsService,
  GatewayBudgetLedgerAdapter,
  GatewayScopePermissionsPort,
  GatewaySpendEventsClickHouseAdapter,
  GatewaySpendEventsService,
  GatewayUsageService,
  GatewayVirtualKeyDtoAdapter,
  GatewayVirtualKeySpendAdapter,
  PrismaGatewayAdapter,
  VirtualKeyAuthorizationService,
  VirtualKeyCryptoAdapter,
  VirtualKeyDirectBudgetService,
  VirtualKeyService,
  type GatewayBudgetSpendPort,
  type GatewayClickHouseClient,
  type GatewayClickHouseResolver,
  type GatewayGovernanceSignalsPort,
  type GatewayPermissionScope,
  type GatewayService,
  type GatewayVirtualKeySpendPort,
  type MembershipSet,
  type VirtualKeyActor,
  virtualKeyBudgetInputSchema,
  GatewayScopeResolutionService,
} from "@langwatch/gateway-server";
import { PrismaGatewayAuditRepository } from "@langwatch/gateway-server/composition/gateway-audit";
import { PrismaGatewayChangeEventsRepository } from "@langwatch/gateway-server/composition/gateway-change-events";
import { PrismaGatewayVirtualKeyRepository } from "@langwatch/gateway-server/composition/gateway-virtual-keys";
import { PrismaGatewayProviderLabelRepository } from "@langwatch/gateway-server/composition/gateway-provider-labels";
import type { IdempotentRunner } from "@langwatch/api/rest";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { HandledError } from "@langwatch/handled-error";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectIdentity, ProjectService } from "@langwatch/project-contract";
import { TRPCError } from "@trpc/server";
import { PrismaGatewayKeyBudgetRepository } from "@langwatch/gateway-server/composition/gateway-key-budgets";
import { PrismaVirtualKeyAuthorizationRepository } from "@langwatch/gateway-server/composition/gateway-virtual-key-authorization";
import { PrismaVirtualKeyDirectBudgetRepository } from "@langwatch/gateway-server/composition/gateway-virtual-key-direct-budgets";
import { PrismaGatewayScopeResolutionRepository } from "@langwatch/gateway-server/composition/gateway-scope-resolution";
import { PrismaGatewayTransactionAdapter } from "@langwatch/gateway-server/composition/gateway-transactions";

const virtualKeyDtos = GatewayVirtualKeyDtoAdapter.create();
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
 * The receipt ledger a keyed REST create dispatches through. A port rather than a direct
 * dependency because the ledger — the `IdempotencyReceipt` claim, its heartbeat and its
 * takeover window — needs a database AND a cipher, and a deployment can hold neither.
 */
export abstract class ApiGatewayIdempotencyPort {
  abstract readonly run: IdempotentRunner;
}

/**
 * The ClickHouse this process's gateway ledger runs on, as one resolution. `null` where
 * the process opened none. The gateway's spend is a projection in that instance, so a
 * deployment holding no trace storage holds no spend to price a budget against.
 */
export type ApiGatewayClickHousePort = Readonly<{
  resolve(tenantId: string): Promise<GatewayClickHouseClient>;
}>;

/**
 * The two questions a virtual-key write is authorized by, answered from this process's
 * own AuthZ service.
 */
class ApiGatewayScopePermissions extends GatewayScopePermissionsPort {
  static create(authz: AuthzService): ApiGatewayScopePermissions {
    return new ApiGatewayScopePermissions(authz);
  }

  private constructor(private readonly authz: AuthzService) {
    super();
  }

  sessionHolds(input: {
    userId: string;
    permission: Parameters<AuthzService["hasPermission"]>[0]["permission"];
    scope: GatewayPermissionScope;
  }): Promise<boolean> {
    const scope =
      input.scope.type === "org"
        ? { organizationId: input.scope.id }
        : input.scope.type === "team"
          ? { teamId: input.scope.id }
          : { projectId: input.scope.id };
    return this.authz.hasPermission({
      userId: input.userId,
      permission: input.permission,
      ...scope,
    } as Parameters<AuthzService["hasPermission"]>[0]);
  }

  apiKeyHolds(input: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    permission: Parameters<AuthzService["hasPermission"]>[0]["permission"];
    scope: GatewayPermissionScope;
  }): Promise<boolean> {
    return this.authz.hasApiKeyPermission({
      apiKeyId: input.apiKeyId,
      userId: input.userId,
      organizationId: input.organizationId,
      permission: input.permission,
      // Structurally the same union, restated by the AuthZ contract under its
      // own name. Named rather than cast so a divergence is a compile error.
      scope: input.scope satisfies ApiKeyPermissionScope,
    });
  }
}

export type ApiGatewayCompositionOptions = Readonly<{
  /** The one guarded connection every gateway row read below runs on. */
  prisma: PrismaClient;
  /** The permission service every other surface on this process authorizes with. */
  authz: AuthzService;
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
  /** The evaluators a guardrail rule runs, as the budget-decision store reads them. */
  evaluators: EvaluatorService;
  /** The monitors a guardrail attachment names. */
  monitors: MonitorService;
  /**
   * This process's ClickHouse, where the gateway ledger is projected. `null`
   * where the deployment opened none, which turns the spend source off by name
   * rather than by a zero.
   */
  clickhouse: ApiGatewayClickHousePort | null;
  /** The HMAC key a virtual key's stored secret is hashed under. */
  virtualKeyPepper: string | undefined;
  /** The receipt ledger the keyed REST creates run through, where one exists. */
  idempotency?: ApiGatewayIdempotencyPort | undefined;
  /**
   * Where a virtual key's lifecycle is announced, where the deployment composed a ledger
   * for it.
   */
  governanceSignals?: GatewayGovernanceSignalsPort | undefined;
}>;

/** What this composition opened, for the doors that need more than the application. */
export type ApiGatewayComposition = Readonly<{
  /** The one application all seven gateway doors are given. */
  app: GatewayApp;
  /** The virtual-key operations service, as the governance console mints through it. */
  virtualKeys: VirtualKeyService;
  /** The ClickHouse budget ledger, or `undefined` on a process with no ClickHouse. */
  budgetSpend: GatewayBudgetSpendPort | undefined;
  /** The per-key spend rollup, or `undefined` for the same reason. */
  virtualKeySpend: GatewayVirtualKeySpendPort | undefined;
  /** The spend-event feed the REST spend family reads, on the same terms. */
  spendEvents: GatewaySpendEventsService | undefined;
  /**
   * The budget, cache-rule and guardrail decision store.
   */
  budgetDecisions: GatewayService;
}>;

/**
 * Composes the gateway application from this process's own graph. Everything passed in is
 * either a capability built over persistence the feature package cannot reach, or a
 * decision made against role bindings and memberships it cannot see.
 */
export function composeApiGateway(options: ApiGatewayCompositionOptions): ApiGatewayComposition {
  const { prisma, authz, projects, clickhouse } = options;
  const permissions = ApiGatewayScopePermissions.create(authz);
  const virtualKeyAuthorization = VirtualKeyAuthorizationService.create({
    directory: PrismaVirtualKeyAuthorizationRepository.create({ database: prisma }),
  });
  const resolveClickHouse: GatewayClickHouseResolver | undefined = clickhouse
    ? (tenantId) => clickhouse.resolve(tenantId)
    : undefined;

  const virtualKeys = VirtualKeyService.create({
    transactions: PrismaGatewayTransactionAdapter.create({ database: prisma }),
    keyBudgets: PrismaGatewayKeyBudgetRepository.create({ database: prisma }),
    scopeResolution: GatewayScopeResolutionService.create({
      repository: PrismaGatewayScopeResolutionRepository.create({ database: prisma }),
    }),
    projects,
    repository: PrismaGatewayVirtualKeyRepository.create(prisma),
    changeEvents: PrismaGatewayChangeEventsRepository.create(prisma),
    auditLog: PrismaGatewayAuditRepository.create(prisma),
    crypto: VirtualKeyCryptoAdapter.create({ pepper: options.virtualKeyPepper }),
    governanceSignals: options.governanceSignals,
  });

  const budgetSpend = resolveClickHouse
    ? GatewayBudgetLedgerAdapter.create(resolveClickHouse)
    : undefined;
  const virtualKeySpend = resolveClickHouse
    ? GatewayVirtualKeySpendAdapter.create(resolveClickHouse)
    : undefined;
  const spendEvents = resolveClickHouse
    ? GatewaySpendEventsService.create(
        GatewaySpendEventsClickHouseAdapter.create(resolveClickHouse),
      )
    : undefined;

  const budgetDecisions = PrismaGatewayAdapter.create({
    database: prisma,
    projects,
    evaluators: options.evaluators,
    monitors: options.monitors,
    // The change feed the Go data plane long-polls and the audit trail every
    // cache-rule and guardrail command is written to. Both are Prisma
    // repositories the feature package owns; the process only names the
    // connection they run on.
    changes: PrismaGatewayChangeEventsRepository.create(prisma),
    audit: PrismaGatewayAuditRepository.create(prisma),
    budgetSpend,
  }).build();

  const usage = GatewayUsageService.create({
    projects,
    // The usage rollup needs a label per key the ledger reported spend
    // against, which is a repository read; `virtualKeys` above is the
    // operations service the gateway application itself is built on.
    virtualKeys: PrismaGatewayVirtualKeyRepository.create(prisma),
    chRepo: budgetSpend,
    spendRepo: virtualKeySpend,
  });

  const idempotency: IdempotentRunner =
    options.idempotency?.run ??
    (() => {
      throw new ApiCapabilityUnavailableError(
        "idempotency receipt ledger, so it cannot accept a create that carries an Idempotency-Key",
      );
    });

  // No type arguments: the two budget row shapes the wire contract carries are
  // named by `@langwatch/gateway-contract` (`GatewayApplicableBudget`,
  // `GatewayVirtualKeyDirectBudget`), so the application declares them itself
  // instead of taking them as parameters a router could not propagate.
  const app = GatewayApp.create({
    virtualKeys,
    budgetDecisions,
    budgetSpend,
    virtualKeySpend,
    spendEvents,
    projects,
    usage,
    idempotency,
    // A deployment without the ClickHouse spend source answers
    // `spend_source_unavailable` rather than a $0.00 that cannot be told apart
    // from a key that genuinely spent nothing.
    spendSourceAvailable: virtualKeySpend !== undefined,
    schemas: { virtualKeyBudgetInput: virtualKeyBudgetInputSchema },

    organizationIdForProject: async (projectId) => {
      const found = await prisma.project.findUnique({
        where: { id: projectId },
        include: { team: true },
      });
      if (!found) throw new Error(`project ${projectId} missing team`);
      return found.team.organizationId;
    },
    assertOrganizationExists: async (organizationId) => {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
      });
      if (!organization) {
        throw new TRPCError({ code: "NOT_FOUND", message: "organization not found" });
      }
    },
    resolveProviderLabels: (budgets) =>
      PrismaGatewayProviderLabelRepository.create(prisma).resolveProviderLabels([...budgets]),
    listGroupTargets: async (organizationId) => {
      const groups = await prisma.group.findMany({
        where: { organizationId },
        select: { id: true, name: true, _count: { select: { members: true } } },
        orderBy: { name: "asc" },
      });
      return groups.map((group) => ({
        id: group.id,
        name: group.name,
        memberCount: group._count.members,
      }));
    },
    groupMemberCounts: async (budgets) => {
      const groupIds = Array.from(
        new Set(budgets.filter((b) => b.scopeType === "GROUP").map((b) => b.scopeId)),
      );
      if (groupIds.length === 0) return new Map();
      const groups = await prisma.group.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, _count: { select: { members: true } } },
      });
      return new Map(groups.map((group) => [group.id, group._count.members]));
    },
    // The label per key a page of spend rows carries, read through the gateway feature's
    // OWN persistence rather than by a key-table `findMany` written here.
    resolveVirtualKeyNames: (input) => virtualKeys.resolveNames(input),
    isOrganizationMember: async ({ organizationId, userId }) =>
      (await prisma.organizationUser.findFirst({
        where: { organizationId, userId },
        select: { userId: true },
      })) !== null,
    // A scoped API key acts as its owning user; a legacy project key carries
    // none, so it acts as a stable machine principal for its project, which
    // keeps an audit row traceable back to the credential that wrote it.
    actorForCredential: ({ projectId, resolvedToken }) =>
      resolvedToken?.type === "apiKey"
        ? {
            actor: {
              kind: "apiKey",
              apiKeyId: resolvedToken.apiKeyId,
              userId: resolvedToken.userId,
              organizationId: resolvedToken.organizationId,
            } satisfies VirtualKeyActor,
            actorUserId: resolvedToken.userId ?? `svc_${projectId}`,
          }
        : {
            actor: { kind: "legacyProjectKey", projectId } satisfies VirtualKeyActor,
            actorUserId: `svc_${projectId}`,
          },

    listVisibleVirtualKeys: async ({ organizationId, userId }) => {
      const membership = await virtualKeyAuthorization.loadMembershipSet({
        organizationId,
        userId,
      });
      return (await virtualKeys.getAll(organizationId)).filter((virtualKey) =>
        virtualKeyAuthorization.isVisibleToMembership(membership, virtualKey.scopes),
      );
    },
    isVirtualKeyVisible: async ({ organizationId, userId, virtualKey }) =>
      virtualKeyAuthorization.isVisibleToMembership(
        await virtualKeyAuthorization.loadMembershipSet({ organizationId, userId }),
        virtualKey.scopes,
      ),
    requireVisibleVirtualKeyForUser: async ({ organizationId, id, userId }) =>
      virtualKeyAuthorization.getVisibleVk(
        virtualKeys,
        await virtualKeyAuthorization.loadMembershipSet({ organizationId, userId }),
        {
          id,
          organizationId,
        },
      ),
    visibleToProjectCredential: ({ project, virtualKeys: page }) => {
      const membership = membershipForProjectCredential(project);
      return page.filter((virtualKey) =>
        virtualKeyAuthorization.isVisibleToMembership(membership, virtualKey.scopes),
      );
    },
    requireVisibleVirtualKeyForProjectCredential: ({ project, id, organizationId }) =>
      virtualKeyAuthorization.getVisibleVk(
        virtualKeys,
        membershipForProjectCredential(project),
        {
          id,
          organizationId,
        },
      ),
    requireExistingVirtualKey: ({ organizationId, id }) =>
      virtualKeyAuthorization.getExistingVk(virtualKeys, id, organizationId),

    assertCanManageAllScopes: ({ actor, scopes }) =>
      virtualKeyAuthorization.assertActorCanManageAllScopes(
        { permissions, actor: gatewayVirtualKeyActor(actor) },
        [...scopes],
      ),
    assertCanOperateOnAnyScope: ({ actor, scopes, permission }) =>
      virtualKeyAuthorization.assertActorCanOperateOnAnyScope(
        { permissions, actor: gatewayVirtualKeyActor(actor) },
        [...scopes],
        permission,
      ),
    assertScopesBelongToOrganization: ({ organizationId, scopes }) =>
      virtualKeyAuthorization.assertScopesBelongToOrg({ organizationId, scopes: [...scopes] }),
    assertTraceProjectBelongsToOrganization: ({ organizationId, traceProjectId }) =>
      virtualKeyAuthorization.assertTraceProjectBelongsToOrg({ organizationId, traceProjectId }),
    assertGuardrailAttachmentsAllowed: ({ actor, projectId, attachments }) =>
      virtualKeyAuthorization.assertGuardrailAttachmentsAllowed(
        { permissions, actor: gatewayVirtualKeyActor(actor) },
        projectId,
        attachments ? [...attachments] : undefined,
      ),
    resolveVirtualKeyProjectId: ({ organizationId, virtualKeyId, scopes, traceProjectId }) =>
      virtualKeyAuthorization.tryResolveVkProjectId({
        organizationId,
        vkId: virtualKeyId,
        inputScopes: scopes ? [...scopes] : undefined,
        traceProjectId,
      }),

    // One read of the destinations for a whole page, in both casings: a
    // listing must not cost a query per key to say where its traffic goes.
    toVirtualKeyCamelDtos: async ({ virtualKeys: page }) => {
      const facts = await virtualKeyDtos.loadTraceDestinationFacts({
        projects,
        virtualKeys: [...page],
      });
      return page.map((virtualKey) => virtualKeyDtos.toVirtualKeyCamelDto({ virtualKey, facts }));
    },
    toVirtualKeySnakeDtos: async ({ virtualKeys: page }) => {
      const facts = await virtualKeyDtos.loadTraceDestinationFacts({
        projects,
        virtualKeys: [...page],
      });
      return page.map((virtualKey) => virtualKeyDtos.toVirtualKeySnakeDto({ virtualKey, facts }));
    },
    resolveApplicableBudgets: ({ target }) =>
      GatewayApplicableBudgetsService.create({
        budgetDecisions,
        providerLabels: PrismaGatewayProviderLabelRepository.create(prisma),
      }).resolveApplicableBudgetsForDraftKey(
        projects,
        { ...target, scopes: [...target.scopes] },
        budgetSpend,
      ),
    loadDirectBudgetsForKeys: ({ organizationId, virtualKeyIds, now }) =>
      VirtualKeyDirectBudgetService.create({
        repository: PrismaVirtualKeyDirectBudgetRepository.create({ database: prisma }),
      }).loadDirectBudgetsForKeys({
        organizationId,
        virtualKeyIds: [...virtualKeyIds],
        chRepo: budgetSpend,
        now,
      }),
    spendByVirtualKey: ({ organizationId, virtualKeyIds, window }) =>
      usage.spendByVirtualKey({
        organizationId,
        virtualKeyIds: [...virtualKeyIds],
        window,
      }),
  });

  return { app, virtualKeys, budgetSpend, virtualKeySpend, spendEvents, budgetDecisions };
}

/**
 * The caller as the virtual-key authorization vocabulary names them, whichever door they
 * arrived through.
 */
function gatewayVirtualKeyActor(actor: unknown): VirtualKeyActor {
  if (typeof actor !== "object" || actor === null) {
    return { kind: "session", session: null };
  }
  if (!("kind" in actor)) {
    return { kind: "session", session: sessionActor(actor) };
  }
  if (
    actor.kind === "apiKey" &&
    "apiKeyId" in actor &&
    typeof actor.apiKeyId === "string" &&
    "organizationId" in actor &&
    typeof actor.organizationId === "string" &&
    "userId" in actor &&
    (typeof actor.userId === "string" || actor.userId === null)
  ) {
    return {
      kind: "apiKey",
      apiKeyId: actor.apiKeyId,
      userId: actor.userId,
      organizationId: actor.organizationId,
    };
  }
  if (
    actor.kind === "legacyProjectKey" &&
    "projectId" in actor &&
    typeof actor.projectId === "string"
  ) {
    return { kind: "legacyProjectKey", projectId: actor.projectId };
  }
  return { kind: "session", session: null };
}

/**
 * The one member the authorization vocabulary reads off a browser session: the signed-in
 * person's id. Narrower than the platform application's check, which asserted a whole
 * NextAuth `Session` including its `expires` string.
 */
function sessionActor(value: object): { user: { id: string } } | null {
  if (!("user" in value)) return null;
  const user = value.user;
  if (typeof user !== "object" || user === null) return null;
  if (!("id" in user) || typeof user.id !== "string") return null;
  return { user: { id: user.id } };
}

/**
 * A project credential stands in for someone working in its project, so it sees
 * organization-scoped keys, its own team's keys and its own project's — and not
 * a sibling team's. The same rule the tRPC list applies to a member.
 */
function membershipForProjectCredential(project: ProjectIdentity): MembershipSet {
  return {
    isOrgMember: true,
    isOrgAdmin: false,
    teamIds: new Set([project.teamId]),
    projectIds: new Set([project.id]),
  };
}
