/**
 * The AI Gateway's application, composed once for this process.
 *
 * Moved whole out of `platform/app/src/server/app-layer/presets.ts`, where it
 * was `composeGatewayApp` over an `AppDependencies["gateway"]` bag the App
 * built. The bag is gone: every store it held is opened HERE, from this
 * process's own Prisma connection and its own ClickHouse, so the seven gateway
 * doors — six tRPC namespaces and the two REST families — are given ONE
 * application rather than each assembling its own view of what a virtual key
 * is worth.
 *
 * That was the whole reason the platform composition existed. It replaced two
 * bags that described the same process to the same feature and disagreed about
 * it — `budgets` meant the decision service on one side and the ClickHouse
 * spend source on the other. One composition is what stops the public REST door
 * and the browser's tRPC door enforcing different rules, and it is why this is
 * a composition rather than a per-door port bag.
 *
 * ## What arrives, and what refuses
 *
 * ClickHouse is optional and its absence is a supported shape rather than a
 * degradation: the budget ledger, the per-key spend rollup and the spend-event
 * feed all live there, and a deployment with no ClickHouse answers
 * `spend_source_unavailable` rather than a $0.00 that cannot be told apart from
 * a key that genuinely spent nothing. `spendSourceAvailable` is what carries
 * that distinction into the application.
 *
 * The idempotency ledger is a NAMED ABSENCE — {@link ApiGatewayIdempotencyPort}
 * — because the receipt store it runs on is `server/api/idempotency.ts`, still
 * in the retired application and read by four other families that are another
 * lane's to move. Absent, the three REST creates that accept an
 * `Idempotency-Key` refuse by name. A runner that executed unguarded would mint
 * a second virtual key on a retry the caller sent precisely so it would not.
 */
import type { ApiKeyPermissionScope, AuthzService } from "@langwatch/authz-contract";
import {
  GatewayApp,
  GatewayBudgetLedgerAdapter,
  GatewayScopePermissionsPort,
  GatewaySpendEventsClickHouseAdapter,
  GatewaySpendEventsService,
  GatewayUsageService,
  GatewayVirtualKeySpendAdapter,
  PrismaGatewayAdapter,
  VirtualKeyCryptoAdapter,
  VirtualKeyService,
  assertActorCanManageAllScopes,
  assertActorCanOperateOnAnyScope,
  assertGuardrailAttachmentsAllowed,
  assertScopesBelongToOrg,
  assertTraceProjectBelongsToOrg,
  isVisibleToMembership,
  loadDirectBudgetsForKeys,
  loadMembershipSet,
  loadTraceDestinationFacts,
  requireExistingVk,
  requireVisibleVk,
  resolveApplicableBudgetsForDraftKey,
  resolveVkProjectId,
  toVirtualKeyCamelDto,
  toVirtualKeySnakeDto,
  virtualKeyBudgetInputSchema,
  type GatewayBudgetSpendPort,
  type GatewayClickHouseClient,
  type GatewayClickHouseResolver,
  type GatewayGovernanceSignalsPort,
  type GatewayPermissionScope,
  type GatewayVirtualKeySpendPort,
  type MembershipSet,
  type VirtualKeyActor,
} from "@langwatch/gateway-server";
import { createGatewayAuditPort } from "@langwatch/gateway-server/composition/gateway-audit";
import { createGatewayChangeEventsPort } from "@langwatch/gateway-server/composition/gateway-change-events";
import { createGatewayVirtualKeysPort } from "@langwatch/gateway-server/composition/gateway-virtual-keys";
import { resolveProviderLabels } from "@langwatch/gateway-server/composition/gateway-provider-labels";
import type { IdempotentRunner } from "@langwatch/api/rest";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { HandledError } from "@langwatch/handled-error";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectIdentity, ProjectService } from "@langwatch/project-contract";
import { TRPCError } from "@trpc/server";

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
 * The receipt ledger a keyed REST create dispatches through.
 *
 * A port rather than a composition because the ledger it runs on — the
 * `IdempotencyReceipt` claim, its heartbeat and its takeover window — is
 * `platform/app/src/server/api/idempotency.ts`, a module four other REST
 * families still read and another lane's to move. Copying its 752 lines here
 * would give the deployment two receipt stores with two takeover clocks.
 */
