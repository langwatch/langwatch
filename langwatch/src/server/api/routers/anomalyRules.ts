/**
 * tRPC router for AnomalyRule admin CRUD.
 *
 * Mirrors the routingPolicies / ingestionSources router pattern.
 * Eval engine + alert dispatch is Option C — this slice ships the
 * configuration entity ONLY so Alexis's anomaly-rules admin UI can
 * persist real rules instead of MOCK_RULES.
 *
 * RBAC: gates on `anomalyRules:view` (reads) and `anomalyRules:manage`
 * (mutations) per the catalog in api/rbac.ts. Only org ADMIN (or a
 * custom role granting these permissions) can read or write. MEMBER +
 * EXTERNAL get nothing — the previous `organization:view` gate leaked
 * reads to every org member.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  AnomalyRuleService,
  SUPPORTED_SCOPES,
  SUPPORTED_SEVERITIES,
} from "~/server/governance/activity-monitor/anomalyRule.service";

import {
  ENTERPRISE_FEATURE_ERRORS,
  requireEnterprisePlan,
} from "../enterprise";
import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const enterpriseGate = requireEnterprisePlan(
  ENTERPRISE_FEATURE_ERRORS.ANOMALY_RULES,
);

const severitySchema = z.enum(
  SUPPORTED_SEVERITIES as readonly [string, ...string[]],
);
const scopeSchema = z.enum(
  SUPPORTED_SCOPES as readonly [string, ...string[]],
);
const statusSchema = z.enum(["active", "disabled"]);

function toDto(row: {
  id: string;
  organizationId: string;
  scope: string;
  scopeId: string;
  name: string;
  description: string | null;
  severity: string;
  ruleType: string;
  thresholdConfig: unknown;
  destinationConfig: unknown;
  status: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scope: row.scope,
    scopeId: row.scopeId,
    name: row.name,
    description: row.description,
    severity: row.severity,
    ruleType: row.ruleType,
    thresholdConfig: (row.thresholdConfig as Record<string, unknown>) ?? {},
    destinationConfig: (row.destinationConfig as Record<string, unknown>) ?? {},
    status: row.status,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
  };
}

export const anomalyRulesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("anomalyRules:view"))
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = AnomalyRuleService.create(ctx.prisma);
      const rows = await service.list(input.organizationId);
      return rows.map(toDto);
    }),

  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("anomalyRules:view"))
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = AnomalyRuleService.create(ctx.prisma);
      const row = await service.findById(input.id, input.organizationId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return toDto(row);
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(128),
        description: z.string().nullable().optional(),
        severity: severitySchema,
        ruleType: z.string().min(1).max(64),
        scope: scopeSchema,
        scopeId: z.string().min(1),
        thresholdConfig: z.record(z.string(), z.unknown()).optional(),
        destinationConfig: z.record(z.string(), z.unknown()).optional(),
        status: statusSchema.optional(),
      }),
    )
    .use(checkOrganizationPermission("anomalyRules:manage"))
    .use(enterpriseGate)
    .mutation(async ({ ctx, input }) => {
      const service = AnomalyRuleService.create(ctx.prisma);
      const created = await service.createRule({
        organizationId: input.organizationId,
        name: input.name,
        description: input.description ?? null,
        severity: input.severity as (typeof SUPPORTED_SEVERITIES)[number],
        ruleType: input.ruleType,
        scope: input.scope as (typeof SUPPORTED_SCOPES)[number],
        scopeId: input.scopeId,
        thresholdConfig: input.thresholdConfig,
        destinationConfig: input.destinationConfig,
        status: input.status,
        actorUserId: ctx.session.user.id,
      });
      return toDto(created);
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        severity: severitySchema.optional(),
        ruleType: z.string().min(1).max(64).optional(),
        scope: scopeSchema.optional(),
        scopeId: z.string().min(1).optional(),
        thresholdConfig: z.record(z.string(), z.unknown()).optional(),
        destinationConfig: z.record(z.string(), z.unknown()).optional(),
        status: statusSchema.optional(),
      }),
    )
    .use(checkOrganizationPermission("anomalyRules:manage"))
    .use(enterpriseGate)
    .mutation(async ({ ctx, input }) => {
      const service = AnomalyRuleService.create(ctx.prisma);
      const updated = await service.updateRule({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        severity: input.severity as (typeof SUPPORTED_SEVERITIES)[number] | undefined,
        ruleType: input.ruleType,
        scope: input.scope as (typeof SUPPORTED_SCOPES)[number] | undefined,
        scopeId: input.scopeId,
        thresholdConfig: input.thresholdConfig,
        destinationConfig: input.destinationConfig,
        status: input.status,
      });
      return toDto(updated);
    }),

  archive: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("anomalyRules:manage"))
    .use(enterpriseGate)
    .mutation(async ({ ctx, input }) => {
      const service = AnomalyRuleService.create(ctx.prisma);
      const archived = await service.archive(
        input.id,
        input.organizationId,
      );
      return toDto(archived);
    }),
});
