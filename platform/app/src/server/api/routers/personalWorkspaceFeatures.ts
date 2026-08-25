/**
 * tRPC router for the personal-workspace progressive feature unlock.
 *
 * Distinct from project-level RBAC routers — these procedures are
 * authorised solely by the caller being the `ownerUserId` of the
 * personal project. No org-level permission required, because the
 * personal project IS the caller's by construction (mirrors the
 * `personalVirtualKeys` router pattern).
 *
 * The bundle is a UI/nav predicate, NOT an auth gate: the underlying
 * tRPC routers (`datasets.*`, `evaluations.*`, etc.) stay open even
 * when the bundle is off. Disabling hides nav, never deletes data.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-features.feature
 */

import {
  PERSONAL_FEATURES,
  PersonalProjectNotFoundError,
  PersonalProjectOwnerMismatchError,
} from "@langwatch/organization-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const featureSchema = z.enum(
  PERSONAL_FEATURES as readonly [string, ...string[]],
);

void featureSchema;

export const personalWorkspaceFeaturesRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .noPermission({
      reason: "a personal workspace belongs to its owner, not a team",
      allow: {
        projectId:
          "auth is service-layer (PersonalWorkspaceFeaturesService asserts isPersonal && ownerUserId === caller)",
      },
    })
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.app.organizations.getPersonalWorkspaceFeatures({
          projectId: input.projectId,
          callerUserId: ctx.session.user.id,
        });
      } catch (err) {
        if (
          err instanceof PersonalProjectNotFoundError ||
          err instanceof PersonalProjectOwnerMismatchError
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),

  enableAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .noPermission({
      reason: "a personal workspace belongs to its owner, not a team",
      allow: {
        projectId:
          "auth is service-layer (PersonalWorkspaceFeaturesService asserts isPersonal && ownerUserId === caller)",
      },
    })
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.organizations.enableAllPersonalWorkspaceFeatures({
          projectId: input.projectId,
          callerUserId: ctx.session.user.id,
        });
      } catch (err) {
        if (
          err instanceof PersonalProjectNotFoundError ||
          err instanceof PersonalProjectOwnerMismatchError
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),

  disableAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .noPermission({
      reason: "a personal workspace belongs to its owner, not a team",
      allow: {
        projectId:
          "auth is service-layer (PersonalWorkspaceFeaturesService asserts isPersonal && ownerUserId === caller)",
      },
    })
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.organizations.disableAllPersonalWorkspaceFeatures({
          projectId: input.projectId,
          callerUserId: ctx.session.user.id,
        });
      } catch (err) {
        if (
          err instanceof PersonalProjectNotFoundError ||
          err instanceof PersonalProjectOwnerMismatchError
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),
});