export abstract class ApiGatewayIdempotencyPort {
  abstract readonly run: IdempotentRunner;
}

/**
 * The ClickHouse this process's gateway ledger runs on, as one resolution.
 *
 * `null` where the process opened none. The gateway's spend is a projection in
 * that instance, so a deployment holding no trace storage holds no spend to
 * price a budget against.
 */
export type ApiGatewayClickHousePort = Readonly<{
  resolve(tenantId: string): Promise<GatewayClickHouseClient>;
}>;

/**
 * The two questions a virtual-key write is authorized by, answered from this
 * process's own AuthZ service.
 *
 * They stay apart because the two credentials answer them differently:
 * collapsing them would let a scoped API key inherit the whole of its owner's
 * cascade instead of its own ceiling. See {@link GatewayScopePermissionsPort}.
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
   * Where a virtual key's lifecycle is announced, where the deployment composed
   * a ledger for it.
   *
   * Optional and unset by default, which is the behaviour the platform
   * application had rather than a new gap: `VirtualKeyService` constructed a
   * disabled signal service in its own constructor, so all five emissions
   * reached a null object in every process.
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
}>;

/**
 * Composes the gateway application from this process's own graph.
 *
 * Everything passed in is either a capability built over persistence the
 * feature package cannot reach, or a decision made against role bindings and
 * memberships it cannot see.
 */
