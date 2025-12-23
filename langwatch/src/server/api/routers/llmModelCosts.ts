import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "~/server/db";
import { getModelLimits } from "../../../utils/modelLimits";
import { getLLMModelCosts } from "../../modelProviders/llmModelCost";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const llmModelCostsRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(async ({ input }) => {
      return await getLLMModelCosts(input);
    }),

  createOrUpdate: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        model: z.string(),
        inputCostPerToken: z.number().optional(),
        outputCostPerToken: z.number().optional(),
        regex: z.string().refine((value) => isValidRegex(value), {
          message: "Invalid regular expression",
        }),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input }) => {
      const {
        id,
        projectId,
        model,
        inputCostPerToken,
        outputCostPerToken,
        regex,
      } = input;

      if (!id) {
        return prisma.customLLMModelCost.create({
          data: {
            id: `llmcost_${nanoid()}`,
            projectId,
            model,
            inputCostPerToken,
            outputCostPerToken,
            regex,
          },
        });
      }

      return prisma.customLLMModelCost.update({
        where: {
          id,
          projectId,
        },
        data: {
          model,
          inputCostPerToken,
          outputCostPerToken,
          regex,
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkProjectPermission("project:delete"))
    .mutation(async ({ input }) => {
      return await prisma.customLLMModelCost.delete({
        where: { id: input.id, projectId: input.projectId },
      });
    }),

  /**
   * Get model limits for a given model
   * TODO: This doesn't need to be protected, but TRPC throws without it
   * @param input - Input containing the project ID and model name
   * @returns Model limits or null if not found
   */
  getModelLimits: protectedProcedure
    .input(z.object({ projectId: z.string(), model: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input }) => getModelLimits(input.model)),
});

const isValidRegex = (pattern: string): boolean => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};
