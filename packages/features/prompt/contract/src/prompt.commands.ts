import { z } from "zod/v4";
import { promptHandleSchema, promptScopeSchema, promptMessageSchema, promptInputSchema, promptOutputSchema, promptingTechniqueSchema, type PromptConfigData } from "./prompt";

export const promptConfigFieldsSchema = z.object({
  prompt: z.string().optional(), messages: z.array(promptMessageSchema).optional(),
  inputs: z.array(promptInputSchema).optional(), outputs: z.array(promptOutputSchema).optional(),
  model: z.string().optional(), temperature: z.number().optional(), maxTokens: z.number().optional(),
  topP: z.number().optional(), frequencyPenalty: z.number().optional(), presencePenalty: z.number().optional(),
  seed: z.number().optional(), topK: z.number().optional(), minP: z.number().optional(), repetitionPenalty: z.number().optional(),
  reasoning: z.string().optional(), verbosity: z.string().optional(), promptingTechnique: promptingTechniqueSchema.optional(),
  demonstrations: z.unknown().optional(), responseFormat: z.unknown().optional(), parameters: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const createPromptCommandSchema = z.object({
  projectId: z.string().min(1), organizationId: z.string().min(1).optional(), handle: promptHandleSchema,
  scope: promptScopeSchema.optional(), authorId: z.string().optional(), commitMessage: z.string().nullable().optional(),
}).merge(promptConfigFieldsSchema).strict();
export type CreatePromptCommand = z.infer<typeof createPromptCommandSchema>;

export const updatePromptCommandSchema = z.object({
  idOrHandle: z.string().min(1), projectId: z.string().min(1),
  data: z.object({ authorId: z.string().optional(), commitMessage: z.string().min(1) }).merge(promptConfigFieldsSchema).strict(),
}).strict();
export type UpdatePromptCommand = z.infer<typeof updatePromptCommandSchema>;

export const updatePromptHandleCommandSchema = z.object({
  idOrHandle: z.string().min(1), projectId: z.string().min(1), data: z.object({ handle: promptHandleSchema, scope: promptScopeSchema }).strict(),
}).strict();
export type UpdatePromptHandleCommand = z.infer<typeof updatePromptHandleCommandSchema>;

export const promptReferenceSchema = z.object({ idOrHandle: z.string().min(1), projectId: z.string().min(1), version: z.number().int().positive().optional(), versionId: z.string().optional(), tag: z.string().optional() }).strict();
export type PromptReference = z.infer<typeof promptReferenceSchema>;

export const copyPromptCommandSchema = z.object({ idOrHandle: z.string().min(1), sourceProjectId: z.string().min(1), targetProjectId: z.string().min(1), authorId: z.string().optional() }).strict();
export type CopyPromptCommand = z.infer<typeof copyPromptCommandSchema>;

export type PromptConfigFields = z.infer<typeof promptConfigFieldsSchema> & Partial<PromptConfigData>;
