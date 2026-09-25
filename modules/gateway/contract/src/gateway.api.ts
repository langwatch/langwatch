/**
 * The AI Gateway's portable capability: operations a process's own doors
 * call, plus the one budget-resolution read the spend graph makes. Replaces
 * the abstract `GatewayService` — an interface plus its token, not a class.
 */
import { moduleApi } from "@langwatch/kernel/module-api";
import type { Instant } from "@langwatch/time";

import type {
  ArchiveGatewayCacheRuleInput,
  CreateGatewayCacheRuleInput,
  GatewayCacheRuleResource,
  UpdateGatewayCacheRuleInput,
  GatewayCacheRuleCursor,
} from "./gateway-cache-rule.ts";
import type {
  ArchiveGatewayGuardrailInput,
  CreateGatewayGuardrailInput,
  GatewayGuardrailResource,
  UpdateGatewayGuardrailInput,
} from "./gateway-guardrail.ts";
import type { GatewayInternalSpendCommandRecord } from "./gateway-internal.schemas.ts";
import type {
  GatewayPricedSpend,
  GatewayPricedSpendResult,
  SpendFilters,
  SpendUsage,
} from "./gateway-spend.schemas.ts";
import type {
  ArchiveGatewayBudgetInput,
  CreateGatewayBudgetInput,
  GatewayBudgetDetail,
  GatewayBudgetListWithHealth,
  GatewayBudgetPageWithHealth,
  GatewayBudgetResolutionTarget,
  GatewayBudgetResource,
  GatewayBudgetScopeTarget,
  GatewayResolvedBudget,
  ResetGatewayBudgetInput,
  UpdateGatewayBudgetInput,
  GatewayApplicableBudget,
  GatewayVirtualKeyDirectBudget,
  GatewayBudgetHealth,
  GatewayBudgetScopeReachResult,
} from "./gateway.budget.ts";
import type { GatewayDeploymentAddresses } from "./gateway.config.ts";
import type {
  GatewaySpendEventPage,
  GatewayUsageSummary,
  GatewayVirtualKeyUsageSummary,
  VirtualKeyCamelDtoResponse,
} from "./gateway.responses.ts";
import type {
  GatewayVirtualKeyRecord,
  GatewayVirtualKeyScope,
  VirtualKeyWithScopes,
} from "./gateway.rows.ts";
import type { VirtualKeyConfig } from "./virtual-key-config.ts";
import type { VirtualKeyBudgetInput } from "./virtual-key.schemas.ts";

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
  scopes: {
    scope_type: "organization" | "team" | "project";
    scope_id: string;
  }[];
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

/**
 * What the per-member budget overview names a budget's scope class as, from
 * the caller's own point of view. "other" is the honest answer for a scope
 * kind this module has no member-relative wording for.
 */
export type GatewayBudgetOverviewScopeClass =
  | "organization"
  | "team"
  | "project"
  | "personal"
  | "key"
  | "department"
  | "other";

/**
 * One budget in the per-member overview: the applicable-budget wire shape
 * plus the phrasing a surface renders after the numbers.
 */
export type GatewayBudgetOverviewItem = GatewayApplicableBudget & {
  scopeClass: GatewayBudgetOverviewScopeClass;
  scopePhrase: string;
  /** When the current window's spend resets to zero, ISO-8601 UTC. Null for
   * windows that never reset. */
  resetsAt: string | null;
  /** Top models by spend in the personal workspace this month; personal-class items only,
   * and only when asked for. */
  topModels?: { model: string; spentUsd: number }[];
};

/**
 * Every budget binding one member's own keys in one organization: the
 * personal page, the CLI epilogue and any REST mirror all read this.
 */
export type GatewayBudgetOverviewForUser = {
  /** False when this org gives the member no gateway path at all: the
   * governance flag is off, or they are not a member. */
  gatewayAccess: boolean;
  reason?: "flag_off" | "no_membership";
  budgets: GatewayBudgetOverviewItem[];
};

/** Callable gateway capability shared by API, worker, and task processes. */
export type GatewayInternalCodexRefreshResult =
  | { status: "refreshed"; accessToken: string; accountId: string }
  | { status: "not_connected" }
  | { status: "session_expired" }
  | { status: "unavailable" };

export type GatewayInternalSpendSubmission =
  | { status: "unavailable" }
  | { status: "unregistered"; command: "admitSpend" | "confirmSpend" | "failSpend" }
  | { status: "accepted"; accepted: number; rejected: { index: number; code: string }[] };

