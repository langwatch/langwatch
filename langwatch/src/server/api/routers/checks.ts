import { ZodError, z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkUserPermissionForProject } from "../permission";
import slugify from "slugify";
import { TRPCError } from "@trpc/server";
import {
  checksSchema,
  customCheckPreconditionsSchema,
} from "../../../trace_checks/types.generated";

export const checksRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject)
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const checks = await prisma.check.findMany({
        where: { projectId },
      });

      return checks;
    }),
  toggle: protectedProcedure
    .input(
      z.object({ id: z.string(), projectId: z.string(), enabled: z.boolean() })
    )
    .use(checkUserPermissionForProject)
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
        preconditions: z.array(z.any()).optional(),
        parameters: z.object({}).passthrough(),
      })
    )
    .use(checkUserPermissionForProject)
    .mutation(async ({ input, ctx }) => {
      const { projectId, name, checkType, preconditions, parameters } = input;
      const prisma = ctx.prisma;
      const slug = slugify(name, { lower: true, strict: true });

      validateCheckParameters(checkType, parameters);

      const newCheck = await prisma.check.create({
        data: {
          projectId,
          name,
          checkType,
          slug,
          preconditions,
          parameters,
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
        preconditions: z.array(z.any()).optional(),
        parameters: z.object({}).passthrough(),
        enabled: z.boolean().optional(),
      })
    )
    .use(checkUserPermissionForProject)
    .mutation(async ({ input, ctx }) => {
      const {
        id,
        projectId,
        name,
        checkType,
        preconditions,
        parameters,
        enabled,
      } = input;
      const prisma = ctx.prisma;
      const slug = slugify(name, { lower: true, strict: true });

      validateCheckParameters(checkType, parameters);

      const updatedCheck = await prisma.check.update({
        where: { id, projectId },
        data: {
          name,
          checkType,
          slug,
          preconditions,
          parameters,
          ...(enabled !== undefined && { enabled }),
        },
      });

      return updatedCheck;
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkUserPermissionForProject)
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
    .use(checkUserPermissionForProject)
    .mutation(async ({ input, ctx }) => {
      const { id, projectId } = input;
      const prisma = ctx.prisma;

      await prisma.check.delete({
        where: { id, projectId },
      });

      return { success: true };
    }),
});

const validateCheckParameters = (checkType: string, parameters: any) => {
  if (checkType === "custom") {
    try {
      checksSchema.shape[checkType].shape.parameters.parse(parameters);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid custom check parameters: ${error as any}`,
        });
      } else {
        throw error;
      }
    }
  }
};
