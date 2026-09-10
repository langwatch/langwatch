import type { SpendUsage } from "@langwatch/gateway-contract";
import type { ConfirmSpendCommandData } from "../processes/gateway-spend-commands.process.ts";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { ModelProvider, PROVIDER_BUCKET_SEPARATOR, bucketScopeIdFor, budgetPeriodFloorMs, type GatewayBudgetLedgerStatus, type GatewayBudgetResource, type GatewayBudgetScopeType, type GatewayBudgetWindow } from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";
export interface GatewayInfrastructure {  gatewayAudit: GatewayAudit;
  gatewayBudgetSpend: GatewayBudgetSpend;
  gatewayChangeEvents: GatewayChangeEvents;
  gatewayClickHouse: GatewayClickHouse;
  gatewayConfigAssembly: GatewayConfigAssembly;
  gatewayGovernanceSignals: GatewayGovernanceSignals;
  gatewayModelProviderCredentials: GatewayModelProviderCredentials;
  gatewayScopePermissions: GatewayScopePermissions;
  gatewaySettlementPolicy: GatewaySettlementPolicy;
  gatewaySpanIngestion: GatewaySpanIngestion;
  gatewaySpendConfirmation: GatewaySpendConfirmation;
  gatewaySpendRating: GatewaySpendRating;
  gatewayTransaction: GatewayTransaction;
  gatewayVirtualKeyCrypto: GatewayVirtualKeyCrypto;
  gatewayVirtualKeySpend: GatewayVirtualKeySpend;
}

export type GatewayAuditAction =
  | "gateway.budget.created"
  | "gateway.budget.deleted"
  | "gateway.budget.reset"
  | "gateway.budget.updated"
  | "gateway.cache_rule.created"
  | "gateway.cache_rule.deleted"
  | "gateway.cache_rule.updated"
  | "gateway.guardrail.archived"
  | "gateway.guardrail.created"
  | "gateway.guardrail.updated"
  | "gateway.provider_binding.created"
  | "gateway.provider_binding.deleted"
  | "gateway.provider_binding.updated"
  | "gateway.virtual_key.created"
  | "gateway.virtual_key.deleted"
  | "gateway.virtual_key.disabled"
  | "gateway.virtual_key.enabled"
  | "gateway.virtual_key.guardrail_attached"
  | "gateway.virtual_key.guardrail_detached"
  | "gateway.virtual_key.revoked"
  | "gateway.virtual_key.rotated"
  | "gateway.virtual_key.updated";

export type GatewayAuditTargetKind =
  | "budget"
  | "cache_rule"
  | "guardrail"
  | "provider_binding"
  | "virtual_key";

export type AppendGatewayAuditInput = {
  organizationId: string;
  projectId?: string | null;
  actorUserId: string;
  action: GatewayAuditAction;
  targetKind: GatewayAuditTargetKind;
  targetId: string;
  before?: unknown;
  after?: unknown;
};

export type GatewayAuditTransaction = object;

/** Audit sink for Gateway mutations, independent of the shared table implementation. */
export interface GatewayAudit {
  append(
    input: AppendGatewayAuditInput,
    transaction?: GatewayAuditTransaction,
  ): Promise<void>;
}

export type GatewayBudgetSpendRecord = {
  id: string;
  scopeType: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  providerKey: string | null;
  currentPeriodStartedAt: Instant;
  lastResetAt: Instant | null;
  cycleAnchorAt: Instant | null;
};

export type BudgetBucketBoundary = {
  bucketScopeId: string;
  periodStartedAt: Instant;
};

export type BudgetSpendTarget = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  match?: "exact" | "prefix";
  bucketSuffix?: string | null;
  periodFloorMs?: number;
};

export type ScopeSpend = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  spentNanoUsd: number;
  spentUsd: string;
};

export type BucketSpend = {
  scopeId: string;
  spentNanoUsd: number;
  spentUsd: string;
};

export type LedgerEventRow = {
  id: string;
  budgetId: string;
  virtualKeyId: string;
  amountUsd: string;
  model: string;
  providerSlot: string | null;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number | null;
  status: "SUCCESS" | "PROVIDER_ERROR" | "BLOCKED_BY_GUARDRAIL" | "CANCELLED";
  occurredAt: Instant;
};

export type BudgetDebitRow = {
  tenantId: string;
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  virtualKeyId: string;
  providerCredentialId?: string | null;
  providerKey?: string | null;
  gatewayRequestId: string;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  providerSlot?: string | null;
  durationMs?: number | null;
  status: GatewayBudgetLedgerStatus;
  occurredAt: Instant;
};