export function composeApiGateway(options: ApiGatewayCompositionOptions): ApiGatewayComposition {
  const { prisma, authz, projects, clickhouse } = options;
  const permissions = ApiGatewayScopePermissions.create(authz);
  const resolveClickHouse: GatewayClickHouseResolver | undefined = clickhouse
    ? (tenantId) => clickhouse.resolve(tenantId)
    : undefined;

  const virtualKeys = VirtualKeyService.create(
    prisma,
    projects,
    VirtualKeyCryptoAdapter.create({ pepper: options.virtualKeyPepper }),
    options.governanceSignals,
  );

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
    changes: createGatewayChangeEventsPort(prisma),
    audit: createGatewayAuditPort(prisma),
    budgetSpend,
  }).build();

  const usage = GatewayUsageService.create({
    projects,
    // The usage rollup needs a label per key the ledger reported spend
    // against, which is a repository read; `virtualKeys` above is the
    // operations service the gateway application itself is built on.
    virtualKeys: createGatewayVirtualKeysPort(prisma),
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
    resolveProviderLabels: (budgets) => resolveProviderLabels({ prisma, budgets: [...budgets] }),
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
    // VirtualKey is organization-scoped, so the lookup is fenced by the owning
    // organization and never by the raw ids off the spend rows alone.
    resolveVirtualKeyNames: ({ organizationId, virtualKeyIds }) =>
      prisma.virtualKey.findMany({
        where: { id: { in: [...virtualKeyIds] }, organizationId },
        select: { id: true, name: true },
      }),
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
      const membership = await loadMembershipSet(prisma, organizationId, userId);
      return (await virtualKeys.getAll(organizationId)).filter((virtualKey) =>
        isVisibleToMembership(membership, virtualKey.scopes),
      );
    },
    isVirtualKeyVisible: async ({ organizationId, userId, virtualKey }) =>
      isVisibleToMembership(
        await loadMembershipSet(prisma, organizationId, userId),
        virtualKey.scopes,
      ),
    requireVisibleVirtualKeyForUser: async ({ organizationId, id, userId }) =>
      requireVisibleVk(virtualKeys, await loadMembershipSet(prisma, organizationId, userId), {
        id,
        organizationId,
      }),
    visibleToProjectCredential: ({ project, virtualKeys: page }) => {
      const membership = membershipForProjectCredential(project);
      return page.filter((virtualKey) => isVisibleToMembership(membership, virtualKey.scopes));
    },
    requireVisibleVirtualKeyForProjectCredential: ({ project, id, organizationId }) =>
      requireVisibleVk(virtualKeys, membershipForProjectCredential(project), {
        id,
        organizationId,
      }),
    requireExistingVirtualKey: ({ organizationId, id }) =>
      requireExistingVk(virtualKeys, id, organizationId),

    assertCanManageAllScopes: ({ actor, scopes }) =>
      assertActorCanManageAllScopes({ prisma, permissions, actor: gatewayVirtualKeyActor(actor) }, [
        ...scopes,
      ]),
    assertCanOperateOnAnyScope: ({ actor, scopes, permission }) =>
      assertActorCanOperateOnAnyScope(
        { prisma, permissions, actor: gatewayVirtualKeyActor(actor) },
        [...scopes],
        permission,
      ),
    assertScopesBelongToOrganization: ({ organizationId, scopes }) =>
      assertScopesBelongToOrg(prisma, organizationId, [...scopes]),
    assertTraceProjectBelongsToOrganization: ({ organizationId, traceProjectId }) =>
      assertTraceProjectBelongsToOrg(prisma, organizationId, traceProjectId),
    assertGuardrailAttachmentsAllowed: ({ actor, projectId, attachments }) =>
      assertGuardrailAttachmentsAllowed(
        { prisma, permissions, actor: gatewayVirtualKeyActor(actor) },
        projectId,
        attachments ? [...attachments] : undefined,
      ),
    resolveVirtualKeyProjectId: ({ organizationId, virtualKeyId, scopes, traceProjectId }) =>
      resolveVkProjectId(prisma, organizationId, {
        vkId: virtualKeyId,
        inputScopes: scopes ? [...scopes] : undefined,
        traceProjectId,
      }),

    // One read of the destinations for a whole page, in both casings: a
    // listing must not cost a query per key to say where its traffic goes.
    toVirtualKeyCamelDtos: async ({ virtualKeys: page }) => {
      const facts = await loadTraceDestinationFacts({ projects, virtualKeys: [...page] });
      return page.map((virtualKey) => toVirtualKeyCamelDto({ virtualKey, facts }));
    },
    toVirtualKeySnakeDtos: async ({ virtualKeys: page }) => {
      const facts = await loadTraceDestinationFacts({ projects, virtualKeys: [...page] });
      return page.map((virtualKey) => toVirtualKeySnakeDto({ virtualKey, facts }));
    },
    resolveApplicableBudgets: ({ target }) =>
      resolveApplicableBudgetsForDraftKey(
        prisma,
        projects,
        { ...target, scopes: [...target.scopes] },
        budgetDecisions,
        budgetSpend,
      ),
    loadDirectBudgetsForKeys: ({ organizationId, virtualKeyIds, now }) =>
      loadDirectBudgetsForKeys({
        prisma,
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

  return { app, virtualKeys, budgetSpend, virtualKeySpend, spendEvents };
}

/**
 * The caller as the virtual-key authorization vocabulary names them, whichever
 * door they arrived through.
 *
 * `GatewayActor` is `unknown` on purpose: the feature hands a caller straight
 * into these checks and never reads one, because what an identity IS belongs
 * to this process's authentication. So exactly two shapes reach here — the
 * browser session a tRPC context carries, and the credential actor
 * `actorForCredential` builds above for a REST request — and one implementation
 * has to accept both.
 *
 * They are told apart by the member only one of them has: every
 * {@link VirtualKeyActor} carries `kind`, and a session has no such field. The
 * credential branches are rebuilt member by member rather than waved through,
 * so nothing reaches the permission port that was not read off the value first.
 *
 * Every unrecognised shape answers `{ kind: "session", session: null }`, which
 * `assertActorCanManageAllScopes` and its siblings refuse outright. This cannot
 * widen an authorization: what it fails to recognise, it denies.
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
 * The one member the authorization vocabulary reads off a browser session: the
 * signed-in person's id.
 *
 * Narrower than the platform application's check, which asserted a whole
 * NextAuth `Session` including its `expires` string. That type belongs to a
 * sign-in library this process does not use, and the extra member was never
 * read — `VirtualKeySessionActor` is `{ user: { id: string } } | null`. A value
 * that fails becomes a null session, and every gateway check refuses one.
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
