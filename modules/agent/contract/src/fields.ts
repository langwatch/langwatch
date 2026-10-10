import type { Named } from "@langwatch/module";
import { z } from "zod";

export const FIELD_TYPES = [
  "str",
  "image",
  "file",
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

const fieldSchemaDefinition = z.object({
  identifier: z.string(),
  type: z.enum(FIELD_TYPES),
  optional: z.boolean().optional(),
  value: z.unknown().optional(),
  desc: z.string().optional(),
  prefix: z.string().optional(),
  hidden: z.boolean().optional(),
  json_schema: z.object({}).passthrough().optional(),
});
export interface FieldSchema extends Named<typeof fieldSchemaDefinition> {}
export const fieldSchema: FieldSchema = fieldSchemaDefinition;

export type Field = z.infer<typeof fieldSchema>;

const agentInputBindingSchemaDefinition = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("source"),
    sourceId: z.string(),
    path: z.array(z.string()),
  }),
  z.object({ type: z.literal("value"), value: z.string() }),
]);
export interface AgentInputBindingSchema extends Named<typeof agentInputBindingSchemaDefinition> {}
export const agentInputBindingSchema: AgentInputBindingSchema = agentInputBindingSchemaDefinition;

export type AgentInputBinding = z.infer<typeof agentInputBindingSchema>;
