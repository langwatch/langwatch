import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "~/server/db";
import { getLLMModelCosts } from "../../modelProviders/llmModelCost";
import { checkUserPermissionForProject, TeamRoleGroup } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const llmModelCostsRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .mutation(async ({ input }) => {
      return await prisma.customLLMModelCost.delete({
        where: { id: input.id, projectId: input.projectId },
      });
    }),
});

const isValidRegex = (pattern: string): boolean => {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
};
