import type { AuthzApi, AuthzPermission, ApiKeyPermissionScope } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { virtualKeyBudgetInputSchema } from "@langwatch/gateway-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";

import { GatewayBudgetClickHouseRepository } from "../repositories/clickhouse/clickhouse.gateway-budget.repository.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../repositories/clickhouse/clickhouse.gateway-spend-events.repository.ts";
import { GatewayVirtualKeySpendRepository } from "../repositories/clickhouse/clickhouse.gateway-virtual-key-spend.repository.ts";
import { PrismaGatewayAuditRepository } from "../repositories/prisma/prisma.gateway-audit.repository.ts";
import { PrismaGatewayChangeEventsRepository } from "../repositories/prisma/prisma.gateway-change-event.repository.ts";
import { PrismaGatewayKeyBudgetRepository } from "../repositories/prisma/prisma.gateway-key-budget.repository.ts";
import { PrismaGatewayOrganizationDirectoryRepository } from "../repositories/prisma/prisma.gateway-organization-directory.repository.ts";
import { PrismaGatewayProviderLabelRepository } from "../repositories/prisma/prisma.gateway-provider-label.repository.ts";
import { PrismaGatewayScopeResolutionRepository } from "../repositories/prisma/prisma.gateway-scope-resolution.repository.ts";
import { PrismaVirtualKeyDirectBudgetRepository } from "../repositories/prisma/prisma.gateway-virtual-key-direct-budget.repository.ts";
import { PrismaVirtualKeyAuthorizationRepository } from "../repositories/prisma/prisma.virtual-key-authorization.repository.ts";
import { PrismaGatewayVirtualKeyRepository } from "../repositories/prisma/prisma.virtual-key.repository.ts";
import { GatewayApplicableBudgetsService } from "../services/gateway-applicable-budgets.service.ts";
import {
  GatewayScopeResolutionService,
  type GatewayPlatformProviders,
} from "../services/gateway-scope-resolution.service.ts";
import { GatewaySpendEventsService } from "../services/gateway-spend-events.service.ts";
import { GatewayUsageService } from "../services/gateway-usage.service.ts";
import { GatewayVirtualKeyDtoService } from "../services/gateway-virtual-key-dto.service.ts";
import { VirtualKeyAuthorizationService } from "../services/virtual-key-authorization.service.ts";
import type {
  MembershipSet,
  VirtualKeyActor,
} from "../services/virtual-key-authorization.service.ts";
import { VirtualKeyCryptoService } from "../services/virtual-key-crypto.service.ts";
import { VirtualKeyDirectBudgetService } from "../services/virtual-key-direct-budget.service.ts";
import { VirtualKeyService } from "../services/virtual-key.service.ts";
import type { GatewayAppDependencies } from "./gateway.app.ts";
import type {
  GatewayClickHouseClient,
  GatewayClickHouseResolver,
  GatewayGovernanceSignals,
  GatewayPermissionScope,
  GatewayScopePermissions,
} from "./gateway.members.ts";
import { PrismaGatewayTransactionAdapter } from "./postgres.gateway-transaction.ts";
import { PrismaGatewayAdapter } from "./prisma.gateway.composition.ts";

const virtualKeyDtos = GatewayVirtualKeyDtoService.create();

class GatewayClickHouseSession implements GatewayClickHouseClient {
  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
    unscoped?: { reason: string };
  }): Promise<{ json<T = unknown>(): Promise<T[]> }> {
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
      settings: input.clickhouse_settings as Record<string, string | number> | undefined,
      ...(input.unscoped ? { unscoped: input.unscoped } : {}),
    });

    return { json: <T = unknown>() => Promise.resolve(rows as T[]) };
  }

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      settings: input.clickhouse_settings as Record<string, string | number> | undefined,
    });

    return undefined;
  }
}

/**
 * The two questions a virtual-key write is authorized by, answered from the
 * process's own AuthZ application rather than from role rows this package can
 * see: the gateway holds no membership or grant table of its own.
 */
class GatewayAuthzScopePermissions implements GatewayScopePermissions {
  static create(authz: AuthzApi): GatewayAuthzScopePermissions {
    return new GatewayAuthzScopePermissions(authz);
  }

  private constructor(private readonly authz: AuthzApi) {}

  sessionHolds(input: {
    userId: string;
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }): Promise<boolean> {
    const scope = authzScopeOf(input.scope);

    return this.authz.hasPermission({
      userId: input.userId,
      permission: input.permission,
      ...scope,
    });
  }