/** The LangWatch-hosted provider a connected install's gateway reaches for one organization. */
export type GatewayConnectUpstream = Readonly<{
  organizationId: string;
  /** The Connect gateway endpoint; the slot calls its `/v1`. */
  baseUrl: string;
  /** The install's `lwl_` token, presented as the slot's key. */
  token: string;
  instanceId: string;
}>;

/** Why a presented license token resolves to no key; each is its own wire code. */
export type GatewayLicenseTokenRefusal =
  | "connect_license_token_malformed"
  | "connect_instance_required"
  | "connect_license_not_registered"
  | "connect_license_revoked"
  | "connect_license_expired"
  | "connect_wrong_instance";

/** The managed key a license token runs under, and what its token may carry. */
export type GatewayLicenseTokenResolution =
  | {
      ok: true;
      key: GatewayVirtualKeyRecord;
      /** The license end or the key's own expiry, whichever comes first; absent for neither. */
      notAfter?: Instant;
      connectServices: string[];
    }
  | { ok: false; code: GatewayLicenseTokenRefusal };

export interface GatewayInternalProtocol {
  findVirtualKeyBySecret(secret: string): Promise<GatewayVirtualKeyRecord | null>;
  /** Resolves an `lwl_` token by the facts licensing wrote onto its managed key. */
  resolveLicenseToken(input: {
    token: string;
    instanceId: string | undefined;
  }): Promise<GatewayLicenseTokenResolution>;
  findTraceDestination(projectId: string): Promise<{ id: string; teamId: string } | null>;
  signJwt(input: {
    vk_id: string;
    project_id: string | null;
    team_id: string | null;
    org_id: string;
    principal_id: string | null;
    revision: string;
    notAfter?: Instant | null;
    /** The hosted services of the license a CONNECT key runs under; absent otherwise. */
    connect_services?: string[];
  }): { jwt: string; expiresAt: number };
  touchVirtualKeyUsage(id: string): Promise<void>;
  refreshCodex(input: { providerRowId: string }): Promise<GatewayInternalCodexRefreshResult>;
  findVirtualKeyForConfig(id: string): Promise<VirtualKeyWithScopes | null>;
  configVersionToken(input: VirtualKeyWithScopes): Promise<string>;
  materialiseConfig(input: VirtualKeyWithScopes): Promise<unknown>;
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
  }>;
  currentRevision(organizationId: string): Promise<bigint>;
  checkGuardrails(input: {
    projectId: string;
    guardrailIds: string[];
    direction: "request" | "response" | "stream_chunk";
    content?: {
      messages?: unknown;
      output?: unknown;
      chunk?: unknown;
      tools?: unknown;
      mcps?: unknown;
    };
  }): Promise<
    | { status: "unavailable" }
    | {
        status: "evaluated";
        verdict: {
          decision: "allow" | "block" | "modify";
          reason: string | null;
          modified_content: Record<string, unknown> | null;
          policies_triggered: string[];
        };
      }
  >;
  budgetBucketSpend(input: {
    budgetId: string;
    endUserId: string;
  }): Promise<
    | { status: "not_found" }
    | { status: "available"; spentMicroUsd: number; bucketScopeId: string | null }
  >;
  submitSpendCommands(
    records: GatewayInternalSpendCommandRecord[],
  ): Promise<GatewayInternalSpendSubmission>;
  reserveRealtimeSession(input: {
    sessionId: string;
    projectId: string;
    organizationId: string;
    virtualKeyId: string;
    modelProviderId: string;
    vendor: string;
    agentId?: string;
    model: string;
    traceId?: string;
    requestedModel?: string;
  }): Promise<
    | { ok: true }
    | { ok: false; reason: "session_limit"; open: number; limit: number }
    | { ok: false; reason: "unavailable" }
  >;
  correlateRealtimeSession(input: {
    sessionId: string;
    projectId: string;
    vendorConversationId: string;
  }): Promise<"applied" | "not_found" | "unavailable">;
  releaseRealtimeSession(input: {
    sessionId: string;
    projectId: string;
    status: "FAILED" | "EXPIRED";
    reason: string;
  }): Promise<"applied" | "not_found" | "unavailable">;
  reportRealtimeSessionUsage(input: {
    sessionId: string;
    projectId: string;
    virtualKeyId: string;
    usage: SpendUsage;
  }): Promise<"already_closed" | "closed" | "not_found" | "unavailable">;
}

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * requests through the gateway and what they cost, since `since` where one is
 * given, and when the first request was. Epoch milliseconds.
 */
