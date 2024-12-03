import { ZodError, z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../../api/trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import slugify from "slugify";
import { TRPCError } from "@trpc/server";
import { checkPreconditionsSchema } from "../../evaluations/types.generated";
import { nanoid } from "nanoid";
import { evaluatorsSchema } from "../../evaluations/evaluators.zod.generated";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../../server/evaluations/evaluators.generated";
import { EvaluationExecutionMode } from "@prisma/client";

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
        executionMode: z.enum([
          EvaluationExecutionMode.ON_MESSAGE,
          EvaluationExecutionMode.AS_GUARDRAIL,
          EvaluationExecutionMode.MANUALLY,
        ]),
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
        executionMode,
      } = input;
      const prisma = ctx.prisma;
      const slug = slugify(name, { lower: true, strict: true });

      validateCheckSettings(checkType, parameters);

      const newCheck = await prisma.check.create({
        data: {
          id: `eval_${nanoid()}`,
          projectId,
          name,
          checkType,
          slug,
          preconditions,
          parameters,
          sample,
          enabled: true,
          executionMode,
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
        mappings: z.object({}).passthrough(),
        sample: z.number().min(0).max(1),
        enabled: z.boolean().optional(),
        executionMode: z.enum([
          EvaluationExecutionMode.ON_MESSAGE,
          EvaluationExecutionMode.AS_GUARDRAIL,
          EvaluationExecutionMode.MANUALLY,
        ]),
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
        executionMode,
        mappings,
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
          executionMode,
          mappings,
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
  isNameAvailable: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        checkId: z.string().optional(),
        name: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .mutation(async ({ input, ctx }) => {
      const { projectId, name } = input;
      const prisma = ctx.prisma;

      const check = await prisma.check.findFirst({
        where: { projectId, name },
      });

      return { available: check === null || check.id === input.checkId };
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
