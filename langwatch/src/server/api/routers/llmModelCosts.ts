import { checkUserPermissionForProject, TeamRoleGroup } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { z } from "zod";
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
    .query(async ({ input }) => {
      return await getAllForProject(input);
    }),

  createModel: protectedProcedure
    .input(createModelInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .mutation(async ({ input }) => {
      return await createModel(input);
    }),

  updateField: protectedProcedure
    .input(updateFieldInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .mutation(async ({ input }) => {
      return await updateField(input);
    }),
});

export const getAllForProject = async (
  input: z.infer<typeof getAllForProjectInput>
) => {
  const importedData: Record<string, any> = llmModelCosts;
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
  const ownModels = llmModelCostsCustomData.filter(
    (record: any) => !Reflect.has(llmModelCosts, record.model)
  );

  const data = Object.keys(llmModelCosts)
    .filter(
      (key: string) =>
        Reflect.has(importedData[key], "input_cost_per_token") &&
        Reflect.has(importedData[key], "output_cost_per_token")
    )
    .map((key) => ({
      projectId: input.projectId,
      model: key,
      regex: customDataMap[key]?.regex || new RegExp(key),
      inputCostPerToken:
        customDataMap[key]?.inputCostPerToken ||
        importedData[key].input_cost_per_token,
      outputCostPerToken:
        customDataMap[key]?.outputCostPerToken ||
        importedData[key].output_cost_per_token,
      updatedAt: customDataMap[key]?.updatedAt,
    }))
    .concat(
      ownModels.map((record: any) => ({
        projectId: input.projectId,
        model: record.model,
        regex: record.regex,
        inputCostPerToken: record.inputCostPerToken,
        outputCostPerToken: record.outputCostPerToken,
        updatedAt: record.updatedAt,
        createdAt: record.createdAt,
      }))
    )
    .sort((a, b) => a.model.localeCompare(b.model));

  return data;
};

export const updateField = async (input: z.infer<typeof updateFieldInput>) => {
  const { projectId, model, field, value } = input;

  const exists = await prisma.customLLMModelCost.findUnique({
    where: {
      projectId_model: {
        projectId,
        model,
      },
      projectId,
      model,
    },
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
    where: {
      projectId_model: {
        projectId,
        model,
      },
      projectId,
      model,
    },
    data: {
      [field]: value,
    },
  });
};

export function createModel(input: z.infer<typeof createModelInput>) {
  const { projectId, model, inputCostPerToken, outputCostPerToken, regex } =
    input;

  return prisma.customLLMModelCost.create({
    data: {
      projectId,
      model,
      inputCostPerToken,
      outputCostPerToken,
      regex,
    },
  });
}
