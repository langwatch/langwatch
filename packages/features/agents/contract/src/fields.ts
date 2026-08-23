import { z } from "zod";

export const FIELD_TYPES = [
  "str",
  "image",
  "float",
  "int",
  "bool",
  "list",
  "list[str]",
  "list[float]",
  "list[int]",
  "list[bool]",
  "dict",
  "json_schema",
  "chat_messages",
  "signature",
  "llm",
  "prompting_technique",
  "dataset",
  "code",
] as const;

export const fieldSchema = z.object({
  identifier: z.string(),
  type: z.enum(FIELD_TYPES),
  optional: z.boolean().optional(),
  value: z.unknown().optional(),
  desc: z.string().optional(),
  prefix: z.string().optional(),
  hidden: z.boolean().optional(),
  json_schema: z.object({}).passthrough().optional(),
});

export type Field = z.infer<typeof fieldSchema>;

export const agentInputBindingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("source"),
    sourceId: z.string(),
    path: z.array(z.string()),
  }),
  z.object({ type: z.literal("value"), value: z.string() }),
]);

export type AgentInputBinding = z.infer<typeof agentInputBindingSchema>;
