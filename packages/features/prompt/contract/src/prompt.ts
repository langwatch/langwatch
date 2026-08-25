import { z } from "zod";

export const PROMPT_FEATURE_ID = "prompt" as const;
export const promptScopeSchema = z.enum(["PROJECT", "ORGANIZATION"]);
export type PromptScope = z.infer<typeof promptScopeSchema>;

export const promptMessageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  })
  .strict();
export type PromptMessage = z.infer<typeof promptMessageSchema>;

export const promptInputSchema = z
  .object({
    identifier: z.string().min(1),
    type: z.enum([
      "str",
      "float",
      "bool",
      "image",
      "list",
      "list[str]",
      "list[float]",
      "list[int]",
      "list[bool]",
      "dict",
      "chat_messages",
    ]),
  })
  .strict();
export type PromptInput = z.infer<typeof promptInputSchema>;

export const promptOutputSchema = z
  .object({
    identifier: z.string().min(1),
    type: z.enum(["str", "float", "bool", "json_schema"]),
    json_schema: z.object({ type: z.string() }).passthrough().optional(),
  })
  .strict();
export type PromptOutput = z.infer<typeof promptOutputSchema>;

export const promptDemonstrationsSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    inline: z
      .object({
        records: z.record(z.string(), z.array(z.unknown())),
        columnTypes: z.array(
          z.object({ id: z.string().optional(), name: z.string(), type: z.string() }),
        ),
      })
      .optional(),
  })
  .strict();

export const promptingTechniqueSchema = z
  .object({
    type: z.enum(["few_shot", "in_context", "chain_of_thought"]),
    demonstrations: promptDemonstrationsSchema.optional(),
  })
  .strict();

export const promptConfigDataSchema = z
  .object({
    prompt: z.string(),
    messages: z.array(promptMessageSchema).default([]),
    inputs: z.array(promptInputSchema).default([]),
    outputs: z.array(promptOutputSchema).min(1),
    model: z.string().min(1),
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
    demonstrations: promptDemonstrationsSchema.optional(),
    prompting_technique: promptingTechniqueSchema.optional(),
    response_format: z.unknown().optional(),
  })
  .strict();
export type PromptConfigData = z.infer<typeof promptConfigDataSchema>;

export const promptTagSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string().min(1),
    createdById: z.string().nullable().optional(),
    createdAt: z.date().optional(),
  })
  .strict();
export type PromptTag = z.infer<typeof promptTagSchema>;

export const versionedPromptSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    handle: z.string().nullable(),
    scope: promptScopeSchema,
    version: z.number().int().nonnegative(),
    versionId: z.string().min(1),
    versionCreatedAt: z.date(),
    model: z.string(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    topP: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    presencePenalty: z.number().optional(),
    seed: z.number().optional(),
    topK: z.number().optional(),
    minP: z.number().optional(),
    repetitionPenalty: z.number().optional(),
    reasoning: z.string().optional(),
    verbosity: z.string().optional(),
    prompt: z.string(),
    projectId: z.string().min(1),
    organizationId: z.string().min(1),
    messages: z.array(promptMessageSchema),
    authorId: z.string().nullable(),
    author: z
      .object({
        id: z.string(),
        name: z.string().nullable(),
        email: z.string().nullable(),
        image: z.string().nullable(),
      })
      .nullable()
      .optional(),
    inputs: z.array(promptInputSchema),
    outputs: z.array(promptOutputSchema),
    responseFormat: z.unknown().optional(),
    demonstrations: promptDemonstrationsSchema.optional(),
    promptingTechnique: promptingTechniqueSchema.optional(),
    commitMessage: z.string().optional(),
    updatedAt: z.date(),
    createdAt: z.date(),
    copiedFromPromptId: z.string().nullable().optional(),
    copyCount: z.number().int().nonnegative().optional(),
    _count: z.object({ copiedPrompts: z.number().int().nonnegative() }).optional(),
    tags: z.array(z.object({ name: z.string(), versionId: z.string() }).strict()),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();
export type VersionedPrompt = z.infer<typeof versionedPromptSchema>;

export const promptDeleteResultSchema = z.object({ success: z.boolean() }).strict();
export type PromptDeleteResult = z.infer<typeof promptDeleteResultSchema>;

export const promptModifyPermissionSchema = z
  .object({ hasPermission: z.boolean(), reason: z.string().optional() })
  .strict();
export type PromptModifyPermission = z.infer<typeof promptModifyPermissionSchema>;

export const promptTagAssignmentSchema = z
  .object({
    configId: z.string().min(1),
    versionId: z.string().min(1),
    promptTag: promptTagSchema,
    updatedAt: z.date(),
  })
  .strict();
export type PromptTagAssignment = z.infer<typeof promptTagAssignmentSchema>;

export const promptCopySummarySchema = z
  .object({
    id: z.string().min(1),
    handle: z.string().nullable(),
    projectId: z.string().min(1),
    projectName: z.string(),
    teamName: z.string(),
    organizationName: z.string(),
  })
  .strict();
export type PromptCopySummary = z.infer<typeof promptCopySummarySchema>;

export const promptCopySourceSchema = z
  .object({ sourcePromptId: z.string().min(1), sourceProjectId: z.string().min(1) })
  .strict();
export type PromptCopySource = z.infer<typeof promptCopySourceSchema>;

export const promptSyncResultSchema = z
  .object({
    action: z.enum(["created", "updated", "conflict", "up_to_date"]),
    prompt: versionedPromptSchema.optional(),
    conflictInfo: z
      .object({
        localVersion: z.number(),
        remoteVersion: z.number(),
        differences: z.array(z.string()),
        remoteConfigData: z.record(z.string(), z.unknown()),
        remoteParameters: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PromptSyncResult = z.infer<typeof promptSyncResultSchema>;

export const promptHandleSchema = z.string().regex(/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/);
export const promptShorthandSchema = z
  .object({
    slug: z.string().min(1),
    tag: z.string().optional(),
    version: z.number().int().positive().optional(),
    hadSuffix: z.boolean(),
  })
  .strict();
export type PromptShorthand = z.infer<typeof promptShorthandSchema>;
