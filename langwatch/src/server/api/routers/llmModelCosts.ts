import { checkUserPermissionForProject, TeamRoleGroup } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { z } from "zod";
import * as llmModelCosts from "./llmModelCosts.json";
import { prisma } from "~/server/db";
import escapeStringRegexp from "escape-string-regexp";

const getAllForProjectInput = z.object({
  projectId: z.string(),
});

const updateFieldInput = z.object({
  id: z.string(),
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
  regex: z.string(),
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

export const getImportedModelCosts = () => {
  type ImportedLLMModelCost =
    (typeof llmModelCosts)[keyof typeof llmModelCosts];

  const models: Record<string, ImportedLLMModelCost> = llmModelCosts;

  // Filter only models based on input and output costs per token
  const tokenModels: Record<
    string,
    {
      inputCostPerToken: number;
      outputCostPerToken: number;
    }
  > = Object.fromEntries(
    Object.entries(models)
      .filter(
        ([_, model]) =>
          "input_cost_per_token" in model &&
          "output_cost_per_token" in model &&
          typeof model.input_cost_per_token === "number" &&
          typeof model.output_cost_per_token === "number"
      )
      .map(([model_name, model]) => {
        const model_ = model as {
          input_cost_per_token: number;
          output_cost_per_token: number;
        };

        return [
          model_name,
          {
            inputCostPerToken: model_.input_cost_per_token,
            outputCostPerToken: model_.output_cost_per_token,
          },
        ];
      })
  );

  // Exclude models with : after it if there is already the same model there without the :
  const mergedModels = Object.entries(tokenModels)
    .filter(([model_name, _]) => {
      if (
        model_name.includes(":") &&
        model_name.split(":")[0]! in tokenModels
      ) {
        return false;
      }
      return true;
    })
    .map(([model_name, model]) => {
      return {
        model: model_name,
        inputCostPerToken: model.inputCostPerToken,
        outputCostPerToken: model.outputCostPerToken,
      };
    });

  // Exclude models with no costs
  const paidModels = mergedModels.filter(
    (model) => !!model.inputCostPerToken || !!model.outputCostPerToken
  );

  // Exclude some vendors
  const relevantModels = paidModels.filter(
    (model) => !model.model.includes("openrouter/")
  );

  return Object.fromEntries(
    relevantModels.map((model) => [model.model, model])
  );
};

export type MaybeStoredLLMModelCost = {
  id?: string;
  projectId: string;
  model: string;
  regex: string;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  updatedAt?: Date;
  createdAt?: Date;
};

export const getAllForProject = async (
  input: z.infer<typeof getAllForProjectInput>
): Promise<MaybeStoredLLMModelCost[]> => {
  const importedData = getImportedModelCosts();
  const llmModelCostsCustomData = await prisma.customLLMModelCost.findMany({
    where: { projectId: input.projectId },
  });
  // const customDataMap = llmModelCostsCustomData.reduce(
  //   (acc, curr) => {
  //     acc[curr.model] = curr;
  //     return acc;
  //   },
  //   {} as Record<string, CustomLLMModelCost>
  // );
  const ownModels = llmModelCostsCustomData.filter(
    (record) => !importedData[record.model]
  );

  const data = ownModels
    .map(
      (record) =>
        ({
          id: record.id,
          projectId: input.projectId,
          model: record.model,
          regex: record.regex,
          inputCostPerToken: record.inputCostPerToken ?? undefined,
          outputCostPerToken: record.outputCostPerToken ?? undefined,
          updatedAt: record.updatedAt,
          createdAt: record.createdAt,
        }) as MaybeStoredLLMModelCost
    )
    .concat(
      Object.entries(importedData).map(([key, value]) => ({
        projectId: input.projectId,
        model: key,
        regex: escapeStringRegexp(key)
          .replaceAll("\\x2d", "-")
          .replaceAll("/", "\\/"),
        inputCostPerToken: value.inputCostPerToken,
        outputCostPerToken: value.outputCostPerToken,
      }))
    )
    .sort((a, b) => a.model.localeCompare(b.model));

  return data;
};

export const updateField = async (input: z.infer<typeof updateFieldInput>) => {
  const { projectId, model, field, value } = input;

  const exists = await prisma.customLLMModelCost.findUnique({
    where: {
      id: input.id,
      projectId,
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
      id: input.id,
      projectId,
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
