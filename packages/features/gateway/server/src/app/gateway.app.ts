/**
 * The gateway feature's application: the one typed thing every door is given, replacing seven previously-separate bags (six private Gateway*Application types plus GatewayPlatformRestPorts) that named the same members differently or with different signatures. Virtual-key WRITE pre-flight, run identically by every door, lives here as behaviour rather than duplicated thirteen times. A caller arrives as {@link GatewayActor}, an argument rather than read from session/request, so one check serves both a browser session and an API key. Budget row shapes moved to @langwatch/gateway-contract ({@link GatewayApplicableBudget}, {@link GatewayVirtualKeyDirectBudget}) since a generic type parameter never actually reached the browser — every tRPC transport declared `app` with no type arguments, so it always typed against `unknown`.
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
export interface GatewayAppDependencies {
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
  budgetSpend: GatewayBudgetSpendPort | undefined;
  /** The ClickHouse per-key spend source. Absent likewise. */
  virtualKeySpend: GatewayVirtualKeySpendPort | undefined;
  /** The spend-event ledger reader. Absent likewise. */
  spendEvents: GatewaySpendEventsService | undefined;
  /** Project reads: organization resolution and trace-destination facts. */
  projects: ProjectService;
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
  actorForCredential(input: {
    projectId: string;
    resolvedToken: ResolvedApiKeyToken | undefined;
  }): { actor: GatewayActor; actorUserId: string };

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
   * One key projected through the batched read a listing uses — a page of one, not a second projection, since a key's destination fact belongs to the PROJECT row, and a per-key path would be the one place a deleted destination could still read as live.
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
   * Scope set + trace destination are the caller's to choose: manage on every requested scope, each anchored to this org, the destination anchored too, and manage on the destination project — NOT mere tenancy, since the destination also routes budget debits, and tenancy alone would let a team manager point a key at a sibling team's project and consume its budget. Separate from authorizeVirtualKeyCreate because previewing a draft's budgets needs exactly this and no more, with no key config yet to judge.
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
   * Gate for every other key mutation (rotate/revoke/disable/enable): key exists in this org, caller holds the operation's permission on a scope it lives in. Deliberately NOT the visibility rule — an unauthorized caller gets FORBIDDEN rather than a not-found that would hide the refusal.
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

  /**
   * Gate for a tenant-wide write: budgets and cache rules are org-owned rows, addressed by id, that a project credential can name regardless of which project they belong to — so this checks at the organization, the scope the write actually acts on.
   */
  async authorizeOrganizationWideOperation(input: {
    actor: GatewayActor;
    organizationId: string;
    permission: AuthzPermission;
  }): Promise<void> {
    await this.dependencies.assertCanOperateOnAnyScope({
      actor: input.actor,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: input.organizationId }],
      permission: input.permission,
    });
  }
}
