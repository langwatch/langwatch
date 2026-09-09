import { z } from "zod";
import { customMetadataSchema, langWatchSpanSchema } from "./trace-format.schemas.ts";

export const recordCapturedSpanInputSchema = z.object({
  projectId: z.string().min(1),
  span: langWatchSpanSchema,
  customMetadata: customMetadataSchema,
  userId: z.string().min(1),
  occurredAt: z.number(),
});

export type RecordCapturedSpanInput = z.infer<typeof recordCapturedSpanInputSchema>;
