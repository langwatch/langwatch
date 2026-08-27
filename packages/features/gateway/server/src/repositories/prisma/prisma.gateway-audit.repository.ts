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
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";
import {
  GatewayAuditPort,
  type AppendGatewayAuditInput,
  type GatewayAuditTransaction,
} from "../../ports/gateway-audit.port";

// Dotted-lowercase past-tense convention (Stripe / GitHub / Vercel / Datadog).
// Namespaced under `gateway.` so a single `LIKE 'gateway.%'` filter scopes
// SIEM exports to the entire gateway surface. See docs/ai-gateway/audit.mdx
// for the full code table + rationale.
export const GATEWAY_AUDIT_ACTIONS = [
  "gateway.virtual_key.created",
  "gateway.virtual_key.updated",
  "gateway.virtual_key.rotated",
  "gateway.virtual_key.revoked",
  "gateway.virtual_key.disabled",
  "gateway.virtual_key.enabled",
  "gateway.virtual_key.deleted",
  "gateway.virtual_key.guardrail_attached",
  "gateway.virtual_key.guardrail_detached",
  "gateway.budget.created",
  "gateway.budget.updated",
  "gateway.budget.reset",
  "gateway.budget.deleted",
  "gateway.provider_binding.created",
  "gateway.provider_binding.updated",
  "gateway.provider_binding.deleted",
  "gateway.cache_rule.created",
  "gateway.cache_rule.updated",
  "gateway.cache_rule.deleted",
  "gateway.guardrail.created",
  "gateway.guardrail.updated",
  "gateway.guardrail.archived",
] as const;

export type GatewayAuditAction = (typeof GATEWAY_AUDIT_ACTIONS)[number];

export const GATEWAY_AUDIT_TARGET_KINDS = [
  "virtual_key",
  "budget",
  "provider_binding",
  "cache_rule",
  "guardrail",
] as const;

export type GatewayAuditTargetKind = (typeof GATEWAY_AUDIT_TARGET_KINDS)[number];

export class PrismaGatewayAuditRepository extends GatewayAuditPort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async append(
    input: AppendGatewayAuditInput,
    transaction?: GatewayAuditTransaction,
  ): Promise<void> {
    const client = transaction ? (transaction as Prisma.TransactionClient) : this.prisma;
    await client.auditLog.create({
      data: {
        userId: input.actorUserId,
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        action: input.action,
        targetKind: input.targetKind,
        targetId: input.targetId,
        before: jsonInput(input.before),
        after: jsonInput(input.after),
      },
    });
  }
}

export function createGatewayAuditPort(database: PrismaClient): GatewayAuditPort {
  return new PrismaGatewayAuditRepository(database);
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return z.json().parse(value) as Prisma.InputJsonValue;
}
