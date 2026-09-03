// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for the People screen's identity half: the discovered-people
 * list, the review queue, the match button, and confirming a suggestion.
 * Reads gate on `governance:view`, the two writes on `governance:manage` —
 * the viewer grant reads, linking writes identity rows.
 *
 * The engine keeps no standing appointment of its own
 * (governance-identity-match-engine.feature); `runMatch` is the trigger the
 * engine spec left to the screen. One button runs both passes — proof, then
 * suggestions — because splitting them asks the user to know the engine's
 * internal seam between proof and guess.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */

import { GovernancePeopleScreenService } from "@ee/governance/services/governancePeopleScreen.service";
import {
  IdentityAlreadyLinkedError,
  IdentityErasedError,
  IdentityMatchSuggestionNotFoundError,
} from "@ee/governance/services/identityMatch.errors";
import { IdentityMatchService } from "@ee/governance/services/identityMatch.service";
import { IdentityMatchSuggestionService } from "@ee/governance/services/identityMatchSuggestion.service";
import { HandledError } from "@langwatch/handled-error";
import { TRPCError } from "@trpc/server";
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
      const suggested = await IdentityMatchSuggestionService.create(
        ctx.prisma,
      ).recompute({ organizationId: input.organizationId });
      return {
        linked: linked.linked,
        suspended: linked.suspended,
        unproven: linked.unproven,
        suggestionsWritten: suggested.suggestionsWritten,
      };
    }),

  confirmSuggestion: protectedProcedure
    .input(z.object({ organizationId: z.string(), suggestionId: z.string() }))
    .permission("governance:manage")
    .mutation(async ({ ctx, input }) => {
      try {
        return await IdentityMatchService.create(ctx.prisma).confirmSuggestion({
          organizationId: input.organizationId,
          suggestionId: input.suggestionId,
        });
      } catch (err) {
        throw mapError(err);
      }
    }),
});

/**
 * The engine's refusals shaped for the boundary, each with the code a client
 * can act on: a queue read before somebody else confirmed is a CONFLICT to
 * refresh past, a vanished suggestion is NOT_FOUND, and everything else keeps
 * its `cause` on the way to the logs.
 */
function mapError(err: unknown): Error {
  if (HandledError.isHandled(err)) {
    return err;
  }
  if (
    err instanceof IdentityAlreadyLinkedError ||
    err instanceof IdentityErasedError
  ) {
    return new TRPCError({
      code: "CONFLICT",
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof IdentityMatchSuggestionNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: err.message,
      cause: err,
    });
  }
  return err instanceof TRPCError
    ? err
    : new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: err });
}
