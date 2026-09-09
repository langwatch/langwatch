// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for the Agents screen: the organization's agents, from both
 * origins, as one list.
 *
 * Organization-scoped rather than project-scoped, which is the point. The
 * platform's other agents read (`agents.getAll`) is scoped to one project and
 * gated on `evaluations:view`; reading one project through it and labelling
 * the result as the organization's is the lie this page refused to tell for as
 * long as it fetched nothing.
 *
 * Read-only on `governance:view`. Nothing here writes, and the sync that fills
 * `DiscoveredAgent` is its own path on its own grant.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import { GovernanceAgentsScreenService } from "@ee/governance/services/governanceAgentsScreen.service";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const governanceAgentsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("governance:view")
    .query(async ({ ctx, input }) => {
      return await GovernanceAgentsScreenService.create(ctx.prisma).listAgents({
        organizationId: input.organizationId,
      });
    }),
});