  apiKeyHolds(input: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    permission: AuthzPermission;
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

/** The other features the gateway control plane reaches, one by one. */
export type GatewayControlPlanePeers = Readonly<{
  /** The permission service every other surface on this process authorizes with. */
  authz: AuthzApi;
  /** The project directory the tenancy graph composed. */
  projects: ProjectApi;
  /** The evaluators a guardrail rule runs, as the budget-decision store reads them. */
  evaluators: EvaluatorApi;
  /** The monitors a guardrail attachment names. */
  monitors: MonitorApi;
  /** The deployment's own providers, which a license's managed key dispatches on. */
  platformProviders: GatewayPlatformProviders;
}>;

export type GatewayControlPlaneOptions = Readonly<{
  /** The one guarded connection every gateway row read below runs on. */
  prisma: ProcessMembers["prisma"];
  /**
   * The process's ONE routing ClickHouse client. The gateway ledger is a
   * projection in that instance, and a second connection would be a second
   * pool over the same server.
   */
  clickhouse: ClickHouseQueryClient;
  peers: GatewayControlPlanePeers;
  /** The HMAC key a virtual key's stored secret is hashed under. */
  virtualKeyPepper: string | undefined;
  /**
   * Where a virtual key's lifecycle is announced, where the deployment
   * composed a ledger for it.
   */
  governanceSignals?: GatewayGovernanceSignals | undefined;
}>;

export type GatewayControlPlane = GatewayAppDependencies &
  Readonly<{
    internalVirtualKeys: VirtualKeyService;
    internalChanges: PrismaGatewayChangeEventsRepository;
    internalScopeResolution: GatewayScopeResolutionService;
    /** The spend ledger the gateway_spend fold writes, over the same routing client. */
    spendLedger: ClickHouseGatewaySpendEventsRepository;
  }>;

/**
 * Composes the gateway control plane: the whole of what {@link GatewayApp}'s
 * core surface answers from.
 */
export function buildGatewayControlPlane(options: GatewayControlPlaneOptions): GatewayControlPlane {
  const { prisma, peers } = options;
  const { projects } = peers;
  const permissions = GatewayAuthzScopePermissions.create(peers.authz);
  const organizationDirectory = PrismaGatewayOrganizationDirectoryRepository.create(prisma);
  const virtualKeyAuthorization = VirtualKeyAuthorizationService.create({
    directory: PrismaVirtualKeyAuthorizationRepository.create({ database: prisma }),
  });
  // One resolution over the one member, per tenant. `Promise.resolve` because
  // there is nothing to open: the client already exists.
  const resolveClickHouse: GatewayClickHouseResolver = (tenantId) =>
    Promise.resolve(new GatewayClickHouseSession(options.clickhouse, tenantId));

  const scopeResolution = GatewayScopeResolutionService.create({
    repository: PrismaGatewayScopeResolutionRepository.create({ database: prisma }),
    platformProviders: peers.platformProviders,
  });
  const changes = PrismaGatewayChangeEventsRepository.create(prisma);
  const virtualKeys = VirtualKeyService.create({
    transactions: PrismaGatewayTransactionAdapter.create({ database: prisma }),
    keyBudgets: PrismaGatewayKeyBudgetRepository.create({ database: prisma }),
    scopeResolution,
    projects,
    repository: PrismaGatewayVirtualKeyRepository.create(prisma),
    changeEvents: changes,
    auditLog: PrismaGatewayAuditRepository.create(prisma),
    crypto: VirtualKeyCryptoService.create({ pepper: options.virtualKeyPepper }),
    ...(options.governanceSignals ? { governanceSignals: options.governanceSignals } : {}),
  });

  const budgetSpend = GatewayBudgetClickHouseRepository.create(resolveClickHouse);
  const virtualKeySpend = GatewayVirtualKeySpendRepository.create(resolveClickHouse);
  const spendLedger = ClickHouseGatewaySpendEventsRepository.create(resolveClickHouse);
  const spendEvents = GatewaySpendEventsService.create(spendLedger);

  const budgetDecisions = PrismaGatewayAdapter.create({
    database: prisma,
    projects,
    evaluators: peers.evaluators,
    monitors: peers.monitors,
    // The change feed the Go data plane long-polls and the audit trail every
    // cache-rule and guardrail command is written to. Both are Prisma
    // repositories this package owns; the process only named the connection
    // they run on.
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

  // No type arguments: the two budget row shapes the wire contract carries are
  // named by `@langwatch/gateway-contract` (`GatewayApplicableBudget`,
  // `GatewayVirtualKeyDirectBudget`), so the application declares them itself
  // instead of taking them as parameters a router could not propagate.
  return {
    virtualKeys,
    budgetDecisions,
    budgetSpend,
    virtualKeySpend,
    spendEvents,
    projects,
    usage,
    // `reads("clickhouse")` is a boot claim: a process that opened no
    // ClickHouse never reaches this function, so the spend source is present
    // whenever the control plane is.
    spendSourceAvailable: true,
    schemas: { virtualKeyBudgetInput: virtualKeyBudgetInputSchema },
    internalVirtualKeys: virtualKeys,
    internalChanges: changes,
    internalScopeResolution: scopeResolution,
    spendLedger,

    organizationIdForProject: async (projectId) => {
      const organizationId = await projects.findOrganizationId(projectId);
      if (!organizationId) throw new Error(`project ${projectId} missing team`);

      return organizationId;
    },
    // The refusal the deleted composition raised, unchanged: the anchor is
    // read from both doors and a second taxonomy here would change what a
    // tRPC caller already sees.
    assertOrganizationExists: (organizationId) =>
      organizationDirectory.assertExists(organizationId),
    resolveProviderLabels: (budgets) =>
      PrismaGatewayProviderLabelRepository.create(prisma).resolveProviderLabels([...budgets]),
    listGroupTargets: (organizationId) => organizationDirectory.findGroupTargets(organizationId),
    groupMemberCounts: (budgets) => organizationDirectory.groupMemberCounts(budgets),
    // The label per key a page of spend rows carries, read through this
    // feature's OWN persistence rather than by a key-table `findMany`.
    resolveVirtualKeyNames: (input) => virtualKeys.resolveNames(input),
    isOrganizationMember: (input) => organizationDirectory.isMember(input),
    // A scoped API key acts as its owning user; a legacy project key carries
    // none, so it acts as a stable machine principal for its project, which
    // keeps an audit row traceable back to the credential that wrote it.
    actorForCredential: ({ projectId, credential }) =>
      credential.kind === "apiKey"
        ? {
            actor: {
              kind: "apiKey",
              apiKeyId: credential.apiKeyId,
              userId: credential.userId,
              organizationId: credential.organizationId,
            } satisfies VirtualKeyActor,
            actorUserId: credential.userId ?? `svc_${projectId}`,
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
    getVisibleVirtualKeyForUser: async ({ organizationId, id, userId }) =>
      virtualKeyAuthorization.getVisibleVk(
        virtualKeys,
        await virtualKeyAuthorization.loadMembershipSet({ organizationId, userId }),
        { id, organizationId },
      ),
    visibleToProjectCredential: ({ project, virtualKeys: page }) => {
      const membership = membershipForProjectCredential(project);

      return page.filter((virtualKey) =>
        virtualKeyAuthorization.isVisibleToMembership(membership, virtualKey.scopes),
      );
    },
    getVisibleVirtualKeyForProjectCredential: ({ project, id, organizationId }) =>
      virtualKeyAuthorization.getVisibleVk(virtualKeys, membershipForProjectCredential(project), {
        id,
        organizationId,
      }),
    getExistingVirtualKey: ({ organizationId, id }) =>
      virtualKeyAuthorization.getExistingVk(virtualKeys, id, organizationId),

    assertCanManageAllScopes: ({ actor, scopes }) =>
      virtualKeyAuthorization.assertActorCanManageAllScopes(
        { permissions, actor: gatewayVirtualKeyActor(actor) },
        [...scopes],
      ),
    assertCanCreateScopes: ({ actor, scopes, callerProjectId }) =>
      virtualKeyAuthorization.assertActorCanCreateScopes(
        { permissions, actor: gatewayVirtualKeyActor(actor) },
        { scopes: [...scopes], callerProjectId },
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
    assertGuardrailAttachmentsAllowed: ({
      actor,
      organizationId,
      virtualKeyId,
      scopes,
      traceProjectId,
      attachments,
    }) =>
      virtualKeyAuthorization.assertGuardrailAttachmentsAllowed(
        { permissions, actor: gatewayVirtualKeyActor(actor) },
        {
          organizationId,
          vkId: virtualKeyId,
          inputScopes: scopes ? [...scopes] : undefined,
          traceProjectId,
        },
        attachments ? [...attachments] : undefined,
      ),

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
    listApplicableBudgets: ({ target }) =>
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
  };
}

/**
 * The caller as the virtual-key authorization vocabulary names them,
 * whichever door they arrived through.
 */
function gatewayVirtualKeyActor(actor: unknown): VirtualKeyActor {
  if (typeof actor !== "object" || actor === null) {
    return { kind: "session", session: null };
  }
  if (!("kind" in actor)) {
    return { kind: "session", session: extractSessionActor(actor) };
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
 * The one member the authorization vocabulary reads off a browser session: the
 * signed-in person's id.
 */
function extractSessionActor(value: object): { user: { id: string } } | null {
  if (!("user" in value)) return null;
  const user = value.user;
  if (typeof user !== "object" || user === null) return null;
  if (!("id" in user) || typeof user.id !== "string") return null;

  return { user: { id: user.id } };
}

/**
 * A project credential stands in for someone working in its project, so it
 * sees organization-scoped keys, its own team's keys and its own project's —
 * and not a sibling team's. The same rule the tRPC list applies to a member.
 */
function membershipForProjectCredential(project: ProjectIdentity): MembershipSet {
  return {
    isOrgMember: true,
    isOrgAdmin: false,
    teamIds: new Set([project.teamId]),
    projectIds: new Set([project.id]),
  };
}

function authzScopeOf(scope: GatewayPermissionScope) {
  if (scope.type === "org") return { organizationId: scope.id };
  return scope.type === "team" ? { teamId: scope.id } : { projectId: scope.id };
}
