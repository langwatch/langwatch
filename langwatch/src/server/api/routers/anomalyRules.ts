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

/**
 * Translate threshold-config validation failures from the service
 * layer into a TRPCError BAD_REQUEST. Mirrors the aiTools router
 * pattern (`5a3219ae0`). Two error shapes are expected:
 *   - z.ZodError when the config shape is wrong (missing fields, wrong
 *     types, negative numbers)
 *   - plain Error when ruleType is unknown
 *
 * Anything else re-throws unchanged so genuine internal errors stay
 * visible.
 */
function translateConfigValidationError(err: unknown, ruleType?: string): never {
  if (err instanceof z.ZodError) {
    // Detect which config the issues belong to so the error message
    // points the admin at the right field. Both threshold-config and
    // destination-config (Phase 2C C3) validation produce ZodError;
    // the issue paths disambiguate (`destinations[*]` for the dispatch
    // schema, scalar field names for threshold).
    const isDestinationConfig = err.issues.some((i) =>
      i.path.some((p) => p === "destinations"),
    );
    const configName = isDestinationConfig
      ? "destinationConfig"
      : "thresholdConfig";
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid ${configName}${
        !isDestinationConfig && ruleType ? ` for ${ruleType}` : ""
      }: ${err.issues.map((i) => i.message).join("; ")}`,
      cause: err,
    });
  }
  if (
    err instanceof Error &&
    /Unsupported ruleType/i.test(err.message)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

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
      try {
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
      } catch (err) {
        throw translateConfigValidationError(err, input.ruleType);
      }
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
      try {
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
      } catch (err) {
        throw translateConfigValidationError(err, input.ruleType);
      }
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
