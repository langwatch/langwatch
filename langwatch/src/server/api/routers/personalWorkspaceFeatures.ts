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
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  PERSONAL_FEATURES,
  PersonalProjectNotFoundError,
  PersonalProjectOwnerMismatchError,
  PersonalWorkspaceFeaturesService,
} from "@ee/governance/services/personalWorkspaceFeatures.service";

import { skipPermissionCheck } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const featureSchema = z.enum(
  PERSONAL_FEATURES as readonly [string, ...string[]],
);

void featureSchema;

const allowProjectIdForOwnerUserGate = skipPermissionCheck({
  allow: {
    projectId:
      "auth is service-layer (PersonalWorkspaceFeaturesService asserts isPersonal && ownerUserId === caller)",
  },
});

export const personalWorkspaceFeaturesRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(allowProjectIdForOwnerUserGate)
    .query(async ({ ctx, input }) => {
      const service = PersonalWorkspaceFeaturesService.create(ctx.prisma);
      try {
        return await service.get({
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
    .use(allowProjectIdForOwnerUserGate)
    .mutation(async ({ ctx, input }) => {
      const service = PersonalWorkspaceFeaturesService.create(ctx.prisma);
      try {
        return await service.enableAll({
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
    .use(allowProjectIdForOwnerUserGate)
    .mutation(async ({ ctx, input }) => {
      const service = PersonalWorkspaceFeaturesService.create(ctx.prisma);
      try {
        return await service.disableAll({
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
