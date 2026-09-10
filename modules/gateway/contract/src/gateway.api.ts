/**
 * The AI Gateway's portable capability: the operations a process's own doors
 * call, and the one budget-resolution read the spend graph makes into this
 * module. It replaces the abstract `GatewayService` the contract used to
 * carry - an interface plus its token, never a class to inherit from.
 */
import { moduleApi } from "@langwatch/runtime-composition";
import type { Instant } from "@langwatch/time";

import type {
  ArchiveGatewayBudgetInput,
  CreateGatewayBudgetInput,
  GatewayBudgetDetail,
  GatewayBudgetListWithHealth,
  GatewayBudgetResolutionTarget,
  GatewayBudgetResource,
  GatewayBudgetScopeTarget,
  GatewayResolvedBudget,
  ResetGatewayBudgetInput,
  UpdateGatewayBudgetInput,
} from "./gateway.budget.ts";
import type {
  ArchiveGatewayCacheRuleInput,
  CreateGatewayCacheRuleInput,
  GatewayCacheRuleResource,
  UpdateGatewayCacheRuleInput,
} from "./gateway-cache-rule.ts";
import type { GatewayVirtualKeyRecord, GatewayVirtualKeyScope } from "./gateway.rows.ts";
import type { VirtualKeyBudgetInput } from "./virtual-key.schemas.ts";
import type { VirtualKeyConfig } from "./virtual-key-config.ts";
import type {
  GatewaySpendEventPage,
  GatewayUsageSummary,
  GatewayVirtualKeyUsageSummary,
  VirtualKeyCamelDtoResponse,
} from "./gateway.responses.ts";
import type { SpendFilters } from "./gateway-spend.schemas.ts";
import type { GatewayApplicableBudget, GatewayVirtualKeyDirectBudget } from "./gateway.budget.ts";
import type {
  ArchiveGatewayGuardrailInput,
  CreateGatewayGuardrailInput,
  GatewayGuardrailResource,
  UpdateGatewayGuardrailInput,
} from "./gateway-guardrail.ts";
import type { GatewayBudgetHealth, GatewayBudgetScopeReachResult } from "./gateway.budget.ts";
import type { GatewayCacheRuleCursor } from "./gateway-cache-rule.ts";

/**
 * The REST credential a project door presented, as this module is told about
 * it: a scoped API key acts as its owning user, a legacy project key carries
 * none and acts as a stable synthetic machine principal.
 */
export type GatewayRequestCredential =
  | Readonly<{
      kind: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
    }>
  | Readonly<{ kind: "legacyProjectKey" }>;

/** A minted or read virtual key, published in the public REST surface's snake_case shape. */
export type GatewayVirtualKeySnakeDto = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: "active" | "disabled" | "revoked";
  purpose: "user" | "langy";
  display_prefix: string;
  principal_user_id: string | null;
  trace_project_id: string | null;
  trace_project_archived: boolean;
  external_id: string | null;
  metadata: Record<string, string>;
  scopes: Array<{
    scope_type: "organization" | "team" | "project";
    scope_id: string;
  }>;
  routing_policy_id: string | null;
  routing_mode: "none" | "fallback_all" | "policy";
  config: unknown;
  revision: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
};

/** A window a usage or spend read is taken over. */
export type GatewayUsageWindow = Readonly<{ fromDate: Instant; toDate: Instant }>;

/** A draft or existing key, as the applicable-budget read takes it. */
export type GatewayApplicableBudgetTarget = Readonly<{
  organizationId: string;
  virtualKeyId: string | null;
  scopes: readonly GatewayVirtualKeyScope[];
  traceProjectId: string | null;
  principalUserId: string | null;
}>;

/**
 * Who a write acts as. Opaque on purpose: what a session IS belongs to the
 * process's authentication, not to this module, so a door hands one straight
 * to the checks below and never reads it.
 */
export type GatewayCaller = unknown;

/** Minting a key, as the application takes it. */
export type GatewayVirtualKeyCreateCommand = Readonly<{
  organizationId: string;
  name: string;
  description?: string | null;
  principalUserId?: string | null;
  scopes: GatewayVirtualKeyScope[];
  traceProjectId?: string | null;
  routingPolicyId?: string | null;
  routingMode?: "FALLBACK_ALL" | "NONE" | "POLICY";
  expiresAt?: Instant | null;
  budget?: VirtualKeyBudgetInput | null;
  config?: Partial<VirtualKeyConfig>;
  externalId?: string | null;
  metadata?: Record<string, string>;
  actorUserId: string;
}>;

