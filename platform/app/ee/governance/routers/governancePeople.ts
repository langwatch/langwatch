// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for the People screen's identity half: the discovered-people
 * list, the review queue, the match button, and confirming a suggestion.
 * Reads gate on `governance:view`, the two writes on `governance:manage` —
 * the viewer grant reads, linking writes identity rows.
 *
 * `runMatch` runs the PROOF pass only. The suggestion half scores names —
 * quadratic, and gated off every request path by the engine's import-graph
 * guard (ADR-128 §12) — so it rides the discovery feed on the worker role
 * instead; the composition root is its one caller. The button still gives a
 * reviewer fresh proof links on demand, and the suggestions list fills as
 * pulls deliver people.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */

import { GovernancePeopleScreenService } from "@ee/governance/services/governancePeopleScreen.service";
import { IdentityMatchService } from "@ee/governance/services/identityMatch.service";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const governancePeopleRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("governance:view")
    .query(async ({ ctx, input }) => {
      return await GovernancePeopleScreenService.create(ctx.prisma).listPeople({
        organizationId: input.organizationId,
      });
    }),

  suggestions: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("governance:view")
    .query(async ({ ctx, input }) => {
      return await GovernancePeopleScreenService.create(
        ctx.prisma,
      ).listSuggestions({ organizationId: input.organizationId });
    }),

  runMatch: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("governance:manage")
    .mutation(async ({ ctx, input }) => {
      const linked = await IdentityMatchService.create(
        ctx.prisma,
      ).linkProvenMatches({ organizationId: input.organizationId });
      return {
        linked: linked.linked,
        suspended: linked.suspended,
        unproven: linked.unproven,
      };
    }),

  confirmSuggestion: protectedProcedure
    .input(z.object({ organizationId: z.string(), suggestionId: z.string() }))
    .permission("governance:manage")
    .mutation(async ({ ctx, input }) => {
      // No error mapping here, unlike departments.ts: the engine's refusals
      // (already linked, erased, suggestion gone) all extend HandledError,
      // which the boundary formatter already serialises with its registered
      // code and remediation. A local instanceof map would be dead code the
      // HandledError check shadows.
      return await IdentityMatchService.create(ctx.prisma).confirmSuggestion({
        organizationId: input.organizationId,
        suggestionId: input.suggestionId,
      });
    }),
});
