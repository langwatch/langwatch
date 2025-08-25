import { z } from "zod";

export const datasetEntriesInputSchema = z.object({
  entries: z.array(z.record(z.string(), z.unknown())),
});

export const datasetGenerateInputSchema = z.object({
  messages: z.array(z.union([
    z.object({
      role: z.literal("user"),
      content: z.string(),
    }),
    z.object({
      role: z.literal("assistant"),
      content: z.string(),
    }),
    z.object({
      role: z.literal("system"),
      content: z.string(),
    }),
    z.object({
      role: z.literal("tool"),
      content: z.string(),
      toolCallId: z.string(),
    }),
  ])).describe("The message chain to pass into the model to generate the dataset entries. A system prompt is prepended automatically to help guide."),
  dataset: z.string().trim().min(1).describe("The current dataset. This is also used to help the model understand the columns of the dataset. Example: `id,input,output\\r\\n`"),
  projectId: z.string(),
});