/** Editing a key: an absent field is left alone, null clears it. */
export type GatewayVirtualKeyUpdateCommand = Readonly<{
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
  budget?: VirtualKeyBudgetInput | null;
  config?: Partial<VirtualKeyConfig>;
  externalId?: string | null;
  metadata?: Record<string, string>;
}>;

/** One key addressed by id inside its organization, by the person asking. */
export type GatewayVirtualKeyCommand = Readonly<{
  id: string;
  organizationId: string;
  actorUserId: string;
}>;

/** The same, with the reason a disable records. */
export type GatewayVirtualKeyDisableCommand = GatewayVirtualKeyCommand &
  Readonly<{ reason: string | null }>;

/** A key and the one moment its plaintext secret exists. */
export type GatewayMintedVirtualKey = Readonly<{
  virtualKey: GatewayVirtualKeyRecord;
  secret: string;
}>;

/** One group a per-member allowance can be pointed at. */
export type GatewayGroupTarget = Readonly<{ id: string; name: string; memberCount: number }>;

export type GatewayAgentCacheWriteInput = Readonly<{
  projectId: string;
  name: string;
  value: string;
  ttlSeconds?: number;
}>;

export type GatewayElevenLabsWebhookAnswer = Readonly<{
  status: 200 | 400 | 401 | 404;
  body: Readonly<{ received: true }> | Readonly<{ error: string }>;
}>;

/** Callable gateway capability shared by API, worker, and task processes. */
export interface GatewayApi {
  getAgentCacheEntry(input: {
    projectId: string;
    name: string;
  }): Promise<{ name: string; value: string }>;
  putAgentCacheEntry(
    input: GatewayAgentCacheWriteInput,
  ): Promise<{ name: string; ttl_seconds: number }>;
  claimAgentCacheEntry(
    input: GatewayAgentCacheWriteInput,
  ): Promise<{ name: string; claimed: boolean; ttl_seconds: number }>;
  deleteAgentCacheEntry(input: { projectId: string; name: string }): Promise<void>;
  receiveElevenLabsWebhook(input: {
    modelProviderId: string;
    rawBody: string;
    signature: string | undefined;
  }): Promise<GatewayElevenLabsWebhookAnswer>;

  /** Refuses an organization id that names no organization. */
  assertOrganizationExists(organizationId: string): Promise<void>;
  /** The organization a project belongs to, or null when the project is unknown. */
  findProjectOrganization(projectId: string): Promise<string | null>;
  /** The organization behind the project a REST credential authenticated as. */
  organizationIdForProject(projectId: string): Promise<string>;
  /** Identity a REST credential authorizes as, plus a stable audit-row actor id. */
  actorForCredential(input: {
    projectId: string;
    credential: GatewayRequestCredential;
  }): { actor: GatewayCaller; actorUserId: string };
  /** A tenant-wide write a project credential names by id, checked at the organization it acts on. */
  authorizeOrganizationWideOperation(input: {
    actor: GatewayCaller;
    organizationId: string;
    permission: string;
  }): Promise<void>;

