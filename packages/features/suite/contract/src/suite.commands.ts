import { z } from "zod";
import { suiteTargetSchema } from "./suite";
import { suiteScopeSchema } from "./suite.scope";

const suiteDefinitionFieldsSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    scenarioIds: z.array(z.string().min(1)),
    scope: suiteScopeSchema.optional(),
    targets: z.array(suiteTargetSchema),
    repeatCount: z.number().int().min(1).max(100),
    labels: z.array(z.string()),
    simulatorModel: z.string().nullable().optional(),
    judgeModel: z.string().nullable().optional(),
  })
  .strict();

export const createSuiteCommandSchema = suiteDefinitionFieldsSchema
  .extend({
    scenarioIds: suiteDefinitionFieldsSchema.shape.scenarioIds.default([]),
    targets: suiteDefinitionFieldsSchema.shape.targets.default([]),
    repeatCount: suiteDefinitionFieldsSchema.shape.repeatCount.default(1),
    labels: suiteDefinitionFieldsSchema.shape.labels.default([]),
  })
  .superRefine((input, context) => {
    const usesStoredCases = input.scope === void 0 || input.scope.mode === "cases";
    if (usesStoredCases && input.scenarioIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["scenarioIds"],
        message: "At least one scenario is required",
      });
    }
  });
export type CreateSuiteCommand = z.input<typeof createSuiteCommandSchema>;

export const updateSuiteCommandSchema = suiteDefinitionFieldsSchema
  .omit({ projectId: true })
  .partial()
  .extend({ id: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export type UpdateSuiteCommand = z.input<typeof updateSuiteCommandSchema>;

export const suiteIdInputSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();
export type SuiteIdInput = z.infer<typeof suiteIdInputSchema>;
