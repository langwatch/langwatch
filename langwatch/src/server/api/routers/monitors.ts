import { EvaluationExecutionMode } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { customAlphabet } from "nanoid";
import { ZodError, z } from "zod";
import { slugify } from "~/utils/slugify";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../evaluations/evaluators.zod.generated";
import { checkPreconditionsSchema } from "../../evaluations/types.generated";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Generates a unique slug for a monitor.
 * Format: slugified-name-XXXXX (where XXXXX is a 5-char nanoid)
 * This ensures uniqueness even when creating multiple monitors with the same name.
 */
const generateMonitorSlug = (name: string): string => {
  const nanoidShort = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 5);
  const baseSlug = slugify(name);
  return baseSlug ? `${baseSlug}-${nanoidShort()}` : nanoidShort();
};

/**
 * Finds a unique name for a monitor by appending (2), (3), etc. if needed.
 * Checks existing monitors in the project to avoid conflicts.
 */
const findUniqueMonitorName = async (
  prisma: { monitor: { findFirst: (args: { where: { projectId: string; name: string } }) => Promise<unknown>; findMany: (args: { where: { projectId: string; name: { startsWith: string } }; select: { name: true } }) => Promise<{ name: string }[]> } },
  projectId: string,
  baseName: string,
): Promise<string> => {
  // First, check if the base name is available
  const existing = await prisma.monitor.findFirst({
    where: { projectId, name: baseName },
  });

  if (!existing) {
    return baseName;
  }

  // Find all monitors with names like "baseName" or "baseName (N)"
  const pattern = `${baseName} (`;
  const existingWithSuffix = await prisma.monitor.findMany({
    where: {
      projectId,
      name: { startsWith: pattern },
    },
    select: { name: true },
  });

  // Extract the numbers from existing names
  const usedNumbers = new Set<number>();
  usedNumbers.add(1); // Base name counts as (1)

  for (const monitor of existingWithSuffix) {
    const match = monitor.name.match(/\((\d+)\)$/);
    if (match?.[1]) {
      usedNumbers.add(parseInt(match[1], 10));
    }
  }

  // Find the next available number
  let nextNumber = 2;
  while (usedNumbers.has(nextNumber)) {
    nextNumber++;
  }

  return `${baseName} (${nextNumber})`;
};

export const monitorsRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const checks = await prisma.monitor.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
        include: { evaluator: true },
      });

      return checks;
    }),
  toggle: protectedProcedure
    .input(
      z.object({ id: z.string(), projectId: z.string(), enabled: z.boolean() }),
    )
    .use(checkProjectPermission("evaluations:update"))
    .mutation(async ({ input, ctx }) => {
      const { id, enabled, projectId } = input;
      const prisma = ctx.prisma;

      await prisma.monitor.update({
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
        mappings: z.object({}).passthrough().optional(),
        sample: z.number().min(0).max(1),
        executionMode: z.enum([
          EvaluationExecutionMode.ON_MESSAGE,
          EvaluationExecutionMode.AS_GUARDRAIL,
          EvaluationExecutionMode.MANUALLY,
        ]),
        evaluatorId: z.string().optional(),
        level: z.enum(["trace", "thread"]).optional(), // Evaluation level: trace or thread
        threadIdleTimeout: z.number().int().positive().nullable().optional(), // Seconds to wait after last message before evaluating thread
      }),
    )
    .use(checkProjectPermission("evaluations:create"))
    .mutation(async ({ input, ctx }) => {
      const {
        projectId,
        name,
        checkType,
        preconditions,
        settings: parameters,
        mappings,
        sample,
        executionMode,
        evaluatorId,
        level,
        threadIdleTimeout,
      } = input;
      const prisma = ctx.prisma;

      // Validate evaluator exists and belongs to project if provided
      if (evaluatorId) {
        const evaluator = await prisma.evaluator.findFirst({
          where: { id: evaluatorId, projectId, archivedAt: null },
        });
        if (!evaluator) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Evaluator not found or does not belong to this project",
          });
        }
      }

      validateCheckSettings(checkType, parameters);

      // Find a unique name (appends (2), (3), etc. if needed)
      const uniqueName = await findUniqueMonitorName(prisma, projectId, name);
      // Slug uses nanoid for true uniqueness
      const slug = generateMonitorSlug(name);

      const newCheck = await prisma.monitor.create({
        data: {
          id: generate(KSUID_RESOURCES.MONITOR).toString(),
          projectId,
          name: uniqueName,
          checkType,
          slug,
          preconditions,
          parameters,
          mappings: mappings ?? {},
          sample,
          enabled: true,
          executionMode,
          evaluatorId,
          level: level ?? "trace",
          threadIdleTimeout,
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
        evaluatorId: z.string().nullable().optional(),
        level: z.enum(["trace", "thread"]).optional(), // Evaluation level: trace or thread
        threadIdleTimeout: z.number().int().positive().nullable().optional(), // Seconds to wait after last message before evaluating thread
      }),
    )
    .use(checkProjectPermission("evaluations:update"))
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
        evaluatorId,
        level,
        threadIdleTimeout,
      } = input;
      const prisma = ctx.prisma;
      const slug = slugify(name, { lower: true, strict: true });

      // Validate evaluator exists and belongs to project if provided
      if (evaluatorId) {
        const evaluator = await prisma.evaluator.findFirst({
          where: { id: evaluatorId, projectId, archivedAt: null },
        });
        if (!evaluator) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Evaluator not found or does not belong to this project",
          });
        }
      }

      validateCheckSettings(checkType, parameters);

      const updatedCheck = await prisma.monitor.update({
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
          ...(evaluatorId !== undefined && { evaluatorId }),
          ...(level !== undefined && { level }),
          ...(threadIdleTimeout !== undefined && { threadIdleTimeout }),
        },
      });

      return updatedCheck;
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ input, ctx }) => {
      const { id, projectId } = input;
      const prisma = ctx.prisma;

      const check = await prisma.monitor.findUnique({
        where: { id, projectId },
        include: { evaluator: true },
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
    .use(checkProjectPermission("evaluations:delete"))
    .mutation(async ({ input, ctx }) => {
      const { id, projectId } = input;
      const prisma = ctx.prisma;

      await prisma.monitor.delete({
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
      }),
    )
    .use(checkProjectPermission("evaluations:view"))
    .mutation(async ({ input, ctx }) => {
      const { projectId, name } = input;
      const prisma = ctx.prisma;

      const check = await prisma.monitor.findFirst({
        where: { projectId, name },
      });

      return { available: check === null || check.id === input.checkId };
    }),
});

const validateCheckSettings = (checkType: string, parameters: any) => {
  if (
    AVAILABLE_EVALUATORS[checkType as EvaluatorTypes] === undefined &&
    !checkType.startsWith("custom/")
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid checkType",
    });
  }

  if (!checkType.startsWith("custom/")) {
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
  }
};
