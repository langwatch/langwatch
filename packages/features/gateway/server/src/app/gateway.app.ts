/**
 * The gateway feature's application: what all seven of its doors call.
 *
 * It holds every service and port the feature needs, and it is the one typed
 * thing a transport is given. Before it there were SEVEN bags: six private
 * `Gateway*Application` types across the tRPC surfaces plus
 * `GatewayPlatformRestPorts` for the public REST family, each describing part
 * of the same process and none reachable from another. Two of them named the
 * same member differently (`budgets` meant the decision service on one side
 * and the ClickHouse spend source on the other), and three named the same
 * member the same way with different signatures.
 *
 * What lives here as behaviour is the virtual-key WRITE pre-flight, which both
 * doors ran for themselves. It was the same sequence in both — manage on every
 * requested scope, every scope anchored to the organization, the trace
 * destination anchored and manageable, then the guardrail attachments judged
 * against the project the key resolves to — written out thirteen times between
 * them. A rule that exists thirteen times answers differently the first time
 * one copy changes, and this one decides who may mint a credential.
 *
 * A caller arrives as an argument ({@link GatewayActor}), never read from a
 * session or a request. That is what lets one operation serve a browser
 * session and an API key without knowing which it is serving — and it is why
 * the process must supply ONE implementation of each check that accepts both
 * vocabularies, rather than the two it used to supply.
 *
 * ## The budget rows, and why they are not type parameters
 *
 * The applicable-budget list and a key's own direct budget used to be
 * `TApplicableBudgets` and `TDirectBudget`, generic with `unknown` defaults, on
 * the theory that only the composing process could name them and that a
 * process composing `GatewayApp` with its concrete shapes would get them back
 * out of every router built over it. It did not work that way. Every tRPC
 * transport declares `app: Readonly<{ gateway: GatewayApp }>` with no type
 * arguments, which under the old declaration meant `GatewayApp<unknown,
 * unknown>`, and a generic router body is checked once against its constraint
 * — so `unknown` was what the browser typed against no matter what the process
 * wired in. `VirtualKeyBudgetSection`, `VirtualKeyEditDrawer` and the
 * virtual-keys page all read fields off those rows.
 *
 * They are wire shapes, so they now live in `@langwatch/gateway-contract` as
 * {@link GatewayApplicableBudget} and {@link GatewayVirtualKeyDirectBudget},
 * where the browser and this package name the same declaration and there is
 * nothing left for a type parameter to carry.
 */
import type { IdempotentRunner } from "@langwatch/api/rest";
import type { ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  parseVirtualKeyConfig,
  type GatewayApplicableBudget,
  type GatewayService,
  type GatewayVirtualKeyDirectBudget,
  type GuardrailAttachment,
  type VirtualKeyConfig,
} from "@langwatch/gateway-contract";
import type {
  GatewayCacheRule,
  GatewayGuardrail,
  GatewayGuardrailDirection,
  GatewayGuardrailFailureMode,
} from "@langwatch/prisma-client/generated";
import type { ProjectIdentity, ProjectService } from "@langwatch/project-contract";
import type { z } from "zod";

import type {
  VirtualKeyCamelDto,
  VirtualKeySnakeDto,
} from "../adapters/gateway-virtual-key-dto.adapter";
import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import type { GatewayVirtualKeySpendPort } from "../ports/gateway-virtual-key-spend.port";
import type {
  GatewayVirtualKeyScope,
  VirtualKeyWithScopes,
} from "../ports/gateway-virtual-key.port";
import type { GatewaySpendEventsService } from "../services/gateway-spend-events.service";
import type { GatewayUsageService } from "../services/gateway-usage.service";

/**
 * The identity a write authorizes as, in whatever vocabulary the process's own
 * gateway authorization uses.
 *
 * Opaque on purpose. A caller here is a browser session, a scoped API key or a
 * legacy project key, and what any of those IS belongs to the process's
 * authentication, not to this feature. The doors hand one straight to the
 * checks below and never read it.
 */
export type GatewayActor = unknown;

/**
 * The budget a key may carry of its own, as the write service takes it.
 *
 * The canonical parser arrives as `schemas.virtualKeyBudgetInput`, so the
 * decimal regex and the positive-amount refinement are never restated here.
 */
export type GatewayVirtualKeyBudgetInput = Readonly<{
  limitUsd: string;
  window: "DAY" | "WEEK" | "MONTH";
  onBreach?: "BLOCK" | "WARN";
  name?: string;
}>;

