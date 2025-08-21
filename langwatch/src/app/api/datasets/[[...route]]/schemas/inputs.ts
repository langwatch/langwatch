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
  ])),
  dataset: z.record(z.string(), z.unknown()),
  projectId: z.string(),
});
