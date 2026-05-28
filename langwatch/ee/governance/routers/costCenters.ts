// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for cost centers: org-scoped CRUD plus assignment of users,
 * teams, and projects. Reads gate on `governance:view`, writes on
 * `governance:manage`. Pure accounting — never an access gate.
 *
 * Spec: specs/ai-gateway/governance/cost-centers.feature
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  CostCenterNotFoundError,
  CostCenterService,
} from "@ee/governance/services/cost-center/costCenter.service";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const costCentersRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("governance:view"))
    .query(async ({ ctx, input }) => {
      return await CostCenterService.create(ctx.prisma).getAll({
        organizationId: input.organizationId,
      });
    }),

  assignments: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("governance:view"))
    .query(async ({ ctx, input }) => {
      return await CostCenterService.create(ctx.prisma).getAssignments({
        organizationId: input.organizationId,
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(128),
      }),
    )
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      return await CostCenterService.create(ctx.prisma).create({
        organizationId: input.organizationId,
        name: input.name,
      });
    }),

  rename: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128),
      }),
    )
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      try {
        return await CostCenterService.create(ctx.prisma).rename({
          id: input.id,
          organizationId: input.organizationId,
          name: input.name,
        });
      } catch (err) {
        throw mapError(err);
      }
    }),

  archive: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      try {
        await CostCenterService.create(ctx.prisma).archive({
          id: input.id,
          organizationId: input.organizationId,
        });
        return { ok: true };
      } catch (err) {
        throw mapError(err);
      }
    }),

  assignUser: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
        costCenterId: z.string().nullable(),
      }),
    )
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      try {
        await CostCenterService.create(ctx.prisma).assignUser(input);
        return { ok: true };
      } catch (err) {
        throw mapError(err);
      }
    }),

  assignTeam: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        teamId: z.string(),
        costCenterId: z.string().nullable(),
      }),
    )
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      try {
        await CostCenterService.create(ctx.prisma).assignTeam(input);
        return { ok: true };
      } catch (err) {
        throw mapError(err);
      }
    }),

  assignProject: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        projectId: z.string(),
        costCenterId: z.string().nullable(),
      }),
    )
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      try {
        await CostCenterService.create(ctx.prisma).assignProject(input);
        return { ok: true };
      } catch (err) {
        throw mapError(err);
      }
    }),
});

function mapError(err: unknown): TRPCError {
  if (err instanceof CostCenterNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  return err instanceof TRPCError
    ? err
    : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(err) });
}
