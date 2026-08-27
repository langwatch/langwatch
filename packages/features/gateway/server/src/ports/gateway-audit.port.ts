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
export abstract class GatewayAuditPort {
  abstract append(
    input: AppendGatewayAuditInput,
    transaction?: GatewayAuditTransaction,
  ): Promise<void>;
}
