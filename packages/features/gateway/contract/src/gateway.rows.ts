/**
 * The Postgres rows this feature passes between its layers, restated so no
 * port, service or transport names the generated client. Each mirrors
 * `packages/prisma-client/prisma/schema.prisma` and moves with it.
 */
import type { GatewayBudgetScopeType, GatewayBudgetWindow } from "./gateway.budget";

/** A Json column's value, mirroring the generated client's own shape. */
export type GatewayJsonObject = { [Key in string]?: GatewayJsonValue };
export interface GatewayJsonArray extends Array<GatewayJsonValue> {}
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
  currentPeriodStartedAt: Date;
  resetsAt: Date;
  lastResetAt: Date | null;
  cycleAnchorAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  managedByVirtualKeyId: string | null;
};

export type GatewayBudgetBucketBoundary = {
  id: string;
  organizationId: string;
  budgetId: string;
  bucketScopeId: string;
  periodStartedAt: Date;
  createdAt: Date;
  updatedAt: Date;
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
  healthStatus: GatewayProviderHealthStatus;
  circuitOpenedAt: Date | null;
  lastHealthCheckAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  disabledAt: Date | null;
  disabledReason: string | null;
  expiresAt: Date | null;
  hashedSecret: string;
  displayPrefix: string;
  principalUserId: string | null;
  traceProjectId: string | null;
  config: GatewayJsonValue;
  revision: bigint;
  previousHashedSecret: string | null;
  previousSecretValidUntil: Date | null;
  revokedAt: Date | null;
  revokedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  lastUsedAt: Date | null;
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
  mintedAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  traceId: string | null;
  vendorCostRaw: GatewayJsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};
