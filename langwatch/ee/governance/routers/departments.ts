// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for departments: org-scoped CRUD plus assignment of users,
 * teams, and projects. Reads gate on `governance:view`, writes on
 * `governance:manage`. Pure accounting - never an access gate.
 *
 * Spec: specs/ai-gateway/governance/departments.feature
 */

import {
  DepartmentAssignmentTargetNotFoundError,
  DepartmentNotFoundError,
  DepartmentService,
} from "@ee/governance/services/department/department.service";
import { HandledError } from "@langwatch/handled-error";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const departmentsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("governance:view"))
    .query(async ({ ctx, input }) => {
      return await DepartmentService.create(ctx.prisma).getAll({
        organizationId: input.organizationId,
      });
    }),

  assignments: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("governance:view"))
    .query(async ({ ctx, input }) => {
      return await DepartmentService.create(ctx.prisma).getAssignments({
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
      return await DepartmentService.create(ctx.prisma).create({
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
        return await DepartmentService.create(ctx.prisma).rename({
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
        await DepartmentService.create(ctx.prisma).archive({
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
        departmentId: z.string().nullable(),
      }),
    )
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      try {
        await DepartmentService.create(ctx.prisma).assignUser(input);
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
        departmentId: z.string().nullable(),
      }),
    )
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      try {
        await DepartmentService.create(ctx.prisma).assignTeam(input);
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
        departmentId: z.string().nullable(),
      }),
    )
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      try {
        await DepartmentService.create(ctx.prisma).assignProject(input);
        return { ok: true };
      } catch (err) {
        throw mapError(err);
      }
    }),
});

/**
 * The one place a department mutation's failure is shaped for the boundary.
 *
 * The `String(err)` fallback used to be a dead end: it built a fresh
 * `TRPCError` with no `cause`, so anything raised below it — including a
 * `HandledError` that already knew its own code, status and remediation —
 * was flattened into an unnamed 500. The formatter's
 * `HandledError.isHandled(error.cause)` check could never fire, and OTel and
 * the logger lost the original error object along with it.
 *
 * So: a handled error passes through untouched and the boundary serialises
 * it. Everything else keeps `cause`, which is what carries the real error to
 * the logs and degrades honestly to "unknown" with a trace id — no
 * `String(err)` message, which only ever leaked internals into copy.
 */
function mapError(err: unknown): Error {
  if (HandledError.isHandled(err)) {
    return err;
  }
  if (
    err instanceof DepartmentNotFoundError ||
    err instanceof DepartmentAssignmentTargetNotFoundError
  ) {
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
