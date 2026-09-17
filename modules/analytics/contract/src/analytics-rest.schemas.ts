import { flexibleDateSchema } from "@langwatch/api/dates";
import { z } from "zod";

import { timeseriesInputSchema } from "./analytics.input-schemas.ts";
import { langWatchQLQueryResultSchema, langWatchQLSchema } from "./analytics.lwql.ts";

export const analyticsTimeseriesRestBodySchema = z.object({
  ...timeseriesInputSchema.omit({ projectId: true }).shape,
  startDate: flexibleDateSchema,
  endDate: flexibleDateSchema,
});

export const analyticsTimeseriesResponseSchema = z.object({
  currentPeriod: z.array(z.record(z.string(), z.any())),
  previousPeriod: z.array(z.record(z.string(), z.any())),
});

export const legacySentenceErrorSchema = z.object({
  message: z.string().optional().describe("Set when the request was rejected before validation"),
  error: z.string().optional().describe("Set when the body parsed and then failed validation"),
});

const MAX_VEGA_SPEC_BYTES = 262_144;
const MAX_CHART_DEFINITION_BYTES = MAX_VEGA_SPEC_BYTES + 65_536;

function measureSpecBytes(spec: unknown): number | null {
  try {
    const json = JSON.stringify(spec);

    if (json === undefined) return null;

    return new TextEncoder().encode(json).length;
  } catch {
    return null;
  }
}

export const savedWorkbenchChartNameSchema = z.string().min(1).max(200);

export const savedWorkbenchChartDefinitionInputSchema = z
  .unknown()
  .superRefine((definition, ctx) => {
    if (definition === undefined) return;

    const bytes = measureSpecBytes(definition);

    if (bytes !== null && bytes <= MAX_CHART_DEFINITION_BYTES) return;

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
  name: savedWorkbenchChartNameSchema,
  definition: savedWorkbenchChartDefinitionInputSchema,
});

export const updateSavedWorkbenchChartSchema = z
  .object({
    name: savedWorkbenchChartNameSchema.optional(),
    definition: savedWorkbenchChartDefinitionInputSchema.optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.definition !== undefined,
    "Provide a name, a definition, or both.",
  )
  .meta({ minProperties: 1 });

export const savedWorkbenchChartDefinitionSchema = z.object({
  version: z.number(),
  sql: z.string(),
  parameters: z.record(z.string(), z.any()),
  vegaLiteSpec: z.record(z.string(), z.any()).optional(),
});

export const savedWorkbenchChartSchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: savedWorkbenchChartDefinitionSchema,
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
  data: z.array(savedWorkbenchChartSchema),
});

export const savedWorkbenchChartProjectParamsSchema = z.object({
  projectId: z.string().min(1),
});

export const savedWorkbenchChartParamsSchema = z.object({
  ...savedWorkbenchChartProjectParamsSchema.shape,
  chartId: z.string().min(1),
});

export const lwqlResultSchema = langWatchQLQueryResultSchema;

export const lwqlSchemaSchema = langWatchQLSchema;