  listBudgetsWithHealth(organizationId: string): Promise<GatewayBudgetListWithHealth>;
  listProjectBudgetsWithHealth(projectId: string): Promise<GatewayBudgetListWithHealth>;
  listBudgetScopeTargets(
    budgets: Array<{ scopeType: string; scopeId: string }>,
    organizationId: string | null,
  ): Promise<Map<string, GatewayBudgetScopeTarget>>;
  findBudgetDetail(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetDetail | null>;
  createBudget(input: CreateGatewayBudgetInput): Promise<GatewayBudgetResource>;
  updateBudget(input: UpdateGatewayBudgetInput): Promise<GatewayBudgetResource>;
  archiveBudget(input: ArchiveGatewayBudgetInput): Promise<GatewayBudgetResource>;
  resetBudget(input: ResetGatewayBudgetInput): Promise<GatewayBudgetResource>;
  /** A cursor page of an organization's budgets, with live health, for the credentialed listing. */
  listBudgetPageWithHealth(input: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Instant; id: string } | null;
    scopeTypes?: readonly string[] | undefined;
    externalId?: string | undefined;
  }): Promise<GatewayBudgetListWithHealth>;
  /** One budget with live health, or null when it does not exist in this organization. */
  tryGetBudgetWithHealth(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetHealth | null>;
  /** Whether any active key could produce traffic against this budget's own scope target. */
  budgetScopeReach(input: {
    organizationId: string;
    scope: { scopeType: string; scopeId: string };
  }): Promise<GatewayBudgetScopeReachResult>;
  /** Provider row id to its display label, for a whole page in one read. */
  resolveProviderLabels(
    budgets: ReadonlyArray<{ providerKey: string | null }>,
  ): Promise<Map<string, string>>;
  listGroupTargets(organizationId: string): Promise<ReadonlyArray<GatewayGroupTarget>>;
  /** How many members a per-member GROUP allowance currently covers, batched over a page of rows. */
  groupMemberCounts(
    budgets: readonly { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, number>>;
  /** The budgets one debit lands on, as the spend graph resolves them. */
  resolveApplicableBudgets(input: GatewayBudgetResolutionTarget): Promise<GatewayResolvedBudget[]>;

  listCacheRules(organizationId: string): Promise<GatewayCacheRuleResource[]>;
  /** A cursor page of an organization's cache rules, priority-ordered, for the credentialed listing. */
  listCacheRulePage(input: {
    organizationId: string;
    limit: number;
    cursor: GatewayCacheRuleCursor | null;
  }): Promise<GatewayCacheRuleResource[]>;
  findCacheRule(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null>;
  createCacheRule(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  updateCacheRule(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  archiveCacheRule(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;

  listGuardrails(projectId: string): Promise<GatewayGuardrailResource[]>;
  findGuardrail(input: { id: string; projectId: string }): Promise<GatewayGuardrailResource | null>;
  createGuardrail(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  updateGuardrail(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  archiveGuardrail(input: ArchiveGatewayGuardrailInput): Promise<void>;

  // ── Virtual keys: visibility, projection, and the writes ─────────────────

  /**
   * Organization keys narrowed to what this person can see. Visibility is
   * membership-based, not permission-based: a caller sees a key when one of
   * its scopes intersects their membership set, so a non-member gets an empty
   * list rather than a refusal.
   */
  listVisibleVirtualKeys(input: {
    organizationId: string;
    userId: string;
  }): Promise<GatewayVirtualKeyRecord[]>;
  /** Whether one already-loaded key is visible to this person. */
  isVirtualKeyVisible(input: {
    organizationId: string;
    userId: string;
    virtualKey: GatewayVirtualKeyRecord;
  }): Promise<boolean>;
  /**
   * One key for a by-id read under that same rule: a key outside the caller's
   * membership set is answered as not found, so nothing leaks its existence.
   */
  requireVisibleVirtualKeyForUser(input: {
    organizationId: string;
    id: string;
    userId: string;
  }): Promise<GatewayVirtualKeyRecord>;
  findVirtualKeyById(id: string, organizationId: string): Promise<GatewayVirtualKeyRecord | null>;
  /** One key anchored to this organization, without any visibility rule. */
  requireExistingVirtualKey(input: {
    organizationId: string;
    id: string;
  }): Promise<GatewayVirtualKeyRecord>;
  /**
   * Keys a PROJECT CREDENTIAL may see on a page: org-scoped keys, its own
   * team's, its own project's -- never a sibling team's. Applied to the page,
   * not the query, so a page can be shorter than `limit` without the walk
   * being done.
   */
  visibleToProjectCredential(input: {
    project: { id: string };
    virtualKeys: readonly GatewayVirtualKeyRecord[];
  }): GatewayVirtualKeyRecord[];
  /** One key under that same credential-visibility rule, or the not-found refusal. */
  requireVisibleVirtualKeyForProjectCredential(input: {
    project: { id: string };
    id: string;
    organizationId: string;
  }): Promise<GatewayVirtualKeyRecord>;
  /** A page of an organization's keys, newest first, for the credentialed listing. */
  getVirtualKeyPage(input: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Instant; id: string } | null;
    externalId?: string | undefined;
  }): Promise<GatewayVirtualKeyRecord[]>;
  /** The camelCase projection, for a page of keys in ONE destination read. */
  toVirtualKeyCamelDtos(input: {
    virtualKeys: readonly GatewayVirtualKeyRecord[];
  }): Promise<VirtualKeyCamelDtoResponse[]>;
  toVirtualKeyCamelDto(virtualKey: GatewayVirtualKeyRecord): Promise<VirtualKeyCamelDtoResponse>;
  /** The published snake_case projection, batched the same way. */
  toVirtualKeySnakeDtos(input: {
    virtualKeys: readonly GatewayVirtualKeyRecord[];
  }): Promise<GatewayVirtualKeySnakeDto[]>;
  toVirtualKeySnakeDto(virtualKey: GatewayVirtualKeyRecord): Promise<GatewayVirtualKeySnakeDto>;
  /** Parses a REST budget-write field against the same schema the tRPC door validates with. */
  parseVirtualKeyBudget(
    input: unknown,
  ):
    | { success: true; data: VirtualKeyBudgetInput }
    | { success: false; error: { message: string } };

  createVirtualKey(input: GatewayVirtualKeyCreateCommand): Promise<GatewayMintedVirtualKey>;
  updateVirtualKey(input: GatewayVirtualKeyUpdateCommand): Promise<GatewayVirtualKeyRecord>;
  rotateVirtualKey(input: GatewayVirtualKeyCommand): Promise<GatewayMintedVirtualKey>;
  revokeVirtualKey(input: GatewayVirtualKeyCommand): Promise<GatewayVirtualKeyRecord>;
  disableVirtualKey(input: GatewayVirtualKeyDisableCommand): Promise<GatewayVirtualKeyRecord>;
  enableVirtualKey(input: GatewayVirtualKeyCommand): Promise<GatewayVirtualKeyRecord>;

  /** Manage on every draft scope and on the trace destination, before any read. */
  authorizeVirtualKeyScopeSelection(input: {
    actor: GatewayCaller;
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
  }): Promise<void>;
  /** The whole create pre-flight, including the guardrail references. */
  authorizeVirtualKeyCreate(input: {
    actor: GatewayCaller;
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
    guardrailAttachments?: unknown;
  }): Promise<void>;
  /**
   * The update pre-flight: standing on the key, plus manage on any new scope.
   * Answers the stored key it judged, so a caller that needs it does not read
   * the row a second time.
   */
  authorizeVirtualKeyUpdate(input: {
    actor: GatewayCaller;
    organizationId: string;
    id: string;
    scopes?: readonly GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
    guardrailAttachments?: unknown;
  }): Promise<GatewayVirtualKeyRecord>;
  /** One permission on one of the key's existing scopes, over the same read. */
  authorizeVirtualKeyOperation(input: {
    actor: GatewayCaller;
    organizationId: string;
    id: string;
    permission: string;
  }): Promise<GatewayVirtualKeyRecord>;

  // ── Usage and spend ──────────────────────────────────────────────────────

  /** Whether this deployment has the spend source a key's cost is read from. */
  isSpendSourceAvailable(): boolean;
  usageSummary(input: {
    organizationId: string;
    virtualKeyIds: string[];
    window: GatewayUsageWindow;
  }): Promise<GatewayUsageSummary>;
  usageSummaryForVirtualKey(input: {
    organizationId: string;
    virtualKeyId: string;
    window: GatewayUsageWindow;
    model?: string;
  }): Promise<GatewayVirtualKeyUsageSummary>;
  spendByVirtualKey(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    window: GatewayUsageWindow;
  }): Promise<Map<string, { spentUsd: string; requests: number }>>;
  /** The budget each named key carries of its own, with this period's spend. */
  loadDirectBudgetsForKeys(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    now: Instant;
  }): Promise<Map<string, GatewayVirtualKeyDirectBudget>>;
  /** Every budget that would constrain a draft or an existing key. */
  listApplicableBudgets(input: {
    target: GatewayApplicableBudgetTarget;
  }): Promise<GatewayApplicableBudget[]>;
  /** Whether a person belongs to this organization. */
  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean>;

  /**
   * One page of the spend-event ledger for a project, newest first, with
   * virtual-key names resolved for display. Answers null when this
   * deployment has no ClickHouse spend source, so a door renders the
   * disabled state rather than an empty page.
   */
  findSpendEventsPage(input: {
    projectId: string;
    fromMs: number;
    toMs: number;
    filters?: SpendFilters;
    cursor?: { occurredAtMs: number; gatewayRequestId: string };
    limit?: number;
  }): Promise<GatewaySpendEventPage | null>;
}

export const GatewayApi = moduleApi<GatewayApi>("gateway");
