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
import type {
  GatewayVirtualKeyRecord,
  GatewayVirtualKeyScope,
} from "./gateway.rows.ts";
import type { VirtualKeyBudgetInput } from "./virtual-key.schemas.ts";
import type { VirtualKeyConfig } from "./virtual-key-config.ts";
import type {
  GatewaySpendEventPage,
  GatewayUsageSummary,
  GatewayVirtualKeyUsageSummary,
  VirtualKeyCamelDtoResponse,
} from "./gateway.responses.ts";
import type { SpendFilters } from "./gateway-spend.schemas.ts";
import type {
  GatewayApplicableBudget,
  GatewayVirtualKeyDirectBudget,
} from "./gateway.budget.ts";
import type {
  ArchiveGatewayGuardrailInput,
  CreateGatewayGuardrailInput,
  GatewayGuardrailResource,
  UpdateGatewayGuardrailInput,
} from "./gateway-guardrail.ts";

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

/** Callable gateway capability shared by API, worker, and task processes. */
export interface GatewayApi {
  /** Refuses an organization id that names no organization. */
  assertOrganizationExists(organizationId: string): Promise<void>;
  /** The organization a project belongs to, or null when the project is unknown. */
  findProjectOrganization(projectId: string): Promise<string | null>;

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
  /** Provider row id to its display label, for a whole page in one read. */
  resolveProviderLabels(
    budgets: ReadonlyArray<{ providerKey: string | null }>,
  ): Promise<Map<string, string>>;
  listGroupTargets(organizationId: string): Promise<ReadonlyArray<GatewayGroupTarget>>;
  /** The budgets one debit lands on, as the spend graph resolves them. */
  resolveApplicableBudgets(
    input: GatewayBudgetResolutionTarget,
  ): Promise<GatewayResolvedBudget[]>;

  listCacheRules(organizationId: string): Promise<GatewayCacheRuleResource[]>;
  findCacheRule(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null>;
  createCacheRule(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  updateCacheRule(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  archiveCacheRule(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;

  listGuardrails(projectId: string): Promise<GatewayGuardrailResource[]>;
  findGuardrail(input: {
    id: string;
    projectId: string;
  }): Promise<GatewayGuardrailResource | null>;
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
  /** The camelCase projection, for a page of keys in ONE destination read. */
  toVirtualKeyCamelDtos(input: {
    virtualKeys: readonly GatewayVirtualKeyRecord[];
  }): Promise<VirtualKeyCamelDtoResponse[]>;
  toVirtualKeyCamelDto(virtualKey: GatewayVirtualKeyRecord): Promise<VirtualKeyCamelDtoResponse>;

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
