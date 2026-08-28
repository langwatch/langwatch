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

export const savedWorkbenchChartDefinitionSchema = z.object({
  version: z.literal(WORKBENCH_CHART_DEFINITION_VERSION),
  sql: z.string().min(1).max(MAX_LWQL_LENGTH),
  parameters: parametersSchema,
  vegaLiteSpec: z.record(z.string(), z.unknown()).optional(),
});

export const savedWorkbenchChartIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "id must be 1-64 letters, digits, '_' or '-'");
export const savedWorkbenchChartNameSchema = z.string().trim().min(1).max(255);

const MAX_GRID_COORDINATE = 2_000_000_000;

export const savedWorkbenchChartPlacementSchema = z
  .object({
    dashboardId: z.string().min(1),
    gridColumn: z.number().int().min(0).max(1).optional(),
    gridRow: z.number().int().min(0).max(MAX_GRID_COORDINATE).optional(),
    colSpan: z.number().int().min(1).max(2).optional(),
    rowSpan: z.number().int().min(1).max(2).optional(),
  })
  .refine(({ gridColumn = 0, colSpan = 1 }) => gridColumn + colSpan <= 2, {
    message: "gridColumn + colSpan must not exceed the 2-column grid",
    path: ["colSpan"],
  });
export type SavedWorkbenchChartPlacement = z.infer<typeof savedWorkbenchChartPlacementSchema>;

export type SavedWorkbenchChartDefinition = z.infer<typeof savedWorkbenchChartDefinitionSchema>;

export const savedWorkbenchChartSchema = z
  .object({
    id: savedWorkbenchChartIdSchema,
    projectId: z.string().min(1),
    name: savedWorkbenchChartNameSchema,
    definition: savedWorkbenchChartDefinitionSchema,
    dashboardId: z.string().min(1).nullable(),
    gridColumn: z.number().int().nonnegative(),
    gridRow: z.number().int().nonnegative(),
    colSpan: z.number().int().positive(),
    rowSpan: z.number().int().positive(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type SavedWorkbenchChart = z.infer<typeof savedWorkbenchChartSchema>;
