import { z } from "zod";

export const WORKBENCH_CHART_DEFINITION_VERSION = 1;
const MAX_LWQL_LENGTH = 50_000;
const MAX_PARAMETERS = 64;
const MAX_PARAMETER_NAME_LENGTH = 256;
const MAX_PARAMETER_VALUE_LENGTH = 4_000;

const parameterValueSchema = z.union([
  z.string().max(MAX_PARAMETER_VALUE_LENGTH),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const parametersSchema = z
  .record(z.string().max(MAX_PARAMETER_NAME_LENGTH), parameterValueSchema)
  .superRefine((parameters, context) => {
    const count = Object.keys(parameters).length;
    if (count > MAX_PARAMETERS) {
      context.addIssue({
        code: "too_big",
        origin: "object",
        maximum: MAX_PARAMETERS,
        inclusive: true,
      });
    }
  })
  .default({});

export const savedWorkbenchChartDefinitionSchema = z
  .object({
    version: z.literal(WORKBENCH_CHART_DEFINITION_VERSION),
    sql: z.string().min(1).max(MAX_LWQL_LENGTH),
    parameters: parametersSchema,
    vegaLiteSpec: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const savedWorkbenchChartIdSchema = z.string().min(1).max(64);
export const savedWorkbenchChartNameSchema = z.string().trim().min(1).max(255);

export type SavedWorkbenchChartDefinition = z.infer<
  typeof savedWorkbenchChartDefinitionSchema
>;

export const savedWorkbenchChartSchema = z
  .object({
    id: savedWorkbenchChartIdSchema,
    projectId: z.string().min(1),
    name: savedWorkbenchChartNameSchema,
    definition: savedWorkbenchChartDefinitionSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type SavedWorkbenchChart = z.infer<typeof savedWorkbenchChartSchema>;
