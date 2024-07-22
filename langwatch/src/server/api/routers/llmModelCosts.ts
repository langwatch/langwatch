import type { PrismaClient } from "@prisma/client";
import { checkUserPermissionForProject, TeamRoleGroup } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { z } from "zod";
import type { Session } from "next-auth";
import * as llmModelCosts from "./llmModelCosts.json";
import { prisma } from "~/server/db";

const getAllForProjectInput = z.object({
  projectId: z.string(),
});

const updateFieldInput = z.object({
  projectId: z.string(),
  model: z.string(),
  field: z.enum(["inputCostPerToken", "outputCostPerToken", "regex"]),
  value: z.union([z.string(), z.number()]).optional(),
});

const createModelInput = z.object({
  projectId: z.string(),
  model: z.string(),
  inputCostPerToken: z.number().optional(),
  outputCostPerToken: z.number().optional(),
  regex: z.string().optional(),
});

export const llmModelCostsRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(getAllForProjectInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .query(async ({ ctx, input }) => {
      return await getAllForProject(input, ctx);
    }),

  createModel: protectedProcedure
    .input(createModelInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT)),

  updateField: protectedProcedure
    .input(updateFieldInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .mutation(async ({ ctx, input }) => {
      return await updateField(input, ctx);
    }),
});

export const getAllForProject = async (
  input: z.infer<typeof getAllForProjectInput>,
  ctx?: { prisma: PrismaClient; session: Session }
) => {
  const llmModelCostsCustomData = await prisma.customLLMModelCost.findMany({
    where: { projectId: input.projectId },
  });
  const customDataMap = llmModelCostsCustomData.reduce(
    (acc, curr) => {
      acc[curr.model] = curr;
      return acc;
    },
    {} as Record<string, any>
  );
  console.log("llmModelCostsCustomData", llmModelCostsCustomData);
  const llmModelCostsOrigData = Object.keys(llmModelCosts)
    .filter(
      (key) =>
        Reflect.has(llmModelCosts[key], "input_cost_per_token") &&
        Reflect.has(llmModelCosts[key], "output_cost_per_token")
    )
    .map((key) => ({
      projectId: input.projectId,
      model: key,
      regex: customDataMap[key]?.regex || new RegExp(key),
      inputCostPerToken:
        customDataMap[key]?.inputCostPerToken ||
        llmModelCosts[key].input_cost_per_token,
      outputCostPerToken:
        customDataMap[key]?.outputCostPerToken ||
        llmModelCosts[key].output_cost_per_token,
    }));

  return llmModelCostsOrigData;
};

export const updateField = async (
  input: z.infer<typeof updateFieldInput>,
  ctx?: { prisma: PrismaClient; session: Session }
) => {
  const { projectId, model, field, value } = input;

  console.log("updateField", input);

  const exists = await prisma.customLLMModelCost.findUnique({
    where: { projectId, model },
  });

  if (!exists) {
    await prisma.customLLMModelCost.create({
      data: {
        projectId,
        model,
      } as any,
    });
  }

  await prisma.customLLMModelCost.update({
    where: { projectId, model },
    data: {
      [field]: value,
    },
  });
};

export function createModel(
  input: z.infer<typeof createModelInput>,
  ctx?: { prisma: PrismaClient; session: Session }
) {}
