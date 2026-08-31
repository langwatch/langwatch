// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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

import {
  ANOMALY_RULE_SCOPES,
  ANOMALY_RULE_SEVERITIES,
} from "@langwatch/enterprise-governance-contract";
import { isZodLikeError, ValidationError } from "@langwatch/handled-error";
import { z } from "zod";

import { ENTERPRISE_FEATURE_ERRORS, requireEnterprisePlan } from "@langwatch/enterprise-plan-gate";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const enterpriseGate = requireEnterprisePlan(ENTERPRISE_FEATURE_ERRORS.ANOMALY_RULES);

/**
 * Translate threshold-config shape failures from the service layer into a
 * `ValidationError` that names which config the issues belong to.
 *
 * This used to build a `TRPCError` whose hand-composed message never reached
 * anyone. The formatter promotes a `ZodError` cause to
 * `ValidationError.fromZodError` and replaces the wire message with the code
 * slug, so `Invalid thresholdConfig for spend_spike: windowSec must be
 * positive` was discarded — and `fromZodError` files the issues under
 * `meta.fieldErrors` keyed `windowSec` / `ratioVsBaseline`, none of which the
 * registry knows how to name, with `formErrors` empty for path-bearing
 * issues. The admin read "Some of the values aren't valid." and nothing else.
 *
 * So the complaint is composed here and carried in `meta.formErrors`, which
 * the `validation_error` registry entry renders verbatim — the same shape
 * `assertPullSchedule` uses.
 *
 * Only ZodErrors are handled here. An unknown ruleType already arrives as a
 * `ValidationError` from `thresholdConfig.schema.ts`, so it falls through the
 * re-throw below and the boundary serialises it with its own `meta`.
 * Anything else re-throws unchanged so genuine internal errors stay visible.
 *
 * `isZodLikeError`, not `instanceof z.ZodError`, keeps this boundary coupled to
 * the portable error shape rather than a particular installed runtime instance.
 */
function translateConfigValidationError(err: unknown, ruleType?: string): never {
  if (isZodLikeError(err)) {
    // Detect which config the issues belong to so the error message
    // points the admin at the right field. Both threshold-config and
    // destination-config (Phase 2C C3) validation produce ZodError;
    // the issue paths disambiguate (`destinations[*]` for the dispatch
    // schema, scalar field names for threshold).
    const isDestinationConfig = err.issues.some((i) =>
      i.path.some((p) => p === "destinations"),
    );
    const configName = isDestinationConfig ? "destinationConfig" : "thresholdConfig";
    const complaint = `Invalid ${configName}${
      !isDestinationConfig && ruleType ? ` for ${ruleType}` : ""
    }: ${err.issues.map((i) => i.message).join("; ")}`;
    throw new ValidationError(complaint, {
      meta: { formErrors: [complaint] },
    });
  }
  throw err;
}

const severitySchema = z.enum(ANOMALY_RULE_SEVERITIES);
const scopeSchema = z.enum(ANOMALY_RULE_SCOPES);
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
    .permission("anomalyRules:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.app.governance.anomalyRuleList(input.organizationId);
      return rows.map(toDto);
    }),

  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("anomalyRules:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      return toDto(
        await ctx.app.governance.anomalyRuleGetById({
          id: input.id,
          organizationId: input.organizationId,
        }),
      );
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
    .permission("anomalyRules:manage")
    .use(enterpriseGate)
    .mutation(async ({ ctx, input }) => {
      try {
        const created = await ctx.app.governance.anomalyRuleCreate({
          organizationId: input.organizationId,
          name: input.name,
          description: input.description ?? null,
          severity: input.severity,
          ruleType: input.ruleType,
          scope: input.scope,
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
    .permission("anomalyRules:manage")
    .use(enterpriseGate)
    .mutation(async ({ ctx, input }) => {
      try {
        const updated = await ctx.app.governance.anomalyRuleUpdate({
          id: input.id,
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          severity: input.severity,
          ruleType: input.ruleType,
          scope: input.scope,
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
    .permission("anomalyRules:manage")
    .use(enterpriseGate)
    .mutation(async ({ ctx, input }) => {
      const archived = await ctx.app.governance.anomalyRuleArchive({
        id: input.id,
        organizationId: input.organizationId,
      });
      return toDto(archived);
    }),
});
