import { ZodError, z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import slugify from "slugify";
import { TRPCError } from "@trpc/server";
import { checkPreconditionsSchema } from "../../../trace_checks/types.generated";
import { nanoid } from "nanoid";
import { evaluatorsSchema } from "../../../trace_checks/evaluators.zod.generated";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../../trace_checks/evaluators.generated";

export const checksRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const checks = await prisma.check.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      });

      return checks;
    }),
  toggle: protectedProcedure
    .input(
      z.object({ id: z.string(), projectId: z.string(), enabled: z.boolean() })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .mutation(async ({ input, ctx }) => {
      const { id, enabled, projectId } = input;
      const prisma = ctx.prisma;

      await prisma.check.update({
        where: { id, projectId },
        data: { enabled },
      });

      return { success: true };
    }),
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        checkType: z.string(),
        preconditions: checkPreconditionsSchema,
        settings: z.object({}).passthrough(),
        sample: z.number().min(0).max(1),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .mutation(async ({ input, ctx }) => {
      const {
        projectId,
        name,
        checkType,
        preconditions,
        settings: parameters,
        sample,
      } = input;
      const prisma = ctx.prisma;
      const slug = slugify(name, { lower: true, strict: true });

      validateCheckSettings(checkType, parameters);

      const newCheck = await prisma.check.create({
        data: {
          id: `check_${nanoid()}`,
          projectId,
          name,
          checkType,
          slug,
          preconditions,
          parameters,
          sample,
          enabled: true,
        },
      });

      return newCheck;
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        checkType: z.string(),
        preconditions: checkPreconditionsSchema,
        settings: z.object({}).passthrough(),
        sample: z.number().min(0).max(1),
        enabled: z.boolean().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .mutation(async ({ input, ctx }) => {
      const {
        id,
        projectId,
        name,
        checkType,
        preconditions,
        settings: parameters,
        sample,
        enabled,
      } = input;
      const prisma = ctx.prisma;
      const slug = slugify(name, { lower: true, strict: true });

      validateCheckSettings(checkType, parameters);

      const updatedCheck = await prisma.check.update({
        where: { id, projectId },
        data: {
          name,
          checkType,
          slug,
          preconditions,
          parameters,
          sample,
          ...(enabled !== undefined && { enabled }),
        },
      });

      return updatedCheck;
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_VIEW))
    .query(async ({ input, ctx }) => {
      const { id, projectId } = input;
      const prisma = ctx.prisma;

      const check = await prisma.check.findUnique({
        where: { id, projectId },
      });

      if (!check) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "TraceCheck config not found",
        });
      }

      return check;
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .mutation(async ({ input, ctx }) => {
      const { id, projectId } = input;
      const prisma = ctx.prisma;

      await prisma.check.delete({
        where: { id, projectId },
      });

      return { success: true };
    }),
});

const validateCheckSettings = (checkType: string, parameters: any) => {
  if (AVAILABLE_EVALUATORS[checkType as EvaluatorTypes] === undefined) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid checkType",
    });
  }

  const checkType_ = checkType as EvaluatorTypes;

  try {
    evaluatorsSchema.shape[checkType_].shape.settings.parse(parameters);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid settings: ${error as any}`,
      });
    } else {
      throw error;
    }
  }
};
