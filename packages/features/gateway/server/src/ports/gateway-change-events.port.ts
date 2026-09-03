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
export abstract class GatewayChangeEventsPort {
  abstract append(
    input: AppendGatewayChangeEventInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<{ revision: bigint }>;
  abstract since(
    organizationId: string,
    since: bigint,
    limit?: number,
  ): Promise<{ currentRevision: bigint; events: GatewayChangeEvent[] }>;
  abstract currentRevision(organizationId: string): Promise<bigint>;
}
