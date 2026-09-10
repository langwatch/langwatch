// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for the governance cost screen (ADR-128 wave 1).
 *
 * RBAC: read-only, gated on `governanceCost:view` — its own org-exclusive
 * permission rather than `governance:view`, because reading what the
 * organization spends is a different capability from administering ingestion
 * and anomaly rules. A finance reviewer needs the figures and nothing else.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */

import { GovernanceCostService } from "@ee/governance/services/governanceCost.service";
import { declareAuthzMiddleware } from "@langwatch/authz";
import { z } from "zod/v4";

import {
  ENTERPRISE_FEATURE_ERRORS,
  requireEnterprisePlan,
} from "~/server/api/enterprise";
import {
  checkOrganizationPermission,
  type PermissionMiddlewareParams,
} from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";

const enterpriseGate = requireEnterprisePlan(
  ENTERPRISE_FEATURE_ERRORS.GOVERNANCE_COST,
);

/**
 * `YYYY-MM-DD` naming a day the calendar actually has.
 *
 * The shape alone is not enough. `2026-02-31` and `2026-99-99` both match the
 * pattern, and the read binds the value as a ClickHouse `Date`, so an
 * impossible day travels all the way to the driver and comes back as a parse
 * failure — a generic "unknown error" and a trace id for a rejection we can
 * name here, on the boundary, in one comparison.
 *
 * The round trip is what does the checking rather than the parse alone: it
 * holds whether or not the engine's ISO parser happens to range-check the day,
 * and it is what makes `2026-02-29` fail in a common year and pass in a leap
 * one without a calendar table.
 */
export function isUtcCalendarDay(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
  );
}

/**
 * The spender breakdown needs BOTH permissions: the figures are the cost
 * screen's (`governanceCost:view`) and the labels are the People screen's
 * (`governance:view`). A finance role holding only the cost permission gets
 * the lanes and not this — the cost permission buys figures, not names — and
 * an identity role without the cost permission gets no money either.
 */
function checkSpenderBreakdownPermissions() {
  const costCheck = checkOrganizationPermission("governanceCost:view");
  const identityCheck = checkOrganizationPermission("governance:view");
  return declareAuthzMiddleware(
    {
      kind: "custom",
      reason:
        "the spender breakdown joins cost figures to identity labels, so it is authorized only when the caller holds both screens' permissions",
      permissions: ["governanceCost:view", "governance:view"],
    },
    async (params: PermissionMiddlewareParams<{ organizationId: string }>) =>
      costCheck({ ...params, next: () => identityCheck(params) }),
  );
}

export const governanceCostRouter = createTRPCRouter({
  /**
   * The three lanes and their per-day series over the trailing window.
   */
  summary: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
      }),
    )
    .permission("governanceCost:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = GovernanceCostService.create({
        prisma: ctx.prisma,
        costRollup: getApp().governance.costRollup,
        ocsfEvents: getApp().governance.ocsfEvents,
      });
      return await service.summary({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
      });
    }),

  /**
   * The billed lane split by day AND provider over the window.
   *
   * Gated on the cost permission alone, like `summary` and unlike `spenders`:
   * a provider is not a person, so this joins no identity data and buying
   * figures is enough to see it.
   */
  dailyByProvider: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
      }),
    )
    .permission("governanceCost:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = GovernanceCostService.create({
        prisma: ctx.prisma,
        costRollup: getApp().governance.costRollup,
        ocsfEvents: getApp().governance.ocsfEvents,
      });
      return await service.dailyByProvider({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
      });
    }),

  /**
   * The billed lane split by model over the window, largest spend first.
   *
   * Gated on the cost permission alone, like `summary` and `dailyByProvider`
   * and unlike `spenders`: a model is not a person, so this joins no identity
   * data and buying figures is enough to see it.
   */
  spendByModel: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
      }),
    )
    .permission("governanceCost:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = GovernanceCostService.create({
        prisma: ctx.prisma,
        costRollup: getApp().governance.costRollup,
        ocsfEvents: getApp().governance.ocsfEvents,
      });
      return await service.spendByModel({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
      });
    }),

  /**
   * The records behind one day at one provider. Same grant as the figure they
   * explain — a reader allowed to see a total is allowed to see what it is
   * made of.
   */
  dayRecords: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        /** `YYYY-MM-DD`, the provider's business day in UTC. */
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(isUtcCalendarDay, "Not a day on the calendar."),
        provider: z.string(),
      }),
    )
    .permission("governanceCost:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = GovernanceCostService.create({
        prisma: ctx.prisma,
        costRollup: getApp().governance.costRollup,
        ocsfEvents: getApp().governance.ocsfEvents,
      });
      return await service.dayRecords({
        organizationId: input.organizationId,
        day: input.day,
        provider: input.provider,
      });
    }),

  /**
   * Who spent the pulled money over the window, labeled with the People
   * screen's words. See `checkSpenderBreakdownPermissions` for why this is
   * gated harder than `summary`.
   */
  spenders: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
      }),
    )
    .use(checkSpenderBreakdownPermissions())
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = GovernanceCostService.create({
        prisma: ctx.prisma,
        costRollup: getApp().governance.costRollup,
        ocsfEvents: getApp().governance.ocsfEvents,
      });
      return await service.spenderBreakdown({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
      });
    }),
});