export type PulledUsageRow = {
  tenantId: string;
  scopeId: string;
  restatementKey: string;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  providerKey?: string | null;
  occurredAt: Instant;
  observedAt: Instant;
};

export type PulledUsageTotals = {
  spentNanoUsd: number;
  spentUsd: string;
  items: number;
  tokensInput: number;
  tokensOutput: number;
};


/**
 * Read targets for a plain list of budgets, no request context (a GROUP budget sums every member bucket, having no single member here). `now` is the instant periods are resolved at, shared with the rollup read — passing it explicitly rather than each floor reading the wall clock is what keeps an anchored budget's moving floor in agreement across both halves of the read.
 */
export function budgetSpendTargetsFor({
  budgets,
  now = nowInstant(),
}: {
  budgets: GatewayBudgetResource[];
  now?: Instant;
}): BudgetSpendTarget[] {
  return budgets.map((b) =>
    b.scopeType === "GROUP"
      ? {
          budgetId: b.id,
          scope: b.scopeType,
          // The member id sits between the group prefix and the provider
          // suffix, so a provider-filtered group budget cannot be a plain
          // prefix target: the prefix is the bare group, and the provider
          // filter anchors the suffix instead.
          scopeId: `${b.scopeId}:`,
          window: b.window,
          match: "prefix" as const,
          bucketSuffix: b.providerKey ? `${PROVIDER_BUCKET_SEPARATOR}${b.providerKey}` : null,
          // MANUAL windows, anchored cycles and mid-period resets all move
          // the boundary; the list must total the CURRENT period, same as
          // enforcement does.
          periodFloorMs: budgetPeriodFloorMs(b, now),
        }
      : {
          budgetId: b.id,
          scope: b.scopeType,
          scopeId: bucketScopeIdFor(b, b.scopeId),
          window: b.window,
          match: "exact" as const,
          periodFloorMs: budgetPeriodFloorMs(b, now),
        },
  );
}

export interface GatewayBudgetSpend {
  insertDebit(rows: BudgetDebitRow[]): Promise<void>;
  insertPulledUsageRows(rows: PulledUsageRow[]): Promise<void>;
  readPulledUsageTotals(input: {
    tenantId: string;
    scopeIds: string[];
    from: Instant;
    to: Instant;
  }): Promise<PulledUsageTotals>;
  insertDebitsForBudgets(rows: BudgetDebitRow[]): Promise<void>;
  getSpendForBudgets(
    tenantId: string,
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
    now?: Instant,
  ): Promise<ScopeSpend[]>;
  getSpendForBudgetsAcrossTenants(
    tenantIds: string[],
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
    now?: Instant,
  ): Promise<ScopeSpend[]>;

  getSpendForTargetsAcrossTenants(
    tenantIds: string[],
    targets: BudgetSpendTarget[],
    now?: Instant,
  ): Promise<ScopeSpend[]>;

  getBucketSpendBreakdownForBudget(input: {
    budget: GatewayBudgetSpendRecord;
    tenantIds: string[];
    boundaries: BudgetBucketBoundary[];
    now: Instant;
  }): Promise<BucketSpend[]>;

  recentEventsForBudget(
    tenantIds: string[],
    budgetId: string,
    limit: number,
  ): Promise<LedgerEventRow[]>;
}

export type GatewayChangeEventKind =
  | "BUDGET_CREATED"
  | "BUDGET_UPDATED"
  | "BUDGET_DELETED"
  | "CACHE_RULE_CREATED"
  | "CACHE_RULE_UPDATED"
  | "CACHE_RULE_DELETED"
  | "MODEL_PROVIDER_UPDATED"
  | "ROUTING_POLICY_DELETED"
  | "ROUTING_POLICY_UPDATED"
  | "VK_CONFIG_UPDATED"
  | "VK_CREATED"
  | "VK_DISABLED"
  | "VK_ENABLED"
  | "VK_REVOKED"
  | "VK_ROTATED";

export type GatewayChangeEvent = {
  revision: bigint;
  kind: GatewayChangeEventKind;
  virtualKeyId: string | null;
  budgetId: string | null;
  modelProviderId: string | null;
  projectId: string | null;
};

export type AppendGatewayChangeEventInput = {
  organizationId: string;
  projectId?: string | null;
  kind: GatewayChangeEventKind;
  virtualKeyId?: string | null;
  budgetId?: string | null;
  modelProviderId?: string | null;
  payload?: unknown;
};