/**
 * The virtual-key capability, read and write, as every door calls it.
 *
 * One description where there were three: the tRPC surface declared
 * `VirtualKeyWrites & VirtualKeyReads` and the REST family declared
 * `GatewayRestVirtualKeyWrites & GatewayRestVirtualKeyReads`, differing only in
 * which optional fields each remembered to mention.
 */
export type GatewayVirtualKeyOperations = Readonly<{
  getAll(organizationId: string): Promise<VirtualKeyWithScopes[]>;
  getById(id: string, organizationId: string): Promise<VirtualKeyWithScopes | null>;
  getPage(input: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Date; id: string } | null;
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
    expiresAt?: Date | null;
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
    expiresAt?: Date | null;
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

/** The guardrail administration the process builds over its own persistence. */
export type GatewayGuardrailOperations = Readonly<{
  list(projectId: string): Promise<GatewayGuardrail[]>;
  get(id: string, projectId: string): Promise<GatewayGuardrail | null>;
  create(input: {
    projectId: string;
    name: string;
    description: string | null;
    evaluatorId: string;
    direction: GatewayGuardrailDirection;
    failureMode?: GatewayGuardrailFailureMode;
    actorUserId: string;
  }): Promise<GatewayGuardrail>;
  update(input: {
    id: string;
    projectId: string;
    name?: string;
    description?: string | null;
    evaluatorId?: string;
    direction?: GatewayGuardrailDirection;
    failureMode?: GatewayGuardrailFailureMode;
    actorUserId: string;
  }): Promise<GatewayGuardrail>;
  archive(input: { id: string; projectId: string; actorUserId: string }): Promise<void>;
}>;

/** The matcher set a cache rule ANDs across, in the wire spelling it is stored in. */
export interface GatewayCacheRuleMatchers {
  vk_id?: string;
  vk_tags?: string[];
  vk_prefix?: string;
  principal_id?: string;
  model?: string;
  request_metadata?: Record<string, string>;
}

/** What a matching cache rule does. */
export interface GatewayCacheRuleAction {
  mode: "respect" | "force" | "disable";
  ttl?: number;
  salt?: string;
}

/** The cache-rule administration the process builds over its own persistence. */
export type GatewayCacheRuleOperations = Readonly<{
  list(organizationId: string): Promise<GatewayCacheRule[]>;
  get(id: string, organizationId: string): Promise<GatewayCacheRule | null>;
  create(input: {
    organizationId: string;
    name: string;
    description: string | null;
    priority?: number;
    enabled?: boolean;
    matchers: GatewayCacheRuleMatchers;
    action: GatewayCacheRuleAction;
    actorUserId: string;
  }): Promise<GatewayCacheRule>;
  update(input: {
    id: string;
    organizationId: string;
    name?: string;
    description?: string | null;
    priority?: number;
    enabled?: boolean;
    matchers?: GatewayCacheRuleMatchers;
    action?: GatewayCacheRuleAction;
    actorUserId: string;
  }): Promise<GatewayCacheRule>;
  archive(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<GatewayCacheRule>;
}>;

/** A draft or existing key, as the applicable-budget resolver takes it. */
export type GatewayApplicableBudgetTarget = Readonly<{
  organizationId: string;
  virtualKeyId: string | null;
  scopes: readonly GatewayVirtualKeyScope[];
  traceProjectId: string | null;
  principalUserId: string | null;
}>;

/**
 * What the process composes this feature's application from.
 *
 * Everything here is either a capability built over persistence this package
 * cannot reach, or a decision made against role bindings and memberships it
 * cannot see. Everything that is NOT such a decision — wire casing, cursors,
 * money formatting, the DTO projections themselves — lives in this package and
 * is imported directly rather than passed through.
 */
export interface GatewayAppDependencies {
  // ── The feature's own services and stores ────────────────────────────────

  /** The virtual-key read and write capability. */
  virtualKeys: GatewayVirtualKeyOperations;
  /** The budget-and-cache-rule decision service. */
  budgetDecisions: GatewayService;
  /**
   * The ClickHouse budget-spend source. Absent on a deployment without it,
   * which is why every read of it degrades explicitly rather than reporting a
   * confident zero.
   */
  budgetSpend: GatewayBudgetSpendPort | undefined;
  /** The ClickHouse per-key spend source. Absent likewise. */
  virtualKeySpend: GatewayVirtualKeySpendPort | undefined;
  /** The spend-event ledger reader. Absent likewise. */
  spendEvents: GatewaySpendEventsService | undefined;
  /** Project reads: organization resolution and trace-destination facts. */
  projects: ProjectService;
  /** Guardrail administration. */
  guardrails: GatewayGuardrailOperations;
  /** Cache-rule administration. */
  cacheRules: GatewayCacheRuleOperations;
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
   * The identity a REST credential authorizes as, plus the id audit rows
   * record. A scoped API key acts as its owning user; a legacy project key
   * carries none and acts as a stable synthetic machine principal for its
   * project, which keeps an audit entry traceable back to the credential.
   */
  actorForCredential(input: {
    projectId: string;
    resolvedToken: ResolvedApiKeyToken | undefined;
  }): { actor: GatewayActor; actorUserId: string };

  // ── Visibility ───────────────────────────────────────────────────────────

  /**
   * The organization's keys, narrowed to the ones this USER can see.
   *
   * Visibility is membership-based, not permission-based: a caller sees a key
   * when one of its scopes intersects their membership set. A non-member sees
   * no keys, so a summary comes back empty rather than refused.
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
   * One key for a by-id READ under the list's visibility rule: a key outside
   * the caller's membership set is indistinguishable from one that does not
   * exist. Mutations deliberately do NOT use this — their contract is
   * permission-based, so a scope role-binding holder can operate without being
   * a member and an unauthorized caller gets FORBIDDEN.
   */
  requireVisibleVirtualKeyForUser(input: {
    organizationId: string;
    id: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes>;
  /**
   * The keys on a page a PROJECT CREDENTIAL may see: it stands in for someone
   * working in its project, so it sees organization-scoped keys, its own
   * team's keys and its own project's keys — and not a sibling team's. Applied
   * to the page rather than to the query, which is why a page can be shorter
   * than `limit` without meaning the walk is done.
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
  resolveApplicableBudgets(input: {
    target: GatewayApplicableBudgetTarget;
  }): Promise<GatewayApplicableBudget[]>;
  /** The budget each named key carries of its own, with this period's spend. */
  loadDirectBudgetsForKeys(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    now: Date;
  }): Promise<Map<string, GatewayVirtualKeyDirectBudget>>;
  /**
   * Spend and request count per key over a window, from the cost path — the
   * same source the dashboard's key list and the Usage tab read, so the number
   * in a table, the API and the Usage page agree by construction.
   */
  spendByVirtualKey(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    window: { fromDate: Date; toDate: Date };
  }): Promise<Map<string, { spentUsd: string; requests: number }>>;
}

export class GatewayApp {
  static create(dependencies: GatewayAppDependencies): GatewayApp {
    return new GatewayApp(dependencies);
  }

  private constructor(private readonly dependencies: GatewayAppDependencies) {}

  // ── The services and stores, as the doors reach them ─────────────────────

  get virtualKeys(): GatewayVirtualKeyOperations {
    return this.dependencies.virtualKeys;
  }

  get budgetDecisions(): GatewayService {
    return this.dependencies.budgetDecisions;
  }

  get budgetSpend(): GatewayBudgetSpendPort | undefined {
    return this.dependencies.budgetSpend;
  }

  get virtualKeySpend(): GatewayVirtualKeySpendPort | undefined {
    return this.dependencies.virtualKeySpend;
  }

  get spendEvents(): GatewaySpendEventsService | undefined {
    return this.dependencies.spendEvents;
  }

  get projects(): ProjectService {
    return this.dependencies.projects;
  }

  get guardrails(): GatewayGuardrailOperations {
    return this.dependencies.guardrails;
  }

  get cacheRules(): GatewayCacheRuleOperations {
    return this.dependencies.cacheRules;
  }

  get usage(): GatewayUsageService {
    return this.dependencies.usage;
  }

  get idempotency(): IdempotentRunner {
    return this.dependencies.idempotency;
  }

  get spendSourceAvailable(): boolean {
    return this.dependencies.spendSourceAvailable;
  }

  get schemas(): Readonly<{ virtualKeyBudgetInput: z.ZodType<GatewayVirtualKeyBudgetInput> }> {
    return this.dependencies.schemas;
  }

  // ── Tenancy anchors and directory reads ──────────────────────────────────

  organizationIdForProject(projectId: string): Promise<string> {
    return this.dependencies.organizationIdForProject(projectId);
  }

  assertOrganizationExists(organizationId: string): Promise<void> {
    return this.dependencies.assertOrganizationExists(organizationId);
  }

  resolveProviderLabels(
    budgets: ReadonlyArray<{ providerKey: string | null }>,
  ): Promise<Map<string, string>> {
    return this.dependencies.resolveProviderLabels(budgets);
  }

  listGroupTargets(
    organizationId: string,
  ): Promise<ReadonlyArray<{ id: string; name: string; memberCount: number }>> {
    return this.dependencies.listGroupTargets(organizationId);
  }

  groupMemberCounts(
    budgets: readonly { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, number>> {
    return this.dependencies.groupMemberCounts(budgets);
  }

  resolveVirtualKeyNames(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
  }): Promise<ReadonlyArray<{ id: string; name: string }>> {
    return this.dependencies.resolveVirtualKeyNames(input);
  }

  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean> {
    return this.dependencies.isOrganizationMember(input);
  }

  actorForCredential(input: {
    projectId: string;
    resolvedToken: ResolvedApiKeyToken | undefined;
  }): { actor: GatewayActor; actorUserId: string } {
    return this.dependencies.actorForCredential(input);
  }

  // ── Visibility ───────────────────────────────────────────────────────────

  listVisibleVirtualKeys(input: {
    organizationId: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes[]> {
    return this.dependencies.listVisibleVirtualKeys(input);
  }

  isVirtualKeyVisible(input: {
    organizationId: string;
    userId: string;
    virtualKey: VirtualKeyWithScopes;
  }): Promise<boolean> {
    return this.dependencies.isVirtualKeyVisible(input);
  }

  requireVisibleVirtualKeyForUser(input: {
    organizationId: string;
    id: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.dependencies.requireVisibleVirtualKeyForUser(input);
  }

  visibleToProjectCredential(input: {
    project: ProjectIdentity;
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): VirtualKeyWithScopes[] {
    return this.dependencies.visibleToProjectCredential(input);
  }

  requireVisibleVirtualKeyForProjectCredential(input: {
    project: ProjectIdentity;
    id: string;
    organizationId: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.dependencies.requireVisibleVirtualKeyForProjectCredential(input);
  }

  requireExistingVirtualKey(input: {
    organizationId: string;
    id: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.dependencies.requireExistingVirtualKey(input);
  }

  // ── Projections and spend ────────────────────────────────────────────────

  toVirtualKeyCamelDtos(input: {
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): Promise<VirtualKeyCamelDto[]> {
    return this.dependencies.toVirtualKeyCamelDtos(input);
  }

  toVirtualKeySnakeDtos(input: {
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): Promise<VirtualKeySnakeDto[]> {
    return this.dependencies.toVirtualKeySnakeDtos(input);
  }

  /**
   * One key projected through the same batched read a listing uses.
   *
   * A page of one, not a second projection: the destination fact a key
   * publishes is a fact about the PROJECT row rather than the key row, so a
   * per-key path would be the one place a deleted destination could still read
   * as live. Both doors had a private copy of this; there is now one per
   * casing.
   */
  async toVirtualKeyCamelDto(virtualKey: VirtualKeyWithScopes): Promise<VirtualKeyCamelDto> {
    const [dto] = await this.dependencies.toVirtualKeyCamelDtos({ virtualKeys: [virtualKey] });
    if (!dto) throw new Error("the virtual key projection returned no row");
    return dto;
  }

  /** One key projected into the published snake_case shape. */
  async toVirtualKeySnakeDto(virtualKey: VirtualKeyWithScopes): Promise<VirtualKeySnakeDto> {
    const [dto] = await this.dependencies.toVirtualKeySnakeDtos({ virtualKeys: [virtualKey] });
    if (!dto) throw new Error("the virtual key projection returned no row");
    return dto;
  }

  resolveApplicableBudgets(input: {
    target: GatewayApplicableBudgetTarget;
  }): Promise<GatewayApplicableBudget[]> {
    return this.dependencies.resolveApplicableBudgets(input);
  }

  loadDirectBudgetsForKeys(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    now: Date;
  }): Promise<Map<string, GatewayVirtualKeyDirectBudget>> {
    return this.dependencies.loadDirectBudgetsForKeys(input);
  }

  spendByVirtualKey(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    window: { fromDate: Date; toDate: Date };
  }): Promise<Map<string, { spentUsd: string; requests: number }>> {
    return this.dependencies.spendByVirtualKey(input);
  }

  // ── The virtual-key write pre-flights ────────────────────────────────────

  /**
   * The scope set and trace destination a caller has chosen are theirs to
   * choose: manage on every requested scope, every scope anchored to this
   * organization, the destination anchored to it too, and manage on the
   * destination project.
   *
   * That last one is not tenancy. The destination routes traces AND budget
   * debits into that project, so choosing it needs the same grant the old
   * PROJECT scope enforced; tenancy alone would let a team manager point a key
   * at a sibling team's project and consume its budget.
   *
   * Separate from {@link authorizeVirtualKeyCreate} because previewing a
   * draft's applicable budgets runs exactly this and no more: it reads budget
   * names, limits and live spend, so it must not be cheaper than creating a key
   * against the same target, but there is no key config to judge yet.
   */
  async authorizeVirtualKeyScopeSelection(input: {
    actor: GatewayActor;
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
    traceProjectId: string | null | undefined;
  }): Promise<void> {
    const { actor, organizationId, scopes, traceProjectId } = input;
    await this.dependencies.assertCanManageAllScopes({ actor, scopes });
    await this.dependencies.assertScopesBelongToOrganization({ organizationId, scopes });
    await this.dependencies.assertTraceProjectBelongsToOrganization({
      organizationId,
      traceProjectId,
    });
    if (traceProjectId) {
      await this.dependencies.assertCanManageAllScopes({
        actor,
        scopes: [{ scopeType: "PROJECT", scopeId: traceProjectId }],
      });
    }
  }

  /**
   * Everything that must hold before a key is minted, in the order it must
   * hold in: the scope selection above, then the guardrail attachments judged
   * against the project the key will resolve to.
   *
   * Read-only, and deliberately not folded into the mint. The public create
   * dispatches the mint through an idempotency receipt, and a replay that
   * skipped this would trust a grant the caller held yesterday.
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
    const projectId = await this.dependencies.resolveVirtualKeyProjectId({
      organizationId,
      virtualKeyId: null,
      scopes,
      traceProjectId: traceProjectId ?? null,
    });
    await this.dependencies.assertGuardrailAttachmentsAllowed({
      actor,
      projectId,
      attachments: guardrailAttachments,
    });
  }

  /**
   * Everything that must hold before an existing key is edited, and the key it
   * read, so the caller does not read it twice.
   *
   * Mutating a key needs `virtualKeys:update` on a scope it ALREADY lives in.
   * Re-scoping additionally needs manage on every NEW scope, so a key cannot be
   * moved into a scope the caller does not control, and re-pointing the
   * destination is the same decision as choosing it at create.
   *
   * `scopes` and `traceProjectId` absent mean "not changing", which is what
   * makes the last rule work: newly-submitted attachments are always validated;
   * a scope change without re-sent config revalidates the STORED attachments
   * against the new project, so a stale cross-project attachment cannot survive
   * the move; and a plain metadata edit re-touches nothing, so renaming a key
   * does not demand `gatewayGuardrails:attach`.
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
    const existing = await this.dependencies.requireExistingVirtualKey({ organizationId, id });
    await this.dependencies.assertCanOperateOnAnyScope({
      actor,
      scopes: existing.scopes,
      permission: "virtualKeys:update",
    });

    if (scopes) {
      await this.dependencies.assertCanManageAllScopes({ actor, scopes });
      await this.dependencies.assertScopesBelongToOrganization({ organizationId, scopes });
    }

    if (input.traceProjectId !== undefined) {
      await this.dependencies.assertTraceProjectBelongsToOrganization({
        organizationId,
        traceProjectId: input.traceProjectId,
      });
      if (input.traceProjectId) {
        await this.dependencies.assertCanManageAllScopes({
          actor,
          scopes: [{ scopeType: "PROJECT", scopeId: input.traceProjectId }],
        });
      }
    }

    const projectId = await this.dependencies.resolveVirtualKeyProjectId({
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
    await this.dependencies.assertGuardrailAttachmentsAllowed({ actor, projectId, attachments });

    return existing;
  }

  /**
   * The gate every other key mutation runs — rotate, revoke, disable, enable:
   * the key exists in this organization, and the caller holds the operation's
   * permission on at least one scope it lives in. Answers with the key it read.
   *
   * Deliberately NOT the visibility rule: a scope role-binding holder can
   * operate on a key without being a member of anything, and an unauthorized
   * caller gets FORBIDDEN rather than a not-found that would hide the refusal.
   */
  async authorizeVirtualKeyOperation(input: {
    actor: GatewayActor;
    organizationId: string;
    id: string;
    permission: AuthzPermission;
  }): Promise<VirtualKeyWithScopes> {
    const existing = await this.dependencies.requireExistingVirtualKey({
      organizationId: input.organizationId,
      id: input.id,
    });
    await this.dependencies.assertCanOperateOnAnyScope({
      actor: input.actor,
      scopes: existing.scopes,
      permission: input.permission,
    });
    return existing;
  }
}
