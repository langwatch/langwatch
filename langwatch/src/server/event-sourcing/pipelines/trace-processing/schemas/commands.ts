import { z } from "zod";
import { spanSchema, resourceSchema, instrumentationScopeSchema } from "./otlp";

export const recordSpanCommandDataSchema = z.object({
  tenantId: z.string(),
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
});

export type RecordSpanCommandData = z.infer<typeof recordSpanCommandDataSchema>;