/** Opaque transaction hand-off; only the Prisma adapter interprets it. */
export type GatewayPersistenceTransaction = object;

/** Durable revision feed consumed by the Gateway configuration long-poll. */
export interface GatewayChangeEvents {
  append(
    input: AppendGatewayChangeEventInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<{ revision: bigint }>;
  since(
    organizationId: string,
    since: bigint,
    limit?: number,
  ): Promise<{ currentRevision: bigint; events: GatewayChangeEvent[] }>;
  currentRevision(organizationId: string): Promise<bigint>;
}

/**
 * The ClickHouse surface this feature uses, structurally, so the package does not depend on the driver. clickhouse_settings is scalars-only: the driver's type also admits a nested map, and declaring that here made the real client un-assignable (a parameter position is contravariant), yet nothing here ever passes a map setting. insert answers unknown for the mirror reason — Promise<InsertResult> isn't assignable to Promise<void> — and no call site reads what insert answers anyway.
 */
export type GatewayClickHouseClient = {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
    /** Set when the statement genuinely spans tenants; see the tenant-scope guard. */
    unscoped?: { reason: string };
  }): Promise<{ json<T = unknown>(): Promise<T[]> }>;
  insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown>;
};

export type GatewayClickHouseResolver = (tenantId: string) => Promise<GatewayClickHouseClient>;

/** Resolves the tenant-scoped ClickHouse client at the Gateway boundary. */
export interface GatewayClickHouse {
  resolve(tenantId: string): Promise<GatewayClickHouseClient>;
}

/**
 * What the gateway bundle is assembled from besides the materialiser's own logic: the version token, the reserved model tiers a routing policy falls through to, and the model catalog a provider row declares it serves. A port because each reads something outside the service (provider graph, tier vocabulary, shipped registry); a process composes the concrete reader.
 */
export interface GatewayConfigAssembly {
  /** The `ETag` for one key's bundle. */
  versionToken(virtualKey: VirtualKeyWithScopes): Promise<string>;

  /** The alias map the gateway receives, reserved tiers filled in. */
  withTierFallthrough(input: {
    aliases: Record<string, string>;
    defaultModel: string | null;
  }): Record<string, string>;

  /** The models a provider row declares, or undefined when it declares none. */
  tryDeclaredModelsForProvider(modelProvider: {
    provider: string;
    customModels: unknown;
    customEmbeddingsModels: unknown;
  }): string[] | undefined;

  /** One provider row's decrypted credentials, in the gateway's wire shape. */
  buildCredentials(
    modelProvider: ModelProvider,
    credentialReader: GatewayModelProviderCredentials,
  ): Record<string, unknown>;
}

/**
 * The Enterprise governance ledger's view of a virtual key's life.
 *
 * A port rather than a direct call: governance is an Enterprise capability and
 * a core package may not reach one. The payload is restated structurally for
 * the same reason — the Enterprise signal type is the authority, and this is
 * the subset the gateway can produce.
 *
 * Absent on every deployment that composes no governance ledger, which is what
 * the application being retired did in every process: it constructed the
 * Enterprise service in its DISABLED form, so each of the five lifecycle
 * emissions below reached a null object. Leaving the port unset preserves that
 * behaviour and, unlike the disabled object, says so.
 */
export type GatewayVirtualKeyLifecycleSignal = {
  virtualKey: {
    id: string;
    organizationId: string;
    name: string;
    displayPrefix: string;
    traceProjectId: string | null;
  };
  action: "created" | "updated" | "rotated" | "revoked" | "disabled" | "enabled";
  reason?: string | null;
};


export interface GatewayGovernanceSignals {
  emitVirtualKeyLifecycle(signal: GatewayVirtualKeyLifecycleSignal): Promise<void>;
}

/**
 * Reads a model provider's stored custom keys.
 *
 * The rows are encrypted at rest with the deployment's credential cipher, and
 * the cipher belongs to the Model Provider feature. A gateway package may not
 * depend on another feature's server package, so the read arrives as a port
 * and the process wires `@langwatch/model-provider-server`'s lenient reader
 * behind it.
 */
export interface GatewayModelProviderCredentials {
  readCustomKeys(stored: unknown): Record<string, unknown>;
}

/** The scope a virtual key is reachable from, as the key's own rows spell it. */
export type GatewayPermissionScope =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

