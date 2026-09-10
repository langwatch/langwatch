/**
 * The Postgres rows this feature passes between its layers, restated so no
 * port, service or transport names the generated client. Each mirrors
 * `packages/prisma-client/prisma/schema.prisma` and moves with it.
 */
import type { Instant } from "@langwatch/time";
import type { GatewayBudgetScopeType, GatewayBudgetWindow } from "./gateway.budget.ts";

/** A Json column's value, mirroring the generated client's own shape. */
export type GatewayJsonObject = { [Key in string]?: GatewayJsonValue };
export type GatewayJsonArray = GatewayJsonValue[];
export type GatewayJsonValue =
  | string
  | number
  | boolean
  | GatewayJsonObject
  | GatewayJsonArray
  | null;

/** A `Decimal(18, 6)` money column, read through its string forms. */
export type GatewayDecimal = {
  toString(): string;
  toFixed(digits?: number): string;
};

export type GatewayBudgetBreachAction = "BLOCK" | "WARN";
export type GatewayProviderHealthStatus = "UNKNOWN" | "HEALTHY" | "DEGRADED" | "CIRCUIT_OPEN";
export type GatewayProviderRotationPolicy = "MANUAL";
export type VirtualKeyPurpose = "USER" | "LANGY";
export type VirtualKeyStatus = "ACTIVE" | "DISABLED" | "REVOKED";
export type VirtualKeyRoutingMode = "NONE" | "FALLBACK_ALL" | "POLICY";
export type GatewayRealtimeSessionStatus = "OPEN" | "CLOSED" | "FAILED" | "EXPIRED";

export type GatewayBudget = {
  id: string;
  organizationId: string;
  scopeType: GatewayBudgetScopeType;
  scopeId: string;
  providerKey: string | null;
  name: string;
  description: string | null;
  window: GatewayBudgetWindow;
  limitUsd: GatewayDecimal;
  onBreach: GatewayBudgetBreachAction;
  timezone: string | null;
  externalId: string | null;
  metadata: GatewayJsonValue;
  spentUsd: GatewayDecimal;
  currentPeriodStartedAt: Instant;
  resetsAt: Instant;
  lastResetAt: Instant | null;
  cycleAnchorAt: Instant | null;
  archivedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
  createdById: string;
  managedByVirtualKeyId: string | null;
};

export type GatewayBudgetBucketBoundary = {
  id: string;
  organizationId: string;
  budgetId: string;
  bucketScopeId: string;
  periodStartedAt: Instant;
  createdAt: Instant;
  updatedAt: Instant;
};

export type ModelProvider = {
  id: string;
  name: string;
  provider: string;
  routingHandle: string | null;
  enabled: boolean;
  customKeys: GatewayJsonValue | null;
  extraHeaders: GatewayJsonValue | null;
  customModels: GatewayJsonValue | null;
  customEmbeddingsModels: GatewayJsonValue | null;
  deploymentMapping: GatewayJsonValue | null;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  rateLimitRpd: number | null;
  rotationPolicy: GatewayProviderRotationPolicy;
  providerConfig: GatewayJsonValue | null;
  fallbackPriorityGlobal: number | null;
  langySkipPermissionsModels: GatewayJsonValue | null;
  healthStatus: GatewayProviderHealthStatus;
  circuitOpenedAt: Instant | null;
  lastHealthCheckAt: Instant | null;
  disabledAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
  organizationId: string;
};

export type VirtualKey = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: VirtualKeyStatus;
  purpose: VirtualKeyPurpose;
  externalId: string | null;
  metadata: GatewayJsonValue;
  disabledAt: Instant | null;
  disabledReason: string | null;
  expiresAt: Instant | null;
  hashedSecret: string;
  displayPrefix: string;
  principalUserId: string | null;
  traceProjectId: string | null;
  config: GatewayJsonValue;
  revision: bigint;
  previousHashedSecret: string | null;
  previousSecretValidUntil: Instant | null;
  revokedAt: Instant | null;
  revokedById: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  createdById: string;
  lastUsedAt: Instant | null;
  routingPolicyId: string | null;
  routingMode: VirtualKeyRoutingMode;
};

export type GatewayRealtimeSession = {
  id: string;
  projectId: string;
  organizationId: string;
  virtualKeyId: string;
  modelProviderId: string;
  vendor: string;
  agentId: string | null;
  model: string;
  requestedModel: string | null;
  vendorConversationId: string | null;
  status: GatewayRealtimeSessionStatus;
  mintedAt: Instant;
  closedAt: Instant | null;
  closeReason: string | null;
  traceId: string | null;
  vendorCostRaw: GatewayJsonValue | null;
  createdAt: Instant;
  updatedAt: Instant;
};

/** One place a virtual key is reachable from: an organization, a team or a project. */
export type GatewayVirtualKeyScope = {
  scopeType: "ORGANIZATION" | "PROJECT" | "TEAM";
  scopeId: string;
};

/** The visibility set a write states, which is the same shape a read answers. */
export type ScopeInput = GatewayVirtualKeyScope;

/**
 * A key with the joins every read of it carries: the scopes it is reachable
 * from, the person it acts for, and the routing policy it fails over through.
 * `metadata` and `config` stay unknown here - both are customer-authored Json
 * that only the parsers in this package are allowed to interpret.
 */
export type GatewayVirtualKeyRecord = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: VirtualKeyStatus;
  purpose: VirtualKeyPurpose;
  externalId: string | null;
  metadata: unknown;
  disabledAt: Instant | null;
  disabledReason: string | null;
  expiresAt: Instant | null;
  hashedSecret: string;
  displayPrefix: string;
  principalUserId: string | null;
  traceProjectId: string | null;
  config: unknown;
  revision: bigint;
  previousHashedSecret: string | null;
  previousSecretValidUntil: Instant | null;
  revokedAt: Instant | null;
  revokedById: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  createdById: string;
  lastUsedAt: Instant | null;
  routingPolicyId: string | null;
  routingMode: VirtualKeyRoutingMode;
  scopes: GatewayVirtualKeyScope[];
  principalUser: { id: string; name: string | null; email: string | null } | null;
  routingPolicy: {
    id: string;
    name: string;
    modelAliases: unknown;
    defaultModel: string | null;
    policyRules: unknown;
  } | null;
};

/** The same record, named for the join a caller cares about. */
export type VirtualKeyWithScopes = GatewayVirtualKeyRecord;
