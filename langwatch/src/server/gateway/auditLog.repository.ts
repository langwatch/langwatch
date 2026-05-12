/**
 * Thin adapter that lets gateway services write governance rows to the
 * shared `AuditLog` table using the gateway-shape (action enum,
 * targetKind, before/after diff). Same call sites as before; the table
 * underneath is now the unified one — see migration
 * `20260425000000_consolidate_gateway_audit_into_audit_log`.
 *
 * Gateway services pass an `actorUserId` through to keep attribution
 * consistent with the platform `auditLog()` helper.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

// Dotted-lowercase past-tense convention (Stripe / GitHub / Vercel / Datadog).
// Namespaced under `gateway.` so a single `LIKE 'gateway.%'` filter scopes
// SIEM exports to the entire gateway surface. See docs/ai-gateway/audit.mdx
// for the full code table + rationale.
export const GATEWAY_AUDIT_ACTIONS = [
  "gateway.virtual_key.created",
  "gateway.virtual_key.updated",
  "gateway.virtual_key.rotated",
  "gateway.virtual_key.revoked",
  "gateway.virtual_key.deleted",
  "gateway.budget.created",
  "gateway.budget.updated",
  "gateway.budget.deleted",
  "gateway.provider_binding.created",
  "gateway.provider_binding.updated",
  "gateway.provider_binding.deleted",
  "gateway.cache_rule.created",
  "gateway.cache_rule.updated",
  "gateway.cache_rule.deleted",
] as const;

export type GatewayAuditAction = (typeof GATEWAY_AUDIT_ACTIONS)[number];

export const GATEWAY_AUDIT_TARGET_KINDS = [
  "virtual_key",
  "budget",
  "provider_binding",
  "cache_rule",
] as const;

export type GatewayAuditTargetKind = (typeof GATEWAY_AUDIT_TARGET_KINDS)[number];

export type AppendAuditInput = {
  organizationId: string;
  projectId?: string | null;
  actorUserId: string;
  action: GatewayAuditAction;
  targetKind: GatewayAuditTargetKind;
  targetId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
};

export class GatewayAuditAdapter {
  constructor(private readonly prisma: PrismaClient) {}

  async append(
    input: AppendAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        userId: input.actorUserId,
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        action: input.action,
        targetKind: input.targetKind,
        targetId: input.targetId,
        before: input.before ?? Prisma.JsonNull,
        after: input.after ?? Prisma.JsonNull,
      },
    });
  }
}