/**
 * The one authorization seam the virtual-key write paths decide on.
 *
 * Two questions rather than one, because the two credentials answer them
 * differently and collapsing them would let a scoped API key inherit the
 * user's full cascade: a browser session resolves through the role-binding
 * cascade, while a scoped API key resolves through its own ceiling
 * (`effective = key ∩ user`). A legacy project key is neither and is decided
 * in the service without reaching this port at all.
 */
export interface GatewayScopePermissions {
  sessionHolds(input: {
    userId: string;
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }): Promise<boolean>;

  apiKeyHolds(input: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }): Promise<boolean>;
}


export interface GatewaySettlementPolicy {
  graceMs(): number;
}

/**
 * Writes one already-normalized span into the deployment's trace storage.
 *
 * The gateway emits exactly one span of its own — the settlement of a brokered
 * voice session — and it goes through the same normalized-span seam the OTLP
 * and REST collectors route through, so its (tenant, trace, span) dedup gate
 * makes a resent webhook write the span once rather than adding a second cost
 * to the trace.
 */
export interface GatewaySpanIngestion {
  ingestNormalizedSpan(input: {
    tenantId: string;
    span: {
      traceId: string;
      spanId: string;
      name: string;
      kind: number;
      startTimeUnixNano: string;
      endTimeUnixNano: string;
      attributes: unknown[];
      events: unknown[];
      links: unknown[];
      status: { message: string | null; code: number | null };
      droppedAttributesCount: number;
      droppedEventsCount: number;
      droppedLinksCount: number;
    };
    resource: null;
    instrumentationScope: null;
    piiRedactionLevel: string;
  }): Promise<void>;
}

/**
 * Hands a confirmation to the gateway spend pipeline.
 *
 * The port exists so a voice settlement reaches the SAME pipeline the
 * gateway's own drainer sends to. A process that registered no such pipeline
 * refuses by name rather than dropping the confirmation, because a dropped
 * confirmation leaves an admitted spend record to settle as cost-unknown.
 */
export interface GatewaySpendConfirmation {
  confirmSpend(data: ConfirmSpendCommandData): Promise<void>;
}

/**
 * Prices measured quantities.
 *
 * One rating seam for the whole vertical: the voice settlement and the
 * gateway's own drainer must not price the same call twice, which is how two
 * money surfaces come to disagree about it.
 */
export interface GatewaySpendRating {
  rate(input: { model: string; usage: SpendUsage; rateVersion?: string }): {
    costNanoUsd: number;
    rateVersion: string;
  };
}

/**
 * One durable unit of work: a key write, its change event, and its audit row
 * land together or not at all — stated without the service holding a client.
 */
export interface GatewayTransaction {
  run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T>;
}

/**
 * The virtual-key cipher, as the write path sees it: mint a secret, read its display prefix back, hash or verify one. The cipher itself is an adapter, so a process composes the peppered implementation and the service never reaches for it.
 */
export interface GatewayVirtualKeyCrypto {
  mintSecret(nowMs?: number): string;
  parseSecret(secret: string): { displayPrefix: string; ulid: string };
  hashSecret(secret: string): string;
  verifySecret(secret: string, hashedSecret: string): boolean;
}

export type GatewayVirtualKeySpendRow = {
  virtualKeyId: string;
  spentUsd: string;
  requests: number;
};

export type GatewaySpendWindow = {
  fromDate: Instant;
  toDate: Instant;
};

export type GatewayUsageBucket = {
  virtualKeyId: string;
  model: string;
  day: string;
  totalUsd: string;
  requests: number;
  blockedRequests: number;
};

export type GatewayTraceRow = {
  traceId: string;
  virtualKeyId: string;
  costUsd: string;
  models: string[];
  occurredAt: Instant;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  hasError: boolean;
  blockedByGuardrail: boolean;
};


export interface GatewayVirtualKeySpend {
  spendByVirtualKey(input: {
    tenantIds: string[];
    virtualKeyIds: string[];
    window: GatewaySpendWindow;
  }): Promise<GatewayVirtualKeySpendRow[]>;

  usageBuckets(input: {
    tenantIds: string[];
    window: GatewaySpendWindow;
    virtualKeyIds?: string[];
  }): Promise<GatewayUsageBucket[]>;

  gatewayTraces(input: {
    tenantIds: string[];
    window: GatewaySpendWindow;
    virtualKeyIds?: string[];
    model?: string;
    limit: number;
  }): Promise<GatewayTraceRow[]>;
}
