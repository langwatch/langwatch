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

export const lwqlResultSchema = langWatchQLQueryResultSchema;

export const lwqlSchemaSchema = langWatchQLSchema;
