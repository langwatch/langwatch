/** The saved-workbench-chart REST family's wire shapes. Spec: lwql-saved-charts. */
import { z } from "zod";

const MAX_VEGA_SPEC_BYTES = 262_144;
const MAX_CHART_DEFINITION_BYTES = MAX_VEGA_SPEC_BYTES + 65_536;

/** An unserialisable definition fails the ceiling as surely as an oversized one. */
function fitsChartDefinitionCeiling(definition: unknown): boolean {
  try {
    const json = JSON.stringify(definition);

    if (json === undefined) return false;

    return new TextEncoder().encode(json).length <= MAX_CHART_DEFINITION_BYTES;
  } catch {
    return false;
  }
}

const chartNameInputSchema = z.string().min(1).max(200);

const chartDefinitionInputSchema = z.unknown().superRefine((definition, ctx) => {
  if (definition === undefined) return;

  if (fitsChartDefinitionCeiling(definition)) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Chart definition must serialize to at most ${MAX_CHART_DEFINITION_BYTES} bytes.`,
  });
});

export const placeSavedWorkbenchChartSchema = z.object({
  dashboardId: z.string().min(1),
  gridColumn: z.number().int().optional(),
  gridRow: z.number().int().optional(),
  colSpan: z.number().int().optional(),
  rowSpan: z.number().int().optional(),
});

export const createSavedWorkbenchChartSchema = z.object({
  name: chartNameInputSchema,
  definition: chartDefinitionInputSchema,
});

export const updateSavedWorkbenchChartSchema = z
  .object({
    name: chartNameInputSchema.optional(),
    definition: chartDefinitionInputSchema.optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.definition !== undefined,
    "Provide a name, a definition, or both.",
  )
  .meta({ minProperties: 1 });

const chartDefinitionResourceSchema = z.object({
  version: z.number(),
  sql: z.string(),
  parameters: z.record(z.string(), z.any()),
  vegaLiteSpec: z.record(z.string(), z.any()).optional(),
});

export const savedWorkbenchChartResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: chartDefinitionResourceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  platformUrl: z.string(),
  dashboardId: z.string().nullable(),
  gridColumn: z.number().int(),
  gridRow: z.number().int(),
  colSpan: z.number().int(),
  rowSpan: z.number().int(),
});

export const savedWorkbenchChartListSchema = z.object({
  data: z.array(savedWorkbenchChartResourceSchema),
});

export const savedWorkbenchChartProjectParamsSchema = z.object({
  projectId: z.string().min(1),
});

export const savedWorkbenchChartParamsSchema = z.object({
  ...savedWorkbenchChartProjectParamsSchema.shape,
  chartId: z.string().min(1),
});
