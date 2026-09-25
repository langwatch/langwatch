// The application's own refusal for "the store these figures live in is not
// reachable": one taxonomy for an unreachable ClickHouse, shared with every
// other read of it.
import { ClickHouseUnavailableError } from "@langwatch/analytics-contract";
import type { RestIdentity } from "@langwatch/api/rest";
import { type AuthzPermission, AuthzApi } from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import type {
  EventingCommandSender,
  Projection,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  type GatewayBudgetOverviewForUser,
  type GatewayRequestCredential,
  type GatewayVirtualKeyScope,
  type VirtualKeyWithScopes,
  GatewayApi as GatewayApiToken,
  parseVirtualKeyConfig,
  type ArchiveGatewayBudgetInput,
  type ArchiveGatewayCacheRuleInput,
  type ArchiveGatewayGuardrailInput,
  type CreateGatewayBudgetInput,
  type CreateGatewayCacheRuleInput,
  type CreateGatewayGuardrailInput,
  type GatewayApplicableBudget,
  type GatewayAgentCacheWriteInput,
  type GatewayBudgetChangeInput,
  type GatewayBudgetCheckInput,
  type GatewayBudgetCheckResult,
  type GatewayBudgetDebitRow,
  type GatewayBudgetResolutionTarget,
  type GatewayElevenLabsWebhookAnswer,
  type GatewayVirtualKeyDirectBudget,
  type GuardrailAttachment,
  type VirtualKeyConfig,
  type ResetGatewayBudgetInput,
  type UpdateGatewayBudgetInput,
  type UpdateGatewayCacheRuleInput,
  type UpdateGatewayGuardrailInput,
  type GatewayApi,
  type GatewaySpendEventEnvelope,
  gatewaySpendEventEnvelopeSchema,
  type GatewayUsageCount,
  gatewayConfig,
  type GatewayDeploymentAddresses,
  type GatewayConnectUpstream,
  type GatewayLicenseTokenResolution,
  type GatewayServerConfig,
  type GatewayResolvedBudget,
  type VirtualKeyBudgetInput,
  type GatewayMintedVirtualKey,
  type GatewayVirtualKeyUsageSummary,
  type GatewayUsageSummary,
  type GatewayGuardrailResource,
  type GatewayBudgetResource,
  type GatewayBudgetDetail,
  type GatewayBudgetScopeTarget,
  type GatewayCacheRuleResource,
  type GatewayBudgetScopeReachResult,
  type GatewayBudgetHealth,
  type GatewayBudgetListWithHealth,
  type GatewayBudgetPageWithHealth,
  type GatewayPricedSpend,
  type GatewayPricedSpendResult,
  type GatewaySpendDay,
  type GatewayInternalSpendCommandRecord,
  type GatewayInternalSpendSubmission,
  type GatewayVirtualKeyRecord,
  GatewayBudgetNotFoundError,
  type GatewayPrincipalDailySpend,
  type GatewayPrincipalModelSpend,
  type GatewayPrincipalSpendSummary,
  type GatewayPrincipalSpendWindow,
} from "@langwatch/gateway-contract";
import type { EventingParticipation, FeatureSetup } from "@langwatch/kernel";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { type ProcessMembers } from "@langwatch/process-stores/members";
import { type ProjectIdentity, ProjectApi } from "@langwatch/project-contract";
import { SecretApi } from "@langwatch/secret-contract";
import { gatewayInternalSecret, Secret, virtualKeyPepper } from "@langwatch/secrets";
import { toDate, type Instant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
// The billing envelope and the subscription grammar are the webhook
// platform's, and a reconciliation pull has to answer the same bytes a push
// delivers, so both ARRIVE from that module rather than being restated here.
import {
  eventMatches,
  webhookEnvelopeFromSpendRow,
  WebhookApi,
  type WebhookSpendEventRow,
} from "@langwatch/webhook-contract";
import type { z } from "zod";

import { GatewaySpendProducerAdapter } from "../eventing/gateway-spend-producer.ts";
import { settlementGraceMs } from "../eventing/gateway-spend-settlement.intent.ts";
import { EventingGatewaySpendAdapter } from "../eventing/gateway-spend.adapter.ts";
import type { GatewaySpendProcessingEvent } from "../eventing/gateway-spend.intent.ts";
import type { GatewayBudgetOverviewRepository } from "../repositories/gateway-budget-overview.repository.ts";
import type { GatewayPrincipalSpendRepository } from "../repositories/gateway-principal-spend.repository.ts";
import type { GatewaySpendEventsRepository } from "../repositories/gateway-spend-events.repository.ts";
import type { GatewayLicensedKey } from "../repositories/gateway-virtual-key.repository.ts";
import { PrismaGatewayConnectUpstreamRepository } from "../repositories/prisma/prisma.gateway-connect-upstream.repository.ts";
import { PrismaGatewayGuardrailRepository } from "../repositories/prisma/prisma.gateway-guardrail.repository.ts";
import { PrismaGatewayInternalStoreRepository } from "../repositories/prisma/prisma.gateway-internal-store.repository.ts";
import { PrismaGatewaySpendScopeRepository } from "../repositories/prisma/prisma.gateway-spend-scope.repository.ts";
import type { GatewayAgentCacheEntryStore } from "../repositories/redis/redis.gateway-agent-cache.repository.ts";
import { ConnectManagedKeyService } from "../services/connect-managed-key.service.ts";
import { FixedGatewaySettlementPolicyService } from "../services/fixed-gateway-settlement-policy.service.ts";
import {
  GatewayAgentCacheService,
  type GatewayAgentCacheEncryption,
} from "../services/gateway-agent-cache.service.ts";
import { GatewayBudgetLedgerService } from "../services/gateway-budget-ledger.service.ts";
import { BudgetOverviewService } from "../services/gateway-budget-overview.service.ts";
import { GatewayConfigMaterialiserService } from "../services/gateway-config-materialisation.service.ts";
import { GatewayConnectUpstreamService } from "../services/gateway-connect-upstream.service.ts";
import {
  GatewayElevenLabsWebhookService,
  type ElevenLabsWebhookCollaborators,
} from "../services/gateway-elevenlabs-webhook.service.ts";
/**
 * The gateway feature's application: the one typed thing every door is given. A caller arrives
 * as {@link GatewayActor}, an argument rather than read from session/request, so one check
 * serves both a browser session and an API key.
 */
import type { GatewayEndUserCap } from "../services/gateway-end-user-caps.service.ts";
import {
  GatewayGuardrailEvaluationService,
  type EvaluatorRunner,
} from "../services/gateway-guardrail-evaluation.service.ts";
import { GatewayInternalIdentityService } from "../services/gateway-internal-identity.service.ts";
import { GatewayInternalProtocolService } from "../services/gateway-internal-protocol.service.ts";
import type {
  GatewayCodexRefresh,
  GatewayInternalSpendPipeline,
  GatewaySpendCommandSender,
} from "../services/gateway-internal-protocol.service.ts";
import { GatewayJwtService } from "../services/gateway-jwt.service.ts";
import type { GatewayRealtimeSessionCollaborators } from "../services/gateway-realtime-session.service.ts";
import type { GatewaySpendEventsService } from "../services/gateway-spend-events.service.ts";
import type { GatewayUsageService, UsageWindow } from "../services/gateway-usage.service.ts";
import type {
  VirtualKeyCamelDto,
  VirtualKeySnakeDto,
} from "../services/gateway-virtual-key-dto.service.ts";
import type { GatewayService } from "../services/gateway.service.ts";
import { ModelCatalogGatewaySpendRatingService } from "../services/model-catalog-gateway-spend-rating.service.ts";
import { buildGatewayControlPlane } from "./gateway-composition.build.ts";
import { GatewayEndUserCapsAdapter } from "./gateway-end-user-caps.composition.ts";
import {
  type GatewayBudgetSpend,
  type GatewayChangeEvents,
  type GatewayConfigAssembly,
  type GatewayModelProviderCredentials,
  type GatewayVirtualKeySpend,
} from "./gateway.members.ts";

/**
 * Identity a write authorizes as, opaque on purpose: a caller may be a browser session, scoped
 * API key or legacy project key. What it IS belongs to the process's authentication, not this
 * feature — the doors hand one straight to the checks below and never read it.
 */
export type GatewayActor = unknown;

/**
 * A key's own budget, as the write service takes it. The canonical parser is
 * schemas.virtualKeyBudgetInput, so its decimal regex and positive-amount refinement are never
 * restated here.
 */
export type GatewayVirtualKeyBudgetInput = Readonly<{
  limitUsd: string;
  window: "DAY" | "WEEK" | "MONTH";
  onBreach?: "BLOCK" | "WARN";
  name?: string;
}>;

/**
 * Virtual-key read/write capability, as every door calls it — one description where there were
 * three, which differed only in which optional fields each remembered to mention.
 */
export type GatewayVirtualKeyOperations = Readonly<{
  getAll(organizationId: string): Promise<VirtualKeyWithScopes[]>;
  findById(id: string, organizationId: string): Promise<VirtualKeyWithScopes | null>;
  findLiveWithPrincipal(input: {
    organizationId?: string;
    principalUserId?: string;
  }): Promise<VirtualKeyWithScopes[]>;
  getPage(input: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Instant; id: string } | null;
    externalId?: string;
  }): Promise<VirtualKeyWithScopes[]>;
  create(input: {
    organizationId: string;
    name: string;
    description?: string | null;
    principalUserId?: string | null;
    scopes: GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
    routingPolicyId?: string | null;
    routingMode?: "FALLBACK_ALL" | "NONE" | "POLICY";
    expiresAt?: Instant | null;
    budget?: GatewayVirtualKeyBudgetInput | null;
    config?: Partial<VirtualKeyConfig>;
    externalId?: string | null;
    metadata?: Record<string, string>;
    actorUserId: string;
    /** Anything other than USER marks the key product-managed. */
    purpose?: "USER" | "LANGY" | "CONNECT";
  }): Promise<{ virtualKey: VirtualKeyWithScopes; secret: string }>;
  update(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    name?: string;
    description?: string | null;
    scopes?: GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
    routingPolicyId?: string | null;
    routingMode?: "FALLBACK_ALL" | "NONE" | "POLICY";
    expiresAt?: Instant | null;
    budget?: GatewayVirtualKeyBudgetInput | null;
    config?: Partial<VirtualKeyConfig>;
    externalId?: string | null;
    metadata?: Record<string, string>;
  }): Promise<VirtualKeyWithScopes>;
  rotate(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<{ virtualKey: VirtualKeyWithScopes; secret: string }>;
  revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<VirtualKeyWithScopes>;
  /** Ends a product-managed key for the feature that owns it. Safe to repeat. */
  revokeManagedInternal(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<void>;
  /** Makes every gateway resolve a product-managed key again, unchanged. */
  invalidateManagedInternal(input: { id: string; organizationId: string }): Promise<void>;
  /** Replaces the platform services a CONNECT key may serve. Safe to repeat. */
  setConnectServicesInternal(input: {
    id: string;
    organizationId: string;
    services: readonly string[];
  }): Promise<void>;
  /** Records the license a CONNECT key serves. Safe to repeat. */
  setLicenseFactsInternal(input: {
    id: string;
    organizationId: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant | null;
  }): Promise<void>;
  /** A CONNECT key by the registry hash of its license token. */
  findByLicenseTokenHashInternal(tokenHash: string): Promise<GatewayLicensedKey | null>;
  disable(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    reason: string | null;
  }): Promise<VirtualKeyWithScopes>;
  enable(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<VirtualKeyWithScopes>;
}>;

type GatewayVirtualKeyCreateInput = GatewayVirtualKeyOperations extends {
  create(input: infer Input): unknown;
}
  ? Input
  : never;
type GatewayVirtualKeyUpdateInput = GatewayVirtualKeyOperations extends {
  update(input: infer Input): unknown;
}
  ? Input
  : never;
type GatewayVirtualKeyRotateInput = GatewayVirtualKeyOperations extends {
  rotate(input: infer Input): unknown;
}
  ? Input
  : never;
type GatewayVirtualKeyRevokeInput = GatewayVirtualKeyOperations extends {
  revoke(input: infer Input): unknown;
}
  ? Input
  : never;
type GatewayVirtualKeyDisableInput = GatewayVirtualKeyOperations extends {
  disable(input: infer Input): unknown;
}
  ? Input
  : never;
type GatewayVirtualKeyEnableInput = GatewayVirtualKeyOperations extends {
  enable(input: infer Input): unknown;
}
  ? Input
  : never;
type GatewayBudgetPageInput = GatewayService extends {
  listPageWithHealth(input: infer Input): unknown;
}
  ? Input
  : never;
type GatewayBudgetScopeReachInput = GatewayService extends {
  scopeReach(input: infer Input): unknown;
}
  ? Input
  : never;
type GatewayCacheRulePageInput = GatewayService extends {
  cacheRuleListPage(input: infer Input): unknown;
}
  ? Input
  : never;

/** A draft or existing key, as the applicable-budget resolver takes it. */
export type GatewayApplicableBudgetTarget = Readonly<{
  organizationId: string;
  virtualKeyId: string | null;
  scopes: readonly GatewayVirtualKeyScope[];
  traceProjectId: string | null;
  principalUserId: string | null;
}>;

/**
 * What the process composes this application from: capabilities built over persistence this
 * package cannot reach, or decisions against role bindings/memberships it cannot see. Everything
 * else lives in this package directly.
 */
export type GatewayRestInfrastructure = Readonly<{
  /** Absent only where this process has no encryption and mounts no agent-cache family. */
  agentCache?:
    | Readonly<{
        store: GatewayAgentCacheEntryStore;
        encryption: GatewayAgentCacheEncryption;
      }>
    | undefined;
  /** Absent where this process mounts no ElevenLabs callback family. */
  elevenLabsWebhook?: ElevenLabsWebhookCollaborators | undefined;
}>;

export interface GatewayAppDependencies extends GatewayRestInfrastructure {
  // ── The feature's own services and stores ────────────────────────────────

  /** The virtual-key read and write capability. */
  virtualKeys: GatewayVirtualKeyOperations;
  /**
   * The one canonical Gateway service: budget decisions plus the cache-rule and guardrail
   * catalogues it owns. The process used to build the latter two a second time over its own
   * copies of the same tables, so a rule written through one was invisible to the other.
   */
  budgetDecisions: GatewayService;
  /**
   * The ClickHouse budget-spend source. Absent on a deployment without it,
   * which is why every read of it degrades explicitly rather than reporting a
   * confident zero.
   */
  budgetSpend: GatewayBudgetSpend | undefined;
  /** The change feed the Go data plane long-polls for budget and key revisions. */
  changeEvents: GatewayChangeEvents;
  /** The ClickHouse per-key spend source. Absent likewise. */
  virtualKeySpend: GatewayVirtualKeySpend | undefined;
  /** The ClickHouse principal-scope ledger reader. Absent likewise. */
  principalSpend: GatewayPrincipalSpendRepository | undefined;
  /** The spend-event ledger reader. Absent likewise. */
  spendEvents: GatewaySpendEventsService | undefined;
  /** Project reads: organization resolution and trace-destination facts. */
  projects: ProjectApi;
  /** The usage reader, already bound to the spend sources above. */
  usage: GatewayUsageService;
  /**
   * Whether this deployment has the ClickHouse spend source key spend is read
   * from. False answers `spend_source_unavailable` rather than a $0.00 that
   * cannot be told apart from a key that genuinely spent nothing.
   */
  spendSourceAvailable: boolean;
  /**
   * The canonical budget parser, taken rather than restated: its decimal regex
   * and positive-amount refinement are the write path's contract and must not
   * be able to drift from a second copy in a transport.
   */
  schemas: Readonly<{ virtualKeyBudgetInput: z.ZodType<GatewayVirtualKeyBudgetInput> }>;

  // ── Tenancy anchors and directory reads ──────────────────────────────────

  /**
   * The organization behind the project a credential authenticated as. Every
   * gateway resource is organization-owned, so it is the tenancy key for the
   * whole public surface.
   */
  organizationIdForProject(projectId: string): Promise<string>;
  /**
   * Refuses an organization id that names no organization. A tenancy anchor,
   * not an authorization check — the transports' policies decide access.
   */
  assertOrganizationExists(organizationId: string): Promise<void>;
  /** Provider row id to its display label, for a whole page in one read. */
  resolveProviderLabels(
    budgets: readonly { providerKey: string | null }[],
  ): Promise<Map<string, string>>;
  /** The groups a per-member budget can target, with their sizes. */
  listGroupTargets(
    organizationId: string,
  ): Promise<readonly { id: string; name: string; memberCount: number }[]>;
  /**
   * How many members a per-member GROUP allowance currently covers, batched
   * over however many GROUP rows a response carries.
   */
  groupMemberCounts(
    budgets: readonly { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, number>>;
  /**
   * Display names for the keys a page of spend rows names. VirtualKey is
   * organization-scoped, so the lookup is fenced by the owning organization
   * and never by the raw ids off the rows alone.
   */
  resolveVirtualKeyNames(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
  }): Promise<readonly { id: string; name: string }[]>;
  /** Whether a user belongs to this organization. */
  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean>;
  /**
   * Identity a REST credential authorizes as, plus the audit-row id: a scoped API key acts as
   * its owning user; a legacy project key carries none and acts as a stable synthetic machine
   * principal for its project, keeping audit entries traceable back to the credential.
   */
  actorForCredential(input: { projectId: string; credential: GatewayRequestCredential }): {
    actor: GatewayActor;
    actorUserId: string;
  };

  // ── Visibility ───────────────────────────────────────────────────────────

  /**
   * Org keys narrowed to what this USER can see. Visibility is membership-based, not
   * permission-based: a caller sees a key when one of its scopes intersects their membership
   * set, so a non-member gets an empty summary rather than a refusal.
   */
  listVisibleVirtualKeys(input: {
    organizationId: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes[]>;
  /** Whether one already-loaded key is visible to this user. */
  isVirtualKeyVisible(input: {
    organizationId: string;
    userId: string;
    virtualKey: VirtualKeyWithScopes;
  }): Promise<boolean>;
  /**
   * One key for a by-id READ under the list's visibility rule: a key outside the caller's
   * membership set is indistinguishable from nonexistent. Mutations don't use this — their
   * contract is permission-based, so an unauthorized caller gets FORBIDDEN instead.
   */
  getVisibleVirtualKeyForUser(input: {
    organizationId: string;
    id: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes>;
  /**
   * Keys a PROJECT CREDENTIAL may see on a page: org-scoped keys, its own team's, its own
   * project's — never a sibling team's. Applied to the page, not the query, so a page can be
   * shorter than `limit` without the walk being done.
   */
  visibleToProjectCredential(input: {
    project: ProjectIdentity;
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): VirtualKeyWithScopes[];
  /** One key under that same credential visibility rule, or the not-found refusal. */
  getVisibleVirtualKeyForProjectCredential(input: {
    project: ProjectIdentity;
    id: string;
    organizationId: string;
  }): Promise<VirtualKeyWithScopes>;
  /** One key anchored to this organization, without any visibility rule. */
  getExistingVirtualKey(input: {
    organizationId: string;
    id: string;
  }): Promise<VirtualKeyWithScopes>;

  // ── The checks ───────────────────────────────────────────────────────────

  /** `virtualKeys:manage` on EVERY named scope, fail-closed. */
  assertCanManageAllScopes(input: {
    actor: GatewayActor;
    scopes: readonly GatewayVirtualKeyScope[];
  }): Promise<void>;
  /** A project credential's own project needs `virtualKeys:create`; anything wider, manage. */
  assertCanCreateScopes(input: {
    actor: GatewayActor;
    scopes: readonly GatewayVirtualKeyScope[];
    callerProjectId: string;
  }): Promise<void>;
  /** One named permission on AT LEAST ONE of the key's existing scopes. */
  assertCanOperateOnAnyScope(input: {
    actor: GatewayActor;
    scopes: readonly GatewayVirtualKeyScope[];
    permission: AuthzPermission;
  }): Promise<void>;
  /** Anchors every scope in the set to this organization. */
  assertScopesBelongToOrganization(input: {
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
  }): Promise<void>;
  /** Anchors the trace destination to this organization. */
  assertTraceProjectBelongsToOrganization(input: {
    organizationId: string;
    traceProjectId: string | null | undefined;
  }): Promise<void>;
  /** Refuses a guardrail attachment the caller may not make in the key's guardrail project. */
  assertGuardrailAttachmentsAllowed(input: {
    actor: GatewayActor;
    organizationId: string;
    virtualKeyId: string | null;
    scopes: readonly GatewayVirtualKeyScope[] | undefined;
    traceProjectId: string | null;
    attachments: readonly GuardrailAttachment[] | undefined;
  }): Promise<void>;

  // ── Projections and spend ────────────────────────────────────────────────

  /**
   * The camelCase projection the app surfaces publish, for a page of keys in
   * ONE read of the trace destinations however long the page: a listing must
   * not cost a query per key to say where each one's traffic goes.
   */
  toVirtualKeyCamelDtos(input: {
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): Promise<VirtualKeyCamelDto[]>;
  /** The published snake_case projection, batched the same way. */
  toVirtualKeySnakeDtos(input: {
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): Promise<VirtualKeySnakeDto[]>;
  /** Every budget that would constrain a draft or existing key. */
  listApplicableBudgets(input: {
    target: GatewayApplicableBudgetTarget;
  }): Promise<GatewayApplicableBudget[]>;
  /** The budget each named key carries of its own, with this period's spend. */
  loadDirectBudgetsForKeys(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    now: Instant;
  }): Promise<Map<string, GatewayVirtualKeyDirectBudget>>;
  /**
   * Spend and request count per key over a window, from the cost path — the
   * same source the dashboard's key list and the Usage tab read, so the number
   * in a table, the API and the Usage page agree by construction.
   */
  spendByVirtualKey(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    window: { fromDate: Instant; toDate: Instant };
  }): Promise<Map<string, { spentUsd: string; requests: number }>>;
}

export type GatewayInfrastructure = GatewayAppDependencies | GatewayRestInfrastructure;

/** A grouped spend command record, as the queue takes it; anything else is a composition bug. */
function spendCommandRecord(command: string, payload: unknown): Record<string, unknown> {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return Object.fromEntries(Object.entries(payload));
  }
  throw new TypeError(`gateway_spend ${command} was handed a payload that is not a record.`);
}

/** The ledger gateway_spend folds into and the senders registration hands back. */
type GatewaySpendPipelineParts = Readonly<{
  ledger: GatewaySpendEventsRepository;
  commands: Record<string, GatewaySpendCommandSender | undefined>;
  webhooks: Pick<WebhookApi, "requestSpendDelivery">;
}>;

type GatewaySpendDefinition = StaticPipelineDefinition<
  GatewaySpendProcessingEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/**
 * What the billing reconciliation family reads that is neither the gateway's
 * own ledger nor a peer's application: the one guarded Postgres connection its
 * two resolutions run on, and how long after a request an outcome may still arrive.
 */
export type GatewaySpendCollaborators = Readonly<{
  prisma: ProcessMembers["prisma"];
  webhooks: WebhookApi;
  settlementGraceMs: number;
}>;

/**
 * The two peers the per-member budget overview reads: organization
 * membership plus personal-workspace resolution, and the governance flag.
 */
export type GatewayBudgetOverviewDeps = Readonly<{
  organizations: OrganizationApi;
  featureFlags: FeatureFlagApi;
  traces: Pick<TraceApi, "findModelSpend">;
}>;

/** Unread by `overviewForUser`; only the budget's own `findBudgetOverview` uses this port. */
const unusedBudgetOverviewRepository: GatewayBudgetOverviewRepository = {
  findBudget: async () => null,
};

type GatewaySetup = FeatureSetup<
  typeof GatewayApp.dependencies,
  Pick<ProcessMembers, "prisma" | "clickhouse" | "encryption"> &
    Readonly<{
      /** The expected control plane, where the gateway's own setting says nothing. */
      publicBaseUrl?: string | undefined;
      elevenLabsWebhook: ElevenLabsWebhookCollaborators | undefined;
      gatewayInternalProtocol: GatewayInternalProtocolCollaborators;
    }>,
  GatewayServerConfig
>;

export type GatewayInternalProtocolCollaborators = Readonly<{
  modelProviderCredentials?: GatewayModelProviderCredentials | undefined;
  configAssembly?: GatewayConfigAssembly | undefined;
  langyMirrorProjectId?: string | undefined;
  evaluatorRunner?: EvaluatorRunner | undefined;
  refreshCodex?: GatewayCodexRefresh | undefined;
  spend?: GatewayInternalSpendPipeline | undefined;
  realtimeSessions?: GatewayRealtimeSessionCollaborators | undefined;
}>;

export class GatewayApp implements GatewayApi {
  static readonly contract = GatewayApiToken;
  static readonly dependencies = {
    /**
     * The SAME outbound platform a live spend push is delivered through — the
     * reconciliation pull and the push must not disagree about what a customer
     * already received.
     */
    webhooks: WebhookApi,
    /**
     * Declared HERE though only the billing REST door ever asks it anything, so
     * a process with no plan store refuses at boot rather than answering every
     * org as entitled.
     */
    entitlement: EntitlementApi,
    /**
     * The four capabilities the control plane reaches that belong to other features, resolved
     * as peers rather than rebuilt. A guardrail attachment and the monitor page it points at
     * must agree about what one runs, so they are the SAME applications the process reads.
     */
    authz: AuthzApi,
    projects: ProjectApi,
    evaluators: EvaluatorApi,
    monitors: MonitorApi,
    /**
     * The two peers the per-member budget overview reads: organization
     * membership plus personal-workspace resolution, and the governance
     * kill switch it fails closed against.
     */
    organizations: OrganizationApi,
    featureFlags: FeatureFlagApi,
    /** The deployment's own providers, the only chain a license's managed key may dispatch on. */
    modelProviders: ModelProviderApi,
    /** The per-model spend a personal budget lists its top models from. */
    traces: TraceApi,
    /** Parks a fresh key's secret for one later read, when its create asks for `revealOnce`. */
    oneTimeReveals: SecretApi,
  };
  static readonly config = gatewayConfig;
  /**
   * The three AI Gateway credentials, all-or-none per
   * `assertGatewaySecretsAllOrNone` — optional here because a deployment that
   * runs no gateway needs none.
   */
  static readonly secrets = {
    internalSecret: gatewayInternalSecret,
    jwtSecret: Secret.load("LW_GATEWAY_JWT_SECRET", { optional: true }),
    virtualKeyPepper,
  } as const;
  /**
   * `prisma` is the one guarded connection every gateway row read runs on.
   * `clickhouse` is the control plane's ONE routing client, resolved per tenant
   * rather than a second pool — the spend ledger is a projection in that instance.
   */
  static readonly reads = [
    "prisma",
    "clickhouse",
    "encryption",
    "elevenLabsWebhook",
    "gatewayInternalProtocol",
    "publicBaseUrl",
  ] as const;

  static async create(setup: GatewaySetup): Promise<GatewayApp> {
    return setup.secrets.into(GatewayApp.secrets.internalSecret, (internalSecret) =>
      setup.secrets.into(GatewayApp.secrets.jwtSecret, (jwtSecret) =>
        setup.secrets.into(GatewayApp.secrets.virtualKeyPepper, (virtualKeyPepper) =>
          GatewayApp.#createWithSecrets(setup, { internalSecret, jwtSecret, virtualKeyPepper }),
        ),
      ),
    );
  }

  static #createWithSecrets(
    setup: GatewaySetup,
    secrets: Readonly<{
      internalSecret: string | undefined;
      jwtSecret: string | undefined;
      virtualKeyPepper: string | undefined;
    }>,
  ): GatewayApp {
    const controlPlane = buildGatewayControlPlane({
      prisma: setup.members.prisma,
      clickhouse: setup.members.clickhouse,
      peers: {
        authz: setup.dependencies.authz,
        projects: setup.dependencies.projects,
        evaluators: setup.dependencies.evaluators,
        monitors: setup.dependencies.monitors,
        platformProviders: setup.dependencies.modelProviders,
      },
      virtualKeyPepper: secrets.virtualKeyPepper,
    });
    const internalCollaborators = setup.members.gatewayInternalProtocol;
    const connectUpstream = GatewayConnectUpstreamService.create({
      repository: PrismaGatewayConnectUpstreamRepository.create(setup.members.prisma),
      cipher: setup.members.encryption,
    });
    const config =
      internalCollaborators.modelProviderCredentials && internalCollaborators.configAssembly
        ? GatewayConfigMaterialiserService.create({
            scopeResolution: controlPlane.internalScopeResolution,
            projects: setup.dependencies.projects,
            chRepo: controlPlane.budgetSpend ?? null,
            budgetDecisions: controlPlane.budgetDecisions,
            credentials: internalCollaborators.modelProviderCredentials,
            assembly: internalCollaborators.configAssembly,
            langyMirrorProjectId: internalCollaborators.langyMirrorProjectId,
            connectUpstream,
          })
        : void 0;
    const guardrails = internalCollaborators.evaluatorRunner
      ? GatewayGuardrailEvaluationService.create({
          repository: PrismaGatewayGuardrailRepository.create(setup.members.prisma),
          monitors: setup.dependencies.monitors,
          runEvaluator: internalCollaborators.evaluatorRunner,
        })
      : void 0;
    const spendCommands: Record<string, GatewaySpendCommandSender | undefined> = {};
    const internalProtocol = GatewayInternalProtocolService.create({
      virtualKeys: controlPlane.internalVirtualKeys,
      projects: setup.dependencies.projects,
      jwt: secrets.jwtSecret ? GatewayJwtService.create({ secret: secrets.jwtSecret }) : void 0,
      store: PrismaGatewayInternalStoreRepository.create({ database: setup.members.prisma }),
      changes: controlPlane.internalChanges,
      config,
      budgetSpend: controlPlane.budgetSpend,
      refreshCodex: internalCollaborators.refreshCodex,
      guardrails,
      spend: internalCollaborators.spend ?? {
        commands: spendCommands,
        rating: ModelCatalogGatewaySpendRatingService.create(),
      },
      realtimeSessions:
        internalCollaborators.realtimeSessions ?? setup.members.elevenLabsWebhook?.sessions,
    });

    return new GatewayApp({
      members: {
        ...controlPlane,
        ...(setup.members.elevenLabsWebhook
          ? { elevenLabsWebhook: setup.members.elevenLabsWebhook }
          : {}),
      },
      internalProtocol,
      internalDoor: GatewayInternalIdentityService.create({ secret: secrets.internalSecret }),
      spendPipeline: {
        ledger: controlPlane.spendLedger,
        commands: spendCommands,
        webhooks: setup.dependencies.webhooks,
      },
      spend: {
        prisma: setup.members.prisma,
        webhooks: setup.dependencies.webhooks,
        // `settlementGraceMs` owns the parse, the bound and the warning on the
        // raw `LW_SPEND_SETTLEMENT_GRACE_MS` string, so this carries it as
        // written and never reads a second answer out of it. `setup.config`
        // is undefined only in a test stub that does not care about billing
        // config; a real boot always states one through the process parse.
        settlementGraceMs: settlementGraceMs(setup.config?.spendSettlementGraceMs),
      },
      budgetOverviewDeps: {
        organizations: setup.dependencies.organizations,
        featureFlags: setup.dependencies.featureFlags,
        traces: setup.dependencies.traces,
      },
      addresses: {
        baseUrl: setup.config?.internalUrl ?? setup.config?.baseUrl,
        publicUrl: setup.config?.publicUrl ?? setup.config?.baseUrl,
        expectedControlPlaneUrl: setup.config?.controlPlaneUrl ?? setup.members.publicBaseUrl,
      },
      connectUpstream,
      oneTimeReveals: setup.dependencies.oneTimeReveals,
    });
  }

  #coreDependencies: GatewayAppDependencies | undefined;
  #agentCache: GatewayAgentCacheService | undefined;
  #connectManagedKeys: ConnectManagedKeyService | undefined;
  #elevenLabsWebhook: GatewayElevenLabsWebhookService | undefined;
  #spend: GatewaySpendCollaborators | undefined;
  #spendPipeline: GatewaySpendPipelineParts | undefined;
  #spendScope: PrismaGatewaySpendScopeRepository | undefined;
  #settlementPolicy: FixedGatewaySettlementPolicyService | undefined;
  #budgetOverviewDeps: GatewayBudgetOverviewDeps | undefined;
  #budgetOverview: BudgetOverviewService | undefined;
  #budgetLedger: GatewayBudgetLedgerService | undefined;
  #internalProtocol: GatewayInternalProtocolService;
  #internalDoor: RestIdentity;
  #connectUpstream: GatewayConnectUpstreamService | undefined;
  #addresses: GatewayDeploymentAddresses;
  #oneTimeReveals: SecretApi | undefined;

  private constructor({
    members,
    internalProtocol,
    internalDoor,
    spendPipeline,
    spend,
    budgetOverviewDeps,
    addresses = {
      baseUrl: void 0,
      publicUrl: void 0,
      expectedControlPlaneUrl: void 0,
    },
    connectUpstream,
    oneTimeReveals,
  }: {
    members: GatewayInfrastructure;
    internalProtocol: GatewayInternalProtocolService;
    internalDoor: RestIdentity;
    spendPipeline?: GatewaySpendPipelineParts;
    spend?: GatewaySpendCollaborators;
    budgetOverviewDeps?: GatewayBudgetOverviewDeps;
    addresses?: GatewayDeploymentAddresses;
    connectUpstream?: GatewayConnectUpstreamService;
    oneTimeReveals?: SecretApi;
  }) {
    this.#addresses = addresses;
    this.#oneTimeReveals = oneTimeReveals;
    this.#connectUpstream = connectUpstream;
    this.#spend = spend;
    this.#spendPipeline = spendPipeline;
    this.#internalProtocol = internalProtocol;
    this.#internalDoor = internalDoor;
    this.#budgetOverviewDeps = budgetOverviewDeps;
    // The union's second arm exists for the REST-only composition (agent cache
    // and the ElevenLabs callback), which carries no control plane. Every
    // installed process now takes the first.
    this.#coreDependencies = "virtualKeys" in members ? members : void 0;
    this.#agentCache = members.agentCache
      ? GatewayAgentCacheService.create(members.agentCache)
      : void 0;
    this.#elevenLabsWebhook = members.elevenLabsWebhook
      ? GatewayElevenLabsWebhookService.create(members.elevenLabsWebhook)
      : void 0;
  }

  /** gateway_spend as this role registers it: the worker folds the ledger, the api only sends. */
  spendPipeline({
    participation,
  }: {
    participation: EventingParticipation;
  }): GatewaySpendDefinition {
    if (participation === "produce") {
      return GatewaySpendProducerAdapter.create().createGatewaySpendProducerPipeline({
        processName: "langwatch-api",
      });
    }
    const ledger = this.#spendPipeline?.ledger;
    if (!ledger) throw this.spendStoreUnavailable();
    return EventingGatewaySpendAdapter.create({
      spendEvents: ledger,
      webhookSpendDelivery: this.#spendPipeline?.webhooks,
    }).buildProcessing();
  }

  /** The registered senders the data plane's /spend-commands and priced spend append through. */
  connectSpend(commands: Readonly<Record<string, EventingCommandSender<unknown>>>): void {
    const connected = this.#spendPipeline?.commands;
    if (!connected) return;
    for (const [name, sender] of Object.entries(commands)) {
      connected[name] = {
        send: (payload) => sender.send(spendCommandRecord(name, payload)),
        sendBatch: (payloads) =>
          sender.sendBatch(payloads.map((payload) => spendCommandRecord(name, payload))),
      };
    }
  }

  get internalDoor(): RestIdentity {
    return this.#internalDoor;
  }

  findVirtualKeyBySecret(secret: string): Promise<GatewayVirtualKeyRecord | null> {
    return this.#internalProtocol.findVirtualKeyBySecret(secret);
  }

  resolveLicenseToken(input: {
    token: string;
    instanceId: string | undefined;
  }): Promise<GatewayLicenseTokenResolution> {
    return this.#internalProtocol.resolveLicenseToken(input);
  }

  findTraceDestination(projectId: string): Promise<{
    id: string;
    teamId: string;
  } | null> {
    return this.#internalProtocol.findTraceDestination(projectId);
  }

  signJwt(...args: Parameters<GatewayInternalProtocolService["signJwt"]>): {
    jwt: string;
    expiresAt: number;
  } {
    return this.#internalProtocol.signJwt(...args);
  }

  touchVirtualKeyUsage(id: string): Promise<void> {
    return this.#internalProtocol.touchVirtualKeyUsage(id);
  }

  refreshCodex(...args: Parameters<GatewayInternalProtocolService["refreshCodex"]>) {
    return this.#internalProtocol.refreshCodex(...args);
  }

  findVirtualKeyForConfig(id: string): Promise<VirtualKeyWithScopes | null> {
    return this.#internalProtocol.findVirtualKeyForConfig(id);
  }

  configVersionToken(input: VirtualKeyWithScopes): Promise<string> {
    return this.#internalProtocol.configVersionToken(input);
  }

  materialiseConfig(input: VirtualKeyWithScopes): Promise<unknown> {
    return this.#internalProtocol.materialiseConfig(input);
  }

  listChanges(
    organizationId: string,
    since: bigint,
    limit: number,
  ): Promise<{
    currentRevision: bigint;
    events: {
      kind: string;
      virtualKeyId: string | null;
      budgetId: string | null;
      modelProviderId: string | null;
      projectId: string | null;
      revision: bigint;
    }[];
  }> {
    return this.#internalProtocol.listChanges(organizationId, since, limit);
  }

  currentRevision(organizationId: string): Promise<bigint> {
    return this.#internalProtocol.currentRevision(organizationId);
  }

  checkGuardrails(...args: Parameters<GatewayInternalProtocolService["checkGuardrails"]>) {
    return this.#internalProtocol.checkGuardrails(...args);
  }

  budgetBucketSpend(
    ...args: Parameters<GatewayInternalProtocolService["budgetBucketSpend"]>
  ): Promise<
    | {
        status: "not_found";
      }
    | {
        status: "available";
        spentMicroUsd: number;
        bucketScopeId: string | null;
      }
  > {
    return this.#internalProtocol.budgetBucketSpend(...args);
  }

  submitSpendCommands(
    records: GatewayInternalSpendCommandRecord[],
  ): Promise<GatewayInternalSpendSubmission> {
    return this.#internalProtocol.submitSpendCommands(records);
  }

  recordPricedSpend(input: GatewayPricedSpend): Promise<GatewayPricedSpendResult> {
    return this.#internalProtocol.recordPricedSpend(input);
  }

  reserveRealtimeSession(
    ...args: Parameters<GatewayInternalProtocolService["reserveRealtimeSession"]>
  ) {
    return this.#internalProtocol.reserveRealtimeSession(...args);
  }

  correlateRealtimeSession(
    ...args: Parameters<GatewayInternalProtocolService["correlateRealtimeSession"]>
  ) {
    return this.#internalProtocol.correlateRealtimeSession(...args);
  }

  releaseRealtimeSession(
    ...args: Parameters<GatewayInternalProtocolService["releaseRealtimeSession"]>
  ) {
    return this.#internalProtocol.releaseRealtimeSession(...args);
  }

  reportRealtimeSessionUsage(
    ...args: Parameters<GatewayInternalProtocolService["reportRealtimeSessionUsage"]>
  ) {
    return this.#internalProtocol.reportRealtimeSessionUsage(...args);
  }

  getAgentCacheEntry(input: { projectId: string; name: string }): Promise<{
    name: string;
    value: string;
  }> {
    return this.#agentCacheService().get(input);
  }

  putAgentCacheEntry(input: GatewayAgentCacheWriteInput): Promise<{
    name: string;
    ttl_seconds: number;
  }> {
    return this.#agentCacheService().put(input);
  }

  claimAgentCacheEntry(input: GatewayAgentCacheWriteInput): Promise<{
    name: string;
    claimed: boolean;
    ttl_seconds: number;
  }> {
    return this.#agentCacheService().claim(input);
  }

  deleteAgentCacheEntry(input: { projectId: string; name: string }): Promise<void> {
    return this.#agentCacheService().delete(input);
  }

  receiveElevenLabsWebhook(input: {
    modelProviderId: string;
    rawBody: string;
    signature: string | undefined;
  }): Promise<GatewayElevenLabsWebhookAnswer> {
    const service = this.#elevenLabsWebhook;
    if (!service) throw new Error("The ElevenLabs family was mounted without its members");

    return service.receive(input);
  }

  // ── The billing reconciliation family (ADR-072) ─────────────────────────
  // The four `/api/gateway/v1` spend routes read the members below, answered
  // HERE rather than filled by composition, so a deployment cannot mix the
  // pull surface's envelope/subscription/settlement-grace format with a
  // different one than the push half already uses.

  /** The endpoint registry a replay names its destination in. */
  webhookEndpoints(): {
    findDeliverable(input: {
      organizationId: string;
      endpointId: string;
    }): Promise<{ id: string; enabledEvents: readonly string[] } | null>;
  } {
    const webhooks = this.#spendCollaborators.webhooks;

    return { findDeliverable: (input) => webhooks.findDeliverable(input) };
  }

  /** The emitted-envelope log a replay walks, one page at a time. */
  webhookEvents(): WebhookApi {
    return this.#spendCollaborators.webhooks;
  }

  /**
   * The live delivery path a replay appends to: the webhook platform's own
   * `WebhookApi.appendReplayToEndpointStream`, reached through the same
   * declared peer `webhookEvents()` above already uses.
   */
  webhookDelivery(): WebhookApi {
    return this.#spendCollaborators.webhooks;
  }

  /** One spend row rendered as the canonical billing envelope. */
  spendEventEnvelope(row: WebhookSpendEventRow): GatewaySpendEventEnvelope {
    return gatewaySpendEventEnvelopeSchema.parse(webhookEnvelopeFromSpendRow(row));
  }

  /** Whether an endpoint's subscriptions cover one event type. */
  endpointAcceptsEvent(input: { enabledEvents: readonly string[]; eventType: string }): boolean {
    return eventMatches(input.enabledEvents, input.eventType);
  }

  /** How long after a request an outcome may still arrive. */
  settlementPolicy(): FixedGatewaySettlementPolicyService {
    return (this.#settlementPolicy ??= FixedGatewaySettlementPolicyService.create(
      this.#spendCollaborators.settlementGraceMs,
    ));
  }

  /** Resolves Postgres filters to ClickHouse ids. A no-match resolves to EMPTY. */
  resolveSpendScope(
    input: Parameters<PrismaGatewaySpendScopeRepository["resolveSpendScope"]>[0],
  ): ReturnType<PrismaGatewaySpendScopeRepository["resolveSpendScope"]> {
    // Held rather than rebuilt per call: the adapter keeps a project cache, and
    // a fresh one per request would resolve every filter from cold.
    this.#spendScope ??= PrismaGatewaySpendScopeRepository.create({
      database: this.#spendCollaborators.prisma,
    });

    return this.#spendScope.resolveSpendScope(input);
  }

  /** Every attributed-user budget that applies to one end user, with spend. */
  endUserCaps(input: {
    organizationId: string;
    endUserId: string;
    tenantIds: string[];
    virtualKeyId?: string;
    budgetRepository: GatewayBudgetSpend;
  }): Promise<GatewayEndUserCap[]> {
    const { budgetRepository, organizationId, endUserId, tenantIds, virtualKeyId } = input;

    return GatewayEndUserCapsAdapter.create({
      database: this.#spendCollaborators.prisma,
      spend: budgetRepository,
    }).forEndUser({
      organizationId,
      endUserId,
      tenantIds,
      ...(virtualKeyId === undefined ? {} : { virtualKeyId }),
    });
  }

  getPrincipalSpendSummary(input: {
    projectId: string;
    userId: string;
    window: GatewayPrincipalSpendWindow;
  }): Promise<GatewayPrincipalSpendSummary> {
    return this.#principalSpendRead().getSummary({
      tenantId: input.projectId,
      userId: input.userId,
      window: input.window,
    });
  }

  findPrincipalDailySpend(input: {
    projectId: string;
    userId: string;
    window: GatewayPrincipalSpendWindow;
  }): Promise<GatewayPrincipalDailySpend[]> {
    return this.#principalSpendRead().findDailySpend({
      tenantId: input.projectId,
      userId: input.userId,
      window: input.window,
    });
  }

  findPrincipalModelSpend(input: {
    projectId: string;
    userId: string;
    window: GatewayPrincipalSpendWindow;
  }): Promise<GatewayPrincipalModelSpend[]> {
    return this.#principalSpendRead().findModelSpend({
      tenantId: input.projectId,
      userId: input.userId,
      window: input.window,
    });
  }

  #principalSpendRead(): GatewayPrincipalSpendRepository {
    const principalSpend = this.#coreDependencies?.principalSpend;
    if (!principalSpend) throw this.spendStoreUnavailable();
    return principalSpend;
  }

  /** The refusal for "the store these figures live in is not reachable". */
  spendStoreUnavailable(): Error {
    return new ClickHouseUnavailableError();
  }

  /**
   * The spend-event ledger reader and the budget ledger, as the reconciliation
   * routes read them. Refused by name where this process composed no gateway control
   * plane, rather than answering with a confident zero.
   */
  getSpendEvents(): GatewaySpendEventsService {
    const spendEvents = this.#coreDependencies?.spendEvents;
    if (!spendEvents) throw this.spendStoreUnavailable();
    return spendEvents;
  }

  /** The usage report's figures (ADR-156 section 10); refused where no spend ledger is composed. */
  async countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<GatewayUsageCount> {
    return this.getSpendEvents().countUsage(input);
  }

  getBudgetSpend(): GatewayBudgetSpend {
    const budgetSpend = this.#coreDependencies?.budgetSpend;
    if (!budgetSpend) throw this.spendStoreUnavailable();
    return budgetSpend;
  }

  get #spendCollaborators(): GatewaySpendCollaborators {
    const spend = this.#spend;
    if (!spend) throw new Error("The gateway billing family was mounted without its members");

    return spend;
  }

  /** Built once and reused, on a path an org's own /me page reads often. */
  get #budgetOverviewService(): BudgetOverviewService {
    const deps = this.#budgetOverviewDeps;
    if (!deps)
      throw new Error("The gateway budget-overview family was mounted without its members");

    return (this.#budgetOverview ??= BudgetOverviewService.create({
      // Unread by `overviewForUser`: only the budget's own `findBudgetOverview` read uses it.
      repository: unusedBudgetOverviewRepository,
      organizations: deps.organizations,
      featureFlags: deps.featureFlags,
      // The service asks for one principal's own active keys; this application
      // has no narrower read than the org's full key list, so it filters the
      // same way the service's own Prisma-backed reader would.
      personalVirtualKeys: {
        listActiveForPrincipal: async ({ userId, organizationId }) =>
          (await this.#dependencies.virtualKeys.getAll(organizationId))
            .filter((vk) => vk.principalUserId === userId && vk.revokedAt === null)
            .map((vk) => ({ id: vk.id })),
      },
      budgetDecisions: this.#dependencies.budgetDecisions,
      providerLabels: {
        resolveProviderLabels: (budgets) => this.#dependencies.resolveProviderLabels(budgets),
      },
      budgetRepository: this.#dependencies.budgetSpend,
      modelSpend: deps.traces,
    }));
  }

  budgetOverviewForUser(input: {
    organizationId: string;
    userId: string;
    includeTopModels?: boolean;
  }): Promise<GatewayBudgetOverviewForUser> {
    return this.#budgetOverviewService.overviewForUser(input);
  }

  #agentCacheService(): GatewayAgentCacheService {
    const service = this.#agentCache;
    if (!service) throw new Error("The agent-cache family was mounted without its members");

    return service;
  }

  get #dependencies(): GatewayAppDependencies {
    const dependencies = this.#coreDependencies;
    if (!dependencies) throw new Error("The gateway control plane was not installed");

    return dependencies;
  }

  listBudgetsWithHealth(organizationId: string): Promise<GatewayBudgetListWithHealth> {
    return this.#dependencies.budgetDecisions.listWithHealth(organizationId);
  }

  listBudgetPageWithHealth(input: GatewayBudgetPageInput): Promise<GatewayBudgetPageWithHealth> {
    return this.#dependencies.budgetDecisions.listPageWithHealth(input);
  }

  async getBudgetWithHealth(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetHealth> {
    const found = await this.#dependencies.budgetDecisions.findHealthById(input);
    if (!found) throw new GatewayBudgetNotFoundError();
    return found;
  }

  budgetScopeReach(input: GatewayBudgetScopeReachInput): Promise<GatewayBudgetScopeReachResult> {
    return this.#dependencies.budgetDecisions.scopeReach(input);
  }

  listCacheRulePage(input: GatewayCacheRulePageInput): Promise<GatewayCacheRuleResource[]> {
    return this.#dependencies.budgetDecisions.cacheRuleListPage(input);
  }

  listProjectBudgetsWithHealth(projectId: string): Promise<GatewayBudgetListWithHealth> {
    return this.#dependencies.budgetDecisions.listForProjectWithHealth(projectId);
  }

  listBudgetScopeTargets(
    budgets: { scopeType: string; scopeId: string }[],
    organizationId: string | null,
  ): Promise<Map<string, GatewayBudgetScopeTarget>> {
    return this.#dependencies.budgetDecisions.resolveScopeTargets(budgets, organizationId);
  }

  findBudgetDetail(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetDetail | null> {
    return this.#dependencies.budgetDecisions.findDetailById(input);
  }

  createBudget(input: CreateGatewayBudgetInput): Promise<GatewayBudgetResource> {
    return this.#dependencies.budgetDecisions.create(input);
  }

  updateBudget(input: UpdateGatewayBudgetInput): Promise<GatewayBudgetResource> {
    return this.#dependencies.budgetDecisions.update(input);
  }

  archiveBudget(input: ArchiveGatewayBudgetInput): Promise<GatewayBudgetResource> {
    return this.#dependencies.budgetDecisions.archive(input);
  }

  resetBudget(input: ResetGatewayBudgetInput): Promise<GatewayBudgetResource> {
    return this.#dependencies.budgetDecisions.reset(input);
  }

  listGuardrails(projectId: string): Promise<GatewayGuardrailResource[]> {
    return this.#dependencies.budgetDecisions.guardrailList(projectId);
  }

  findGuardrail(input: {
    id: string;
    projectId: string;
  }): Promise<GatewayGuardrailResource | null> {
    return this.#dependencies.budgetDecisions.findGuardrail(input);
  }

  createGuardrail(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    return this.#dependencies.budgetDecisions.guardrailCreate(input);
  }

  updateGuardrail(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    return this.#dependencies.budgetDecisions.guardrailUpdate(input);
  }

  archiveGuardrail(input: ArchiveGatewayGuardrailInput): Promise<void> {
    return this.#dependencies.budgetDecisions.guardrailArchive(input);
  }

  listCacheRules(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    return this.#dependencies.budgetDecisions.cacheRuleList(organizationId);
  }

  findCacheRule(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null> {
    return this.#dependencies.budgetDecisions.findCacheRule(input);
  }

  createCacheRule(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    return this.#dependencies.budgetDecisions.cacheRuleCreate(input);
  }

  updateCacheRule(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    return this.#dependencies.budgetDecisions.cacheRuleUpdate(input);
  }

  archiveCacheRule(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    return this.#dependencies.budgetDecisions.cacheRuleArchive(input);
  }

  async findProjectOrganization(projectId: string): Promise<string | null> {
    // The directory answers `undefined` for a project it does not hold; the
    // gateway's own vocabulary for "no such row" is null throughout.
    return (await this.#dependencies.projects.findOrganizationId(projectId)) ?? null;
  }

  usageSummary(input: {
    organizationId: string;
    virtualKeyIds: string[];
    window: UsageWindow;
  }): Promise<GatewayUsageSummary> {
    return this.#dependencies.usage.summary(input);
  }

  usageSummaryForVirtualKey(input: {
    organizationId: string;
    virtualKeyId: string;
    window: UsageWindow;
    model?: string;
  }): Promise<GatewayVirtualKeyUsageSummary> {
    return this.#dependencies.usage.summaryForVirtualKey(input);
  }

  async sumSpendNanoUsdByRequestType(
    input: Parameters<GatewayApi["sumSpendNanoUsdByRequestType"]>[0],
  ): Promise<number> {
    const service = this.#dependencies.spendEvents;
    // No ledger means nothing was ever recorded on it, so nothing was spent.
    if (!service) return 0;

    return service.sumSpendNanoUsdByRequestType({
      ...input,
      tenantIds: [...input.tenantIds],
    });
  }

  async findSpendDaysForOrganizationProjects(input: {
    tenantIds: readonly string[];
    fromDay: string;
    toDay: string;
  }): Promise<GatewaySpendDay[]> {
    const service = this.#dependencies.spendEvents;
    if (!service) return [];
    return service.findSpendDaysForOrganizationProjects(input);
  }

  async listSpendEventsPage(
    input: Parameters<GatewayApi["listSpendEventsPage"]>[0],
  ): ReturnType<GatewayApi["listSpendEventsPage"]> {
    const service = this.#dependencies.spendEvents;
    if (!service) return null;

    const { rows, nextCursor } = await service.getSpendEventsPage({
      tenantId: input.projectId,
      fromMs: input.fromMs,
      toMs: input.toMs,
      filters: input.filters ?? {},
      cursor: input.cursor,
      limit: input.limit ?? 50,
    });

    const vkIds = [...new Set(rows.map((r) => r.virtualKeyId))].filter((id) => id.length > 0);
    // The ids come from this project's own tenant-filtered spend rows, and the
    // Project service resolves the owning-organization fence without exposing
    // Project persistence to this transport.
    const organizationId = await this.findProjectOrganization(input.projectId);
    const vks =
      vkIds.length && organizationId
        ? await this.resolveVirtualKeyNames({ organizationId, virtualKeyIds: vkIds })
        : [];
    const virtualKeyNames = Object.fromEntries(vks.map((vk) => [vk.id, vk.name]));

    // The wire still carries a Date on this row, so the instant the ledger
    // reads becomes one here rather than anywhere above.
    return {
      rows: rows.map((row) => ({ ...row, occurredAt: toDate(row.occurredAt) })),
      nextCursor,
      virtualKeyNames,
      clickHouseDisabled: false,
    };
  }

  findPersonalVirtualKeys(input: {
    organizationId?: string;
    principalUserId?: string;
  }): Promise<GatewayVirtualKeyRecord[]> {
    return this.#dependencies.virtualKeys.findLiveWithPrincipal(input);
  }

  findVirtualKeyById(id: string, organizationId: string): Promise<GatewayVirtualKeyRecord | null> {
    return this.#dependencies.virtualKeys.findById(id, organizationId);
  }

  async createVirtualKey({
    revealOnce,
    ...input
  }: GatewayVirtualKeyCreateInput &
    Readonly<{ revealOnce?: boolean }>): Promise<GatewayMintedVirtualKey> {
    const minted = await this.#dependencies.virtualKeys.create(input);
    if (!revealOnce) return minted;
    const reveals = this.#oneTimeReveals;
    if (!reveals) throw new Error("The one-time reveal store was not installed");
    const preview = minted.virtualKey.displayPrefix;
    const { revealId } = await reveals.stashReveal({
      organizationId: input.organizationId,
      kind: "virtual_key",
      keyId: minted.virtualKey.id,
      preview,
      secret: minted.secret,
    });
    return { ...minted, reveal: { revealId, preview } };
  }

  updateVirtualKey(input: GatewayVirtualKeyUpdateInput): Promise<GatewayVirtualKeyRecord> {
    return this.#dependencies.virtualKeys.update(input);
  }

  rotateVirtualKey(input: GatewayVirtualKeyRotateInput): Promise<GatewayMintedVirtualKey> {
    return this.#dependencies.virtualKeys.rotate(input);
  }

  revokeVirtualKey(input: GatewayVirtualKeyRevokeInput): Promise<GatewayVirtualKeyRecord> {
    return this.#dependencies.virtualKeys.revoke(input);
  }

  provisionConnectManagedKey(input: {
    organizationId: string;
    licenseId: string;
    actorUserId: string;
  }): Promise<{ id: string }> {
    return this.#connectManagedKeyService().provision(input);
  }

  revokeManagedInternal(input: {
    virtualKeyId: string;
    organizationId: string;
    actorId: string;
  }): Promise<void> {
    return this.#connectManagedKeyService().retire(input);
  }

  invalidateManagedInternal(input: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<void> {
    return this.#connectManagedKeyService().invalidate(input);
  }

  setManagedKeyConnectServicesInternal(input: {
    virtualKeyId: string;
    organizationId: string;
    services: readonly string[];
  }): Promise<void> {
    return this.#connectManagedKeyService().setConnectServices(input);
  }

  setManagedKeyLicenseInternal(input: {
    virtualKeyId: string;
    organizationId: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant | null;
  }): Promise<void> {
    return this.#connectManagedKeyService().setLicense(input);
  }

  setConnectUpstreamInternal(input: GatewayConnectUpstream): Promise<void> {
    return this.#connectUpstreamService().set(input);
  }

  clearConnectUpstreamInternal(input: { organizationId: string }): Promise<void> {
    return this.#connectUpstreamService().clear(input);
  }

  #connectUpstreamService(): GatewayConnectUpstreamService {
    if (!this.#connectUpstream) {
      throw new Error("this process composes no hosted provider slot for connected installs");
    }
    return this.#connectUpstream;
  }

  #connectManagedKeyService(): ConnectManagedKeyService {
    const dependencies = this.#dependencies;
    this.#connectManagedKeys ??= ConnectManagedKeyService.create({
      virtualKeys: dependencies.virtualKeys,
      home: dependencies.projects,
    });

    return this.#connectManagedKeys;
  }

  disableVirtualKey(input: GatewayVirtualKeyDisableInput): Promise<GatewayVirtualKeyRecord> {
    return this.#dependencies.virtualKeys.disable(input);
  }

  enableVirtualKey(input: GatewayVirtualKeyEnableInput): Promise<GatewayVirtualKeyRecord> {
    return this.#dependencies.virtualKeys.enable(input);
  }

  isSpendSourceAvailable(): boolean {
    return this.#dependencies.spendSourceAvailable;
  }

  getDeploymentAddresses(): GatewayDeploymentAddresses {
    return this.#addresses;
  }

  parseVirtualKeyBudget(input: unknown):
    | {
        success: true;
        data: VirtualKeyBudgetInput;
      }
    | {
        success: false;
        error: {
          message: string;
        };
      } {
    return this.#dependencies.schemas.virtualKeyBudgetInput.safeParse(input);
  }

  getVirtualKeyPage(
    input: GatewayVirtualKeyOperations extends {
      getPage(input: infer Input): unknown;
    }
      ? Input
      : never,
  ): Promise<GatewayVirtualKeyRecord[]> {
    return this.#dependencies.virtualKeys.getPage(input);
  }

  // ── Tenancy anchors and directory reads ──────────────────────────────────

  organizationIdForProject(projectId: string): Promise<string> {
    return this.#dependencies.organizationIdForProject(projectId);
  }

  assertOrganizationExists(organizationId: string): Promise<void> {
    return this.#dependencies.assertOrganizationExists(organizationId);
  }

  resolveProviderLabels(
    budgets: readonly { providerKey: string | null }[],
  ): Promise<Map<string, string>> {
    return this.#dependencies.resolveProviderLabels(budgets);
  }

  listGroupTargets(
    organizationId: string,
  ): Promise<readonly { id: string; name: string; memberCount: number }[]> {
    return this.#dependencies.listGroupTargets(organizationId);
  }

  groupMemberCounts(
    budgets: readonly { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, number>> {
    return this.#dependencies.groupMemberCounts(budgets);
  }

  resolveVirtualKeyNames(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
  }): Promise<readonly { id: string; name: string }[]> {
    return this.#dependencies.resolveVirtualKeyNames(input);
  }

  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean> {
    return this.#dependencies.isOrganizationMember(input);
  }

  actorForCredential(input: { projectId: string; credential: GatewayRequestCredential }): {
    actor: GatewayActor;
    actorUserId: string;
  } {
    return this.#dependencies.actorForCredential(input);
  }

  // ── Visibility ───────────────────────────────────────────────────────────

  listVisibleVirtualKeys(input: {
    organizationId: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes[]> {
    return this.#dependencies.listVisibleVirtualKeys(input);
  }

  isVirtualKeyVisible(input: {
    organizationId: string;
    userId: string;
    virtualKey: VirtualKeyWithScopes;
  }): Promise<boolean> {
    return this.#dependencies.isVirtualKeyVisible(input);
  }

  getVisibleVirtualKeyForUser(input: {
    organizationId: string;
    id: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.#dependencies.getVisibleVirtualKeyForUser(input);
  }

  visibleToProjectCredential(input: {
    project: ProjectIdentity;
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): VirtualKeyWithScopes[] {
    return this.#dependencies.visibleToProjectCredential(input);
  }

  getVisibleVirtualKeyForProjectCredential(input: {
    project: ProjectIdentity;
    id: string;
    organizationId: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.#dependencies.getVisibleVirtualKeyForProjectCredential(input);
  }

  getExistingVirtualKey(input: {
    organizationId: string;
    id: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.#dependencies.getExistingVirtualKey(input);
  }

  // ── Projections and spend ────────────────────────────────────────────────

  toVirtualKeyCamelDtos(input: {
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): Promise<VirtualKeyCamelDto[]> {
    return this.#dependencies.toVirtualKeyCamelDtos(input);
  }

  toVirtualKeySnakeDtos(input: {
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): Promise<VirtualKeySnakeDto[]> {
    return this.#dependencies.toVirtualKeySnakeDtos(input);
  }

  /**
   * One key projected through the batched read a listing uses — a page of one, not a second
   * projection, since a key's destination fact belongs to the PROJECT row, and a per-key path
   * would be the one place a deleted destination could still read as live.
   */
  async toVirtualKeyCamelDto(virtualKey: VirtualKeyWithScopes): Promise<VirtualKeyCamelDto> {
    const [dto] = await this.#dependencies.toVirtualKeyCamelDtos({ virtualKeys: [virtualKey] });
    if (!dto) throw new Error("the virtual key projection returned no row");
    return dto;
  }

  /** One key projected into the published snake_case shape. */
  async toVirtualKeySnakeDto(virtualKey: VirtualKeyWithScopes): Promise<VirtualKeySnakeDto> {
    const [dto] = await this.#dependencies.toVirtualKeySnakeDtos({ virtualKeys: [virtualKey] });
    if (!dto) throw new Error("the virtual key projection returned no row");
    return dto;
  }

  listApplicableBudgets(input: {
    target: GatewayApplicableBudgetTarget;
  }): Promise<GatewayApplicableBudget[]> {
    return this.#dependencies.listApplicableBudgets(input);
  }

  resolveApplicableBudgets(input: GatewayBudgetResolutionTarget): Promise<GatewayResolvedBudget[]> {
    return this.#dependencies.budgetDecisions.resolveApplicableBudgets(input);
  }

  checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult> {
    return this.#dependencies.budgetDecisions.checkBudget(input);
  }

  insertSpendDebit(rows: readonly GatewayBudgetDebitRow[]): Promise<void> {
    return this.#budgetLedgerService.insertDebit(rows);
  }

  appendBudgetChange(input: GatewayBudgetChangeInput): Promise<void> {
    return this.#budgetLedgerService.appendBudgetChange(input);
  }

  get #budgetLedgerService(): GatewayBudgetLedgerService {
    return (this.#budgetLedger ??= GatewayBudgetLedgerService.create({
      spend: this.#dependencies.budgetSpend,
      changes: this.#dependencies.changeEvents,
    }));
  }

  loadDirectBudgetsForKeys(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    now: Instant;
  }): Promise<Map<string, GatewayVirtualKeyDirectBudget>> {
    return this.#dependencies.loadDirectBudgetsForKeys(input);
  }

  spendByVirtualKey(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    window: { fromDate: Instant; toDate: Instant };
  }): Promise<Map<string, { spentUsd: string; requests: number }>> {
    return this.#dependencies.spendByVirtualKey(input);
  }

  // ── The virtual-key write pre-flights ────────────────────────────────────

  /**
   * Requires manage on every requested scope (anchored to this org) and manage on the
   * destination project too — NOT mere tenancy, since the destination also routes budget debits
   * and tenancy alone would let a team manager point a key at a sibling team's budget.
   */
  async authorizeVirtualKeyScopeSelection(input: {
    actor: GatewayActor;
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
    traceProjectId: string | null | undefined;
  }): Promise<void> {
    const { actor, organizationId, scopes, traceProjectId } = input;
    await this.#dependencies.assertCanManageAllScopes({ actor, scopes });
    await this.#dependencies.assertScopesBelongToOrganization({ organizationId, scopes });
    await this.#dependencies.assertTraceProjectBelongsToOrganization({
      organizationId,
      traceProjectId,
    });
    if (traceProjectId) {
      await this.#dependencies.assertCanManageAllScopes({
        actor,
        scopes: [{ scopeType: "PROJECT", scopeId: traceProjectId }],
      });
    }
  }

  /**
   * A project credential's create: integrity before permission, so a scope outside this
   * organization answers `gateway_scope_org_mismatch` rather than a generic denial.
   */
  private async authorizeProjectCredentialScopes(input: {
    actor: GatewayActor;
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
    traceProjectId: string | null | undefined;
    callerProjectId: string;
  }): Promise<void> {
    const { actor, organizationId, scopes, traceProjectId, callerProjectId } = input;
    await this.#dependencies.assertScopesBelongToOrganization({ organizationId, scopes });
    await this.#dependencies.assertCanCreateScopes({ actor, scopes, callerProjectId });
    await this.#dependencies.assertTraceProjectBelongsToOrganization({
      organizationId,
      traceProjectId,
    });
    if (traceProjectId) {
      await this.#dependencies.assertCanManageAllScopes({
        actor,
        scopes: [{ scopeType: "PROJECT", scopeId: traceProjectId }],
      });
    }
  }

  /**
   * Everything that must hold before a key is minted: scope selection, then guardrail
   * attachments against the resolved project. Read-only, not folded into the mint — the
   * public create dispatches via an idempotency receipt, and skipping this trusts a stale grant.
   */
  async authorizeVirtualKeyCreate(input: {
    actor: GatewayActor;
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
    traceProjectId: string | null | undefined;
    guardrailAttachments: readonly GuardrailAttachment[] | undefined;
    callerProjectId?: string | undefined;
  }): Promise<void> {
    const { actor, organizationId, scopes, traceProjectId, guardrailAttachments } = input;
    if (input.callerProjectId === undefined) {
      await this.authorizeVirtualKeyScopeSelection({
        actor,
        organizationId,
        scopes,
        traceProjectId,
      });
    } else {
      await this.authorizeProjectCredentialScopes({
        actor,
        organizationId,
        scopes,
        traceProjectId,
        callerProjectId: input.callerProjectId,
      });
    }
    await this.#dependencies.assertGuardrailAttachmentsAllowed({
      actor,
      organizationId,
      virtualKeyId: null,
      scopes,
      traceProjectId: traceProjectId ?? null,
      attachments: guardrailAttachments,
    });
  }

  /**
   * Mutating needs update on a scope the key ALREADY lives in; re-scoping additionally needs
   * manage on every NEW scope. scopes/traceProjectId absent means "not changing" — but a scope
   * change without re-sent config still revalidates STORED attachments against the new project.
   */
  async authorizeVirtualKeyUpdate(input: {
    actor: GatewayActor;
    organizationId: string;
    id: string;
    scopes?: readonly GatewayVirtualKeyScope[] | undefined;
    traceProjectId?: string | null | undefined;
    guardrailAttachments?: readonly GuardrailAttachment[] | undefined;
  }): Promise<VirtualKeyWithScopes> {
    const { actor, organizationId, id, scopes, guardrailAttachments } = input;
    const existing = await this.#dependencies.getExistingVirtualKey({ organizationId, id });
    await this.#dependencies.assertCanOperateOnAnyScope({
      actor,
      scopes: existing.scopes,
      permission: "virtualKeys:update",
    });

    if (scopes) {
      await this.#dependencies.assertCanManageAllScopes({ actor, scopes });
      await this.#dependencies.assertScopesBelongToOrganization({ organizationId, scopes });
    }

    if (input.traceProjectId !== undefined) {
      await this.#dependencies.assertTraceProjectBelongsToOrganization({
        organizationId,
        traceProjectId: input.traceProjectId,
      });
      if (input.traceProjectId) {
        await this.#dependencies.assertCanManageAllScopes({
          actor,
          scopes: [{ scopeType: "PROJECT", scopeId: input.traceProjectId }],
        });
      }
    }

    const attachments =
      guardrailAttachments ??
      (scopes !== undefined
        ? parseVirtualKeyConfig(existing.config).guardrailAttachments
        : undefined);
    await this.#dependencies.assertGuardrailAttachmentsAllowed({
      actor,
      organizationId,
      virtualKeyId: id,
      scopes,
      traceProjectId:
        input.traceProjectId !== undefined ? input.traceProjectId : existing.traceProjectId,
      attachments,
    });

    return existing;
  }

  /**
   * Gate for every other key mutation (rotate/revoke/disable/enable): key exists in this org,
   * caller holds the operation's permission on a scope it lives in. Deliberately NOT the
   * visibility rule — an unauthorized caller gets FORBIDDEN rather than a hidden not-found.
   */
  async authorizeVirtualKeyOperation(input: {
    actor: GatewayActor;
    organizationId: string;
    id: string;
    permission: AuthzPermission;
  }): Promise<VirtualKeyWithScopes> {
    const existing = await this.#dependencies.getExistingVirtualKey({
      organizationId: input.organizationId,
      id: input.id,
    });
    await this.#dependencies.assertCanOperateOnAnyScope({
      actor: input.actor,
      scopes: existing.scopes,
      permission: input.permission,
    });
    return existing;
  }

  /**
   * Gate for a tenant-wide write: budgets and cache rules are org-owned rows, addressed by id,
   * that a project credential can name regardless of which project they belong to — so this
   * checks at the organization, the scope the write actually acts on.
   */
  async authorizeOrganizationWideOperation(input: {
    actor: GatewayActor;
    organizationId: string;
    permission: AuthzPermission;
  }): Promise<void> {
    await this.#dependencies.assertCanOperateOnAnyScope({
      actor: input.actor,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: input.organizationId }],
      permission: input.permission,
    });
  }
}
