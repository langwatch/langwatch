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
import { z } from "zod/v4";

import {
  ENTERPRISE_FEATURE_ERRORS,
  requireEnterprisePlan,
} from "~/server/api/enterprise";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";

const enterpriseGate = requireEnterprisePlan(
  ENTERPRISE_FEATURE_ERRORS.GOVERNANCE_COST,
);

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
      });
      return await service.summary({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
      });
    }),
});