export interface GatewayUsageCount {
  readonly requests: number;
  readonly spendUsd: number;
  readonly firstRequestAt?: number;
}

/** One UTC day of the metered lane: charged requests at their latest status, nano-USD. */
export interface GatewaySpendDay {
  readonly day: string;
  readonly amountNanoUsd: number;
  readonly requestCount: number;
  readonly pricedRequestCount: number;
  readonly requestsWithoutAmount: number;
}

export interface GatewayApi extends GatewayInternalProtocol {
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
  actorForCredential(input: { projectId: string; credential: GatewayRequestCredential }): {
    actor: GatewayCaller;
    actorUserId: string;
  };
  /** Tenant-wide write by project credential, checked at the organization. */
  authorizeOrganizationWideOperation(input: {
    actor: GatewayCaller;
    organizationId: string;
    permission: string;
  }): Promise<void>;

  listBudgetsWithHealth(organizationId: string): Promise<GatewayBudgetListWithHealth>;
  listProjectBudgetsWithHealth(projectId: string): Promise<GatewayBudgetListWithHealth>;
  listBudgetScopeTargets(
    budgets: { scopeType: string; scopeId: string }[],
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
  }): Promise<GatewayBudgetPageWithHealth>;
  /** One budget with live health; throws `gateway_budget_not_found` outside this organization. */
  getBudgetWithHealth(input: { id: string; organizationId: string }): Promise<GatewayBudgetHealth>;
  /** Whether any active key could produce traffic against this budget's own scope target. */
  budgetScopeReach(input: {
    organizationId: string;
    scope: { scopeType: string; scopeId: string };
  }): Promise<GatewayBudgetScopeReachResult>;
  /** Provider row id to its display label, for a whole page in one read. */
  resolveProviderLabels(
    budgets: readonly { providerKey: string | null }[],
  ): Promise<Map<string, string>>;
  listGroupTargets(organizationId: string): Promise<readonly GatewayGroupTarget[]>;
  /** Member count per-GROUP allowance covers, batched over a page. */
  groupMemberCounts(
    budgets: readonly { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, number>>;
  /** The budgets one debit lands on, as the spend graph resolves them. */
  resolveApplicableBudgets(input: GatewayBudgetResolutionTarget): Promise<GatewayResolvedBudget[]>;

  listCacheRules(organizationId: string): Promise<GatewayCacheRuleResource[]>;
  /** Cursor page of org cache rules, priority-ordered. */
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
   * membership-based, not permission-based, so a non-member gets an empty
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
  getVisibleVirtualKeyForUser(input: {
    organizationId: string;
    id: string;
    userId: string;
  }): Promise<GatewayVirtualKeyRecord>;
  /**
   * Live keys held by a person (any person when unnamed), newest first: main's
   * personal-key reads.
   */
  findPersonalVirtualKeys(input: {
    organizationId?: string;
    principalUserId?: string;
  }): Promise<GatewayVirtualKeyRecord[]>;
  findVirtualKeyById(id: string, organizationId: string): Promise<GatewayVirtualKeyRecord | null>;
  /** One key anchored to this organization, without any visibility rule. */
  getExistingVirtualKey(input: {
    organizationId: string;
    id: string;
  }): Promise<GatewayVirtualKeyRecord>;
  /**
   * Keys a PROJECT CREDENTIAL may see on a page: org-scoped, its own team's,
   * its own project's — never a sibling team's. Applied to the page, not the
   * query, so a page can be shorter than `limit` without the walk done.
   */
  visibleToProjectCredential(input: {
    project: { id: string };
    virtualKeys: readonly GatewayVirtualKeyRecord[];
  }): GatewayVirtualKeyRecord[];
  /** One key under that same credential-visibility rule, or the not-found refusal. */
  getVisibleVirtualKeyForProjectCredential(input: {
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

  /**
   * The managed key a license resolves to (ADR-156 section 3): one per
   * license, on the customer's hidden governance project, its secret
   * discarded. Repeating this mints a second key; the registry calls it once.
   */
  provisionConnectManagedKey(input: {
    organizationId: string;
    licenseId: string;
    actorUserId: string;
  }): Promise<{ id: string }>;
  /**
   * Ends a managed key for the feature that owns it; customer-facing revocation
   * refuses one. A key already gone is left alone, so this is safe to repeat,
   * which is what makes revoking a license retryable.
   */
  revokeManagedInternal(input: {
    virtualKeyId: string;
    organizationId: string;
    actorId: string;
  }): Promise<void>;
  /**
   * Tells every gateway to resolve a managed key again, unchanged, through the
   * change feed each already polls — for cached state outside the key row,
   * such as the install a license is bound to.
   */
  invalidateManagedInternal(input: { virtualKeyId: string; organizationId: string }): Promise<void>;
  /**
   * The platform services a CONNECT key may serve, replaced whole; empty serves none.
   * Only the feature holding the license gate writes it, never a transport.
   */
  setManagedKeyConnectServicesInternal(input: {
    virtualKeyId: string;
    organizationId: string;
    services: readonly string[];
  }): Promise<void>;
  /**
   * The license a CONNECT key serves: the registry hash of its token, the bound
   * install and its end. Written by licensing at activation and on every sync.
   */
  setManagedKeyLicenseInternal(input: {
    virtualKeyId: string;
    organizationId: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant | null;
  }): Promise<void>;
  /**
   * Where one organization's gateway reaches LangWatch-hosted models, replaced whole.
   * Only licensing writes it, and it clears it on every change of license, service or Connect.
   */
  setConnectUpstreamInternal(input: GatewayConnectUpstream): Promise<void>;
  /** Drops the organization's hosted provider slot. Safe to repeat. */
  clearConnectUpstreamInternal(input: { organizationId: string }): Promise<void>;
  disableVirtualKey(input: GatewayVirtualKeyDisableCommand): Promise<GatewayVirtualKeyRecord>;
  enableVirtualKey(input: GatewayVirtualKeyCommand): Promise<GatewayVirtualKeyRecord>;

  /** Manage on every draft scope and on the trace destination, before any read. */
  authorizeVirtualKeyScopeSelection(input: {
    actor: GatewayCaller;
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
  }): Promise<void>;
  /**
   * The whole create pre-flight, including the guardrail references. A project
   * credential names its project: a key for exactly that project needs create, not manage.
   */
  authorizeVirtualKeyCreate(input: {
    actor: GatewayCaller;
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
    guardrailAttachments?: unknown;
    callerProjectId?: string;
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
  /** Where the gateway runs for this deployment, as configured; undefined where nothing says. */
  getDeploymentAddresses(): GatewayDeploymentAddresses;
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
  /** Every budget binding this member's own keys in this organization, with
   * spend and scope phrasing. */
  budgetOverviewForUser(input: {
    organizationId: string;
    userId: string;
  }): Promise<GatewayBudgetOverviewForUser>;
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
   * Appends one confirmed outcome the caller priced itself. The spine takes
   * the price as given: a judgement's model is not in the registry, so the
   * drain path's re-rating would answer zero for it.
   */
  recordPricedSpend(input: GatewayPricedSpend): Promise<GatewayPricedSpendResult>;

  /**
   * What one request type has cost these tenants, in integer nano-USD, over the
   * whole ledger or the window given. Confirmed rows only, and 0 where this
   * deployment has no spend source: an absent ledger was never written to.
   */
  sumSpendNanoUsdByRequestType(input: {
    tenantIds: readonly string[];
    requestType: string;
    fromMs?: number;
    toMs?: number;
  }): Promise<number>;

  /**
   * One page of the spend-event ledger for a project, newest first, with
   * virtual-key names resolved. Answers null with no ClickHouse spend
   * source, so a door renders disabled rather than an empty page.
   */
  listSpendEventsPage(input: {
    projectId: string;
    fromMs: number;
    toMs: number;
    filters?: SpendFilters;
    cursor?: { occurredAtMs: number; gatewayRequestId: string };
    limit?: number;
  }): Promise<GatewaySpendEventPage | null>;
  /**
   * The metered lane per UTC day across these tenants' ledgers, inclusive days,
   * oldest first; none for no tenants or no ledger. Main's governance
   * `sumDaysForOrganizationProjects`, served by the ledger's owner.
   */
  findSpendDaysForOrganizationProjects(input: {
    tenantIds: readonly string[];
    fromDay: string;
    toDay: string;
  }): Promise<GatewaySpendDay[]>;
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<GatewayUsageCount>;
}

export const GatewayApi = moduleApi<GatewayApi>()("gateway");
