/**
 * The gateway feature's application: the one typed thing every door is given, replacing seven previously-separate bags (six private Gateway*Application types plus GatewayPlatformRestMembers) that named the same members differently or with different signatures. Virtual-key WRITE pre-flight, run identically by every door, lives here as behaviour rather than duplicated thirteen times. A caller arrives as {@link GatewayActor}, an argument rather than read from session/request, so one check serves both a browser session and an API key. Budget row shapes moved to @langwatch/gateway-contract ({@link GatewayApplicableBudget}, {@link GatewayVirtualKeyDirectBudget}) since a generic type parameter never actually reached the browser — every tRPC transport declared `app` with no type arguments, so it always typed against `unknown`.
 */
import { toDate, type Instant } from "@langwatch/time";
import type {
  GatewayRequestCredential,
  GatewayVirtualKeyScope,
  VirtualKeyWithScopes,
} from "@langwatch/gateway-contract";
import type { IdempotentRunner } from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
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
  type GatewayBudgetResolutionTarget,
  type GatewayElevenLabsWebhookAnswer,
  type GatewayVirtualKeyDirectBudget,
  type GuardrailAttachment,
  type VirtualKeyConfig,
  type ResetGatewayBudgetInput,
  type UpdateGatewayBudgetInput,
  type UpdateGatewayCacheRuleInput,
  type UpdateGatewayGuardrailInput,
} from "@langwatch/gateway-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { GatewayService } from "../services/gateway.service.ts";
import type { ProjectIdentity, ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { z } from "zod";

import type {
  VirtualKeyCamelDto,
  VirtualKeySnakeDto,
} from "../adapters/gateway-virtual-key-dto.adapter.ts";
import type { GatewayBudgetSpend } from "./gateway.infrastructure.ts";
import type { GatewayVirtualKeySpend } from "./gateway.infrastructure.ts";

import type { GatewaySpendEventsService } from "../services/gateway-spend-events.service.ts";
import {
  GatewayAgentCacheService,
  type GatewayAgentCacheEncryption,
} from "../services/gateway-agent-cache.service.ts";
import type { GatewayUsageService, UsageWindow } from "../services/gateway-usage.service.ts";
import type { GatewayAgentCacheEntryStore } from "../stores/gateway-agent-cache/gateway-agent-cache.store.ts";
import {
  GatewayElevenLabsWebhookService,
  type ElevenLabsWebhookCollaborators,
} from "../services/gateway-elevenlabs-webhook.service.ts";

/**
 * Identity a write authorizes as, opaque on purpose: a caller may be a browser session, scoped API key or legacy project key, and what any of those IS belongs to the process's authentication, not this feature — the doors hand one straight to the checks below and never read it.
 */
export type GatewayActor = unknown;

/**
 * A key's own budget, as the write service takes it. The canonical parser is schemas.virtualKeyBudgetInput, so the decimal regex and positive-amount refinement are never restated here.
 */
export type GatewayVirtualKeyBudgetInput = Readonly<{
  limitUsd: string;
  window: "DAY" | "WEEK" | "MONTH";
  onBreach?: "BLOCK" | "WARN";
  name?: string;
}>;

/**
 * Virtual-key read/write capability, as every door calls it — one description where there were three (tRPC's VirtualKeyWrites & VirtualKeyReads, REST's GatewayRestVirtualKeyWrites & GatewayRestVirtualKeyReads), which differed only in which optional fields each remembered to mention.
 */
export type GatewayVirtualKeyOperations = Readonly<{
  getAll(organizationId: string): Promise<VirtualKeyWithScopes[]>;
  tryGetById(id: string, organizationId: string): Promise<VirtualKeyWithScopes | null>;
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
 * What the process composes this application from: capabilities built over persistence this package cannot reach, or decisions made against role bindings/memberships it cannot see. Everything that is NOT such a decision (wire casing, cursors, money formatting, DTO projections) lives in this package directly instead.
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
   * The one canonical Gateway service: budget decisions plus the cache-rule and guardrail catalogues it owns. The process used to build the latter two a second time over its own copies of the same tables, so a rule written through one was invisible to the other.
   */
  budgetDecisions: GatewayService;
  /**
   * The ClickHouse budget-spend source. Absent on a deployment without it,
   * which is why every read of it degrades explicitly rather than reporting a
   * confident zero.
   */
  budgetSpend: GatewayBudgetSpend | undefined;
  /** The ClickHouse per-key spend source. Absent likewise. */
  virtualKeySpend: GatewayVirtualKeySpend | undefined;
  /** The spend-event ledger reader. Absent likewise. */
  spendEvents: GatewaySpendEventsService | undefined;
  /** Project reads: organization resolution and trace-destination facts. */
  projects: ProjectApi;
  /** The usage reader, already bound to the spend sources above. */
  usage: GatewayUsageService;
  /**
   * The receipt ledger the public creates dispatch through, already bound to
   * the process's store. A feature cannot hold one of its own: a receipt is an
   * encrypted row in the application's database.
   */
  idempotency: IdempotentRunner;
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
    budgets: ReadonlyArray<{ providerKey: string | null }>,
  ): Promise<Map<string, string>>;
  /** The groups a per-member budget can target, with their sizes. */
  listGroupTargets(
    organizationId: string,
  ): Promise<ReadonlyArray<{ id: string; name: string; memberCount: number }>>;
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
  }): Promise<ReadonlyArray<{ id: string; name: string }>>;
  /** Whether a user belongs to this organization. */
  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean>;
  /**
   * Identity a REST credential authorizes as, plus the audit-row id: a scoped API key acts as its owning user; a legacy project key carries none and acts as a stable synthetic machine principal for its project, keeping audit entries traceable back to the credential.
   */
  actorForCredential(input: { projectId: string; credential: GatewayRequestCredential }): {
    actor: GatewayActor;
    actorUserId: string;
  };

  // ── Visibility ───────────────────────────────────────────────────────────

  /**
   * Org keys narrowed to what this USER can see. Visibility is membership-based, not permission-based: a caller sees a key when one of its scopes intersects their membership set, so a non-member gets an empty summary rather than a refusal.
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
   * One key for a by-id READ under the list's visibility rule: a key outside the caller's membership set is indistinguishable from nonexistent. Mutations deliberately don't use this — their contract is permission-based, so an unauthorized caller gets FORBIDDEN instead.
   */
  requireVisibleVirtualKeyForUser(input: {
    organizationId: string;
    id: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes>;
  /**
   * Keys a PROJECT CREDENTIAL may see on a page: org-scoped keys, its own team's, its own project's — never a sibling team's. Applied to the page, not the query, which is why a page can be shorter than `limit` without the walk being done.
   */
  visibleToProjectCredential(input: {
    project: ProjectIdentity;
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): VirtualKeyWithScopes[];
  /** One key under that same credential visibility rule, or the not-found refusal. */
  requireVisibleVirtualKeyForProjectCredential(input: {
    project: ProjectIdentity;
    id: string;
    organizationId: string;
  }): Promise<VirtualKeyWithScopes>;
  /** One key anchored to this organization, without any visibility rule. */
  requireExistingVirtualKey(input: {
    organizationId: string;
    id: string;
  }): Promise<VirtualKeyWithScopes>;

  // ── The checks ───────────────────────────────────────────────────────────

  /** `virtualKeys:manage` on EVERY named scope, fail-closed. */
  assertCanManageAllScopes(input: {
    actor: GatewayActor;
    scopes: readonly GatewayVirtualKeyScope[];
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
  /** Refuses a guardrail attachment the caller may not make in this project. */
  assertGuardrailAttachmentsAllowed(input: {
    actor: GatewayActor;
    projectId: string | null;
    attachments: readonly GuardrailAttachment[] | undefined;
  }): Promise<void>;
  /** The project a key's guardrail attachments are judged against. */
  resolveVirtualKeyProjectId(input: {
    organizationId: string;
    virtualKeyId: string | null;
    scopes: readonly GatewayVirtualKeyScope[] | undefined;
    traceProjectId: string | null;
  }): Promise<string | null>;

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
type GatewaySetup = FeatureSetup<Record<never, never>, GatewayInfrastructure, undefined>;

export class GatewayApp implements GatewayApi {
  static readonly contract = GatewayApiToken;
  static readonly dependencies = {};

  static create(setup: GatewaySetup): GatewayApp {
    return new GatewayApp(setup.infrastructure);
  }

  #coreDependencies: GatewayAppDependencies | undefined;
  #agentCache: GatewayAgentCacheService | undefined;
  #elevenLabsWebhook: GatewayElevenLabsWebhookService | undefined;

  private constructor(infrastructure: GatewayInfrastructure) {
    this.#coreDependencies = "virtualKeys" in infrastructure ? infrastructure : void 0;
    this.#agentCache = infrastructure.agentCache
      ? GatewayAgentCacheService.create(infrastructure.agentCache)
      : void 0;
    this.#elevenLabsWebhook = infrastructure.elevenLabsWebhook
      ? GatewayElevenLabsWebhookService.create(infrastructure.elevenLabsWebhook)
      : void 0;
  }

  getAgentCacheEntry(input: { projectId: string; name: string }) {
    return this.#agentCacheService().get(input);
  }

  putAgentCacheEntry(input: GatewayAgentCacheWriteInput) {
    return this.#agentCacheService().put(input);
  }

  claimAgentCacheEntry(input: GatewayAgentCacheWriteInput) {
    return this.#agentCacheService().claim(input);
  }

  deleteAgentCacheEntry(input: { projectId: string; name: string }) {
    return this.#agentCacheService().delete(input);
  }

  receiveElevenLabsWebhook(input: {
    modelProviderId: string;
    rawBody: string;
    signature: string | undefined;
  }): Promise<GatewayElevenLabsWebhookAnswer> {
    const service = this.#elevenLabsWebhook;
    if (!service) throw new Error("The ElevenLabs family was mounted without its infrastructure");

    return service.receive(input);
  }

  #agentCacheService(): GatewayAgentCacheService {
    const service = this.#agentCache;
    if (!service) throw new Error("The agent-cache family was mounted without its infrastructure");

    return service;
  }

  get #dependencies(): GatewayAppDependencies {
    const dependencies = this.#coreDependencies;
    if (!dependencies) throw new Error("The gateway control plane was not installed");

    return dependencies;
  }

  listBudgetsWithHealth(organizationId: string) {
    return this.#dependencies.budgetDecisions.listWithHealth(organizationId);
  }

  listBudgetPageWithHealth(input: GatewayBudgetPageInput) {
    return this.#dependencies.budgetDecisions.listPageWithHealth(input);
  }

  tryGetBudgetWithHealth(input: { id: string; organizationId: string }) {
    return this.#dependencies.budgetDecisions.tryGetWithHealth(input);
  }

  budgetScopeReach(input: GatewayBudgetScopeReachInput) {
    return this.#dependencies.budgetDecisions.scopeReach(input);
  }

  listCacheRulePage(input: GatewayCacheRulePageInput) {
    return this.#dependencies.budgetDecisions.cacheRuleListPage(input);
  }

  listProjectBudgetsWithHealth(projectId: string) {
    return this.#dependencies.budgetDecisions.listForProjectWithHealth(projectId);
  }

  listBudgetScopeTargets(
    budgets: Array<{ scopeType: string; scopeId: string }>,
    organizationId: string | null,
  ) {
    return this.#dependencies.budgetDecisions.resolveScopeTargets(budgets, organizationId);
  }

  findBudgetDetail(input: { id: string; organizationId: string }) {
    return this.#dependencies.budgetDecisions.tryGetDetail(input);
  }

  createBudget(input: CreateGatewayBudgetInput) {
    return this.#dependencies.budgetDecisions.create(input);
  }

  updateBudget(input: UpdateGatewayBudgetInput) {
    return this.#dependencies.budgetDecisions.update(input);
  }

  archiveBudget(input: ArchiveGatewayBudgetInput) {
    return this.#dependencies.budgetDecisions.archive(input);
  }

  resetBudget(input: ResetGatewayBudgetInput) {
    return this.#dependencies.budgetDecisions.reset(input);
  }

  listGuardrails(projectId: string) {
    return this.#dependencies.budgetDecisions.guardrailList(projectId);
  }

  findGuardrail(input: { id: string; projectId: string }) {
    return this.#dependencies.budgetDecisions.tryGuardrailGet(input);
  }

  createGuardrail(input: CreateGatewayGuardrailInput) {
    return this.#dependencies.budgetDecisions.guardrailCreate(input);
  }

  updateGuardrail(input: UpdateGatewayGuardrailInput) {
    return this.#dependencies.budgetDecisions.guardrailUpdate(input);
  }

  archiveGuardrail(input: ArchiveGatewayGuardrailInput) {
    return this.#dependencies.budgetDecisions.guardrailArchive(input);
  }

  listCacheRules(organizationId: string) {
    return this.#dependencies.budgetDecisions.cacheRuleList(organizationId);
  }

  findCacheRule(input: { id: string; organizationId: string }) {
    return this.#dependencies.budgetDecisions.tryCacheRuleGet(input);
  }

  createCacheRule(input: CreateGatewayCacheRuleInput) {
    return this.#dependencies.budgetDecisions.cacheRuleCreate(input);
  }

  updateCacheRule(input: UpdateGatewayCacheRuleInput) {
    return this.#dependencies.budgetDecisions.cacheRuleUpdate(input);
  }

  archiveCacheRule(input: ArchiveGatewayCacheRuleInput) {
    return this.#dependencies.budgetDecisions.cacheRuleArchive(input);
  }

  async findProjectOrganization(projectId: string): Promise<string | null> {
    // The directory answers `undefined` for a project it does not hold; the
    // gateway's own vocabulary for "no such row" is null throughout.
    return (await this.#dependencies.projects.tryGetOrganizationId(projectId)) ?? null;
  }

  usageSummary(input: { organizationId: string; virtualKeyIds: string[]; window: UsageWindow }) {
    return this.#dependencies.usage.summary(input);
  }

  usageSummaryForVirtualKey(input: {
    organizationId: string;
    virtualKeyId: string;
    window: UsageWindow;
    model?: string;
  }) {
    return this.#dependencies.usage.summaryForVirtualKey(input);
  }

  async findSpendEventsPage(
    input: Parameters<GatewayApi["findSpendEventsPage"]>[0],
  ): ReturnType<GatewayApi["findSpendEventsPage"]> {
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

  findVirtualKeyById(id: string, organizationId: string) {
    return this.#dependencies.virtualKeys.tryGetById(id, organizationId);
  }

  createVirtualKey(input: GatewayVirtualKeyCreateInput) {
    return this.#dependencies.virtualKeys.create(input);
  }

  updateVirtualKey(input: GatewayVirtualKeyUpdateInput) {
    return this.#dependencies.virtualKeys.update(input);
  }

  rotateVirtualKey(input: GatewayVirtualKeyRotateInput) {
    return this.#dependencies.virtualKeys.rotate(input);
  }

  revokeVirtualKey(input: GatewayVirtualKeyRevokeInput) {
    return this.#dependencies.virtualKeys.revoke(input);
  }

  disableVirtualKey(input: GatewayVirtualKeyDisableInput) {
    return this.#dependencies.virtualKeys.disable(input);
  }

  enableVirtualKey(input: GatewayVirtualKeyEnableInput) {
    return this.#dependencies.virtualKeys.enable(input);
  }

  getVirtualKeySpendService(): GatewayVirtualKeySpend | undefined {
    return this.#dependencies.virtualKeySpend;
  }

  isSpendSourceAvailable(): boolean {
    return this.#dependencies.spendSourceAvailable;
  }

  parseVirtualKeyBudget(input: unknown) {
    return this.#dependencies.schemas.virtualKeyBudgetInput.safeParse(input);
  }

  getVirtualKeyPage(
    input: GatewayVirtualKeyOperations extends {
      getPage(input: infer Input): unknown;
    }
      ? Input
      : never,
  ) {
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
    budgets: ReadonlyArray<{ providerKey: string | null }>,
  ): Promise<Map<string, string>> {
    return this.#dependencies.resolveProviderLabels(budgets);
  }

  listGroupTargets(
    organizationId: string,
  ): Promise<ReadonlyArray<{ id: string; name: string; memberCount: number }>> {
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
  }): Promise<ReadonlyArray<{ id: string; name: string }>> {
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

  requireVisibleVirtualKeyForUser(input: {
    organizationId: string;
    id: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.#dependencies.requireVisibleVirtualKeyForUser(input);
  }

  visibleToProjectCredential(input: {
    project: ProjectIdentity;
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): VirtualKeyWithScopes[] {
    return this.#dependencies.visibleToProjectCredential(input);
  }

  requireVisibleVirtualKeyForProjectCredential(input: {
    project: ProjectIdentity;
    id: string;
    organizationId: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.#dependencies.requireVisibleVirtualKeyForProjectCredential(input);
  }

  requireExistingVirtualKey(input: {
    organizationId: string;
    id: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.#dependencies.requireExistingVirtualKey(input);
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
   * One key projected through the batched read a listing uses — a page of one, not a second projection, since a key's destination fact belongs to the PROJECT row, and a per-key path would be the one place a deleted destination could still read as live.
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

  resolveApplicableBudgets(input: GatewayBudgetResolutionTarget) {
    return this.#dependencies.budgetDecisions.resolveApplicableBudgets(input);
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
   * Scope set + trace destination are the caller's to choose: manage on every requested scope, each anchored to this org, the destination anchored too, and manage on the destination project — NOT mere tenancy, since the destination also routes budget debits, and tenancy alone would let a team manager point a key at a sibling team's project and consume its budget. Separate from authorizeVirtualKeyCreate because previewing a draft's budgets needs exactly this and no more, with no key config yet to judge.
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
   * Everything that must hold before a key is minted, in order: scope selection, then guardrail attachments against the resolved project. Read-only, not folded into the mint — the public create dispatches the mint through an idempotency receipt, and a replay skipping this would trust a grant the caller held only yesterday.
   */
  async authorizeVirtualKeyCreate(input: {
    actor: GatewayActor;
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
    traceProjectId: string | null | undefined;
    guardrailAttachments: readonly GuardrailAttachment[] | undefined;
  }): Promise<void> {
    const { actor, organizationId, scopes, traceProjectId, guardrailAttachments } = input;
    await this.authorizeVirtualKeyScopeSelection({
      actor,
      organizationId,
      scopes,
      traceProjectId,
    });
    const projectId = await this.#dependencies.resolveVirtualKeyProjectId({
      organizationId,
      virtualKeyId: null,
      scopes,
      traceProjectId: traceProjectId ?? null,
    });
    await this.#dependencies.assertGuardrailAttachmentsAllowed({
      actor,
      projectId,
      attachments: guardrailAttachments,
    });
  }

  /**
   * Everything that must hold before editing an existing key, plus the key already read (so the caller doesn't re-read it). Mutating needs update on a scope the key ALREADY lives in; re-scoping additionally needs manage on every NEW scope. scopes/traceProjectId absent means "not changing": a scope change without re-sent config still revalidates STORED attachments against the new project, so a stale cross-project attachment can't survive the move, and a plain metadata edit demands no guardrail permission.
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
    const existing = await this.#dependencies.requireExistingVirtualKey({ organizationId, id });
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

    const projectId = await this.#dependencies.resolveVirtualKeyProjectId({
      organizationId,
      virtualKeyId: id,
      scopes,
      traceProjectId:
        input.traceProjectId !== undefined ? input.traceProjectId : existing.traceProjectId,
    });
    const attachments =
      guardrailAttachments ??
      (scopes !== undefined
        ? parseVirtualKeyConfig(existing.config).guardrailAttachments
        : undefined);
    await this.#dependencies.assertGuardrailAttachmentsAllowed({ actor, projectId, attachments });

    return existing;
  }

  /**
   * Gate for every other key mutation (rotate/revoke/disable/enable): key exists in this org, caller holds the operation's permission on a scope it lives in. Deliberately NOT the visibility rule — an unauthorized caller gets FORBIDDEN rather than a not-found that would hide the refusal.
   */
  async authorizeVirtualKeyOperation(input: {
    actor: GatewayActor;
    organizationId: string;
    id: string;
    permission: AuthzPermission;
  }): Promise<VirtualKeyWithScopes> {
    const existing = await this.#dependencies.requireExistingVirtualKey({
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
   * Gate for a tenant-wide write: budgets and cache rules are org-owned rows, addressed by id, that a project credential can name regardless of which project they belong to — so this checks at the organization, the scope the write actually acts on.
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
