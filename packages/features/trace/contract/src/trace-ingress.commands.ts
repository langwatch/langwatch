import { z } from "zod";
import { instrumentationScopeSchema, resourceSchema, spanSchema } from "./trace.otlp";

export const piiRedactionLevelSchema = z.enum(["STRICT", "ESSENTIAL", "DISABLED"]);
export type PIIRedactionLevel = z.infer<typeof piiRedactionLevelSchema>;

export const DEFAULT_PII_REDACTION_LEVEL: PIIRedactionLevel = "ESSENTIAL";

/** Raw OTLP span input before durable ingress processing. */
export const recordSpanCommandDataSchema = z.object({
  tenantId: z.string(),
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
  piiRedactionLevel: piiRedactionLevelSchema.optional(),
  occurredAt: z.number(),
  spoolRef: z.string().optional(),
});

export type RecordSpanCommandData = z.infer<typeof recordSpanCommandDataSchema>;
