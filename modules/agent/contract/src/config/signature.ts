import type { Named } from "@langwatch/module";
import { z } from "zod";

import { baseAgentConfigSchema } from "./code.ts";

const llmConfigSchemaDefinition = z.object({
  model: z.string(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  seed: z.number().optional(),
  top_k: z.number().optional(),
  min_p: z.number().optional(),
  repetition_penalty: z.number().optional(),
  reasoning: z.string().optional(),
  reasoning_effort: z.string().optional(),
  thinkingLevel: z.string().optional(),
  effort: z.string().optional(),
  verbosity: z.string().optional(),
  litellm_params: z.record(z.string(), z.string()).optional(),
});
export interface LlmConfigSchema extends Named<typeof llmConfigSchemaDefinition> {}
export const llmConfigSchema: LlmConfigSchema = llmConfigSchemaDefinition;

const agentChatMessageSchemaDefinition = z.object({
  role: z.enum(["system", "user", "assistant"]).optional(),
  content: z.string().optional(),
});
export interface AgentChatMessageSchema extends Named<typeof agentChatMessageSchemaDefinition> {}
export const agentChatMessageSchema: AgentChatMessageSchema = agentChatMessageSchemaDefinition;

const signatureAgentConfigSchemaDefinition = z.object({
  ...baseAgentConfigSchema.shape,
  configId: z.string().optional(),
  handle: z.string().nullable().optional(),
  versionMetadata: z
    .object({
      versionId: z.string(),
      versionNumber: z.number(),
      versionCreatedAt: z.string(),
    })
    .optional(),
  llm: llmConfigSchema.optional(),
  prompt: z.string().optional(),
  messages: z.array(agentChatMessageSchema).optional(),
  promptDraft: z.boolean().optional(),
});
export interface SignatureAgentConfigSchema extends Named<
  typeof signatureAgentConfigSchemaDefinition
> {}
export const signatureAgentConfigSchema: SignatureAgentConfigSchema =
  signatureAgentConfigSchemaDefinition;

export type SignatureAgentConfig = z.infer<typeof signatureAgentConfigSchema>;
