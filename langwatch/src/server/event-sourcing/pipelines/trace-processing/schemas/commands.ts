import { z } from "zod";
import { instrumentationScopeSchema, resourceSchema, spanSchema } from "./otlp";

export const recordSpanCommandDataSchema = z.object({
  tenantId: z.string(),
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
});

export type RecordSpanCommandData = z.infer<typeof recordSpanCommandDataSchema>;

export const assignTopicCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  subtopicId: z.string().nullable(),
  subtopicName: z.string().nullable(),
  isIncremental: z.boolean(),
});

export type AssignTopicCommandData = z.infer<typeof assignTopicCommandDataSchema>;
