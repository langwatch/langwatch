import type { Named } from "@langwatch/module";
import { z } from "zod";

import { nodeDatasetSchema, promptingTechniqueSchema } from "./prompt.field-schemas.ts";

export const PROMPT_FEATURE_ID = "prompt" as const;
export const promptScopeSchema = z.enum(["PROJECT", "ORGANIZATION"]);
export type PromptScope = z.infer<typeof promptScopeSchema>;

/**
 * The two scope values, as a value - stated here off the schema's own
 * members (a browser package may not import the generated Prisma enum), so a
 * third scope cannot be added on one side alone.
 */
export const PromptScope = {
  PROJECT: "PROJECT",
  ORGANIZATION: "ORGANIZATION",
} as const satisfies Record<Uppercase<PromptScope>, PromptScope>;

const promptMessageSchemaDefinition = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});
export interface PromptMessageSchema extends Named<typeof promptMessageSchemaDefinition> {}
export const promptMessageSchema: PromptMessageSchema = promptMessageSchemaDefinition;
export type PromptMessage = z.infer<typeof promptMessageSchema>;

const promptInputSchemaDefinition = z.object({
  identifier: z.string().min(1),
  type: z.enum([
    "str",
    "float",
    "bool",
    "image",
    "file",
    "list",
    "list[str]",
    "list[float]",
    "list[int]",
    "list[bool]",
    "dict",
    "chat_messages",
  ]),
});
export interface PromptInputSchema extends Named<typeof promptInputSchemaDefinition> {}
export const promptInputSchema: PromptInputSchema = promptInputSchemaDefinition;
export type PromptInput = z.infer<typeof promptInputSchema>;

const promptOutputSchemaDefinition = z.object({
  identifier: z.string().min(1),
  type: z.enum(["str", "float", "bool", "json_schema"]),
  json_schema: z.object({ type: z.string() }).passthrough().optional(),
});
export interface PromptOutputSchema extends Named<typeof promptOutputSchemaDefinition> {}
export const promptOutputSchema: PromptOutputSchema = promptOutputSchemaDefinition;
export type PromptOutput = z.infer<typeof promptOutputSchema>;

/** Structured-output format for prompt versions (derived by deriveResponseFormatFromOutputs). */
const promptResponseFormatSchemaDefinition = z.object({
  type: z.enum(["json_schema"]),
  json_schema: z
    .object({
      name: z.string(),
      schema: z.looseObject({}),
    })
    .nullable(),
});
export interface PromptResponseFormatSchema extends Named<
  typeof promptResponseFormatSchemaDefinition
> {}
export const promptResponseFormatSchema: PromptResponseFormatSchema =
  promptResponseFormatSchemaDefinition;

/** Plain objects as on main: a stored row carrying extra keys still parses (they are stripped). */
const promptConfigDataSchemaDefinition = z.object({
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
  demonstrations: nodeDatasetSchema.optional(),
  prompting_technique: promptingTechniqueSchema.optional(),
  response_format: z.unknown().optional(),
});
export interface PromptConfigDataSchema extends Named<typeof promptConfigDataSchemaDefinition> {}
export const promptConfigDataSchema: PromptConfigDataSchema = promptConfigDataSchemaDefinition;
export type PromptConfigData = z.infer<typeof promptConfigDataSchema>;

const promptTagSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string().min(1),
    createdById: z.string().nullable().optional(),
    createdAt: z.date(),
    updatedAt: z.date().optional(),
    updatedById: z.string().nullable().optional(),
  })
  .strict();
export interface PromptTagSchema extends Named<typeof promptTagSchemaDefinition> {}
export const promptTagSchema: PromptTagSchema = promptTagSchemaDefinition;
export type PromptTag = z.infer<typeof promptTagSchema>;

const versionedPromptSchemaDefinition = z.object({
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
  responseFormat: promptResponseFormatSchema.optional(),
  demonstrations: nodeDatasetSchema.optional(),
  promptingTechnique: promptingTechniqueSchema.optional(),
  commitMessage: z.string().optional(),
  updatedAt: z.date(),
  createdAt: z.date(),
  copiedFromPromptId: z.string().nullable().optional(),
  copyCount: z.number().int().nonnegative().optional(),
  _count: z.object({ copiedPrompts: z.number().int().nonnegative() }).optional(),
  tags: z.array(z.object({ name: z.string(), versionId: z.string() })),
  parameters: z.record(z.string(), z.unknown()),
});
export interface VersionedPromptSchema extends Named<typeof versionedPromptSchemaDefinition> {}
export const versionedPromptSchema: VersionedPromptSchema = versionedPromptSchemaDefinition;
export type VersionedPrompt = z.infer<typeof versionedPromptSchema>;

const promptDeleteResultSchemaDefinition = z.object({ success: z.boolean() }).strict();
export interface PromptDeleteResultSchema extends Named<
  typeof promptDeleteResultSchemaDefinition
> {}
export const promptDeleteResultSchema: PromptDeleteResultSchema =
  promptDeleteResultSchemaDefinition;
export type PromptDeleteResult = z.infer<typeof promptDeleteResultSchema>;

const promptModifyPermissionSchemaDefinition = z
  .object({ hasPermission: z.boolean(), reason: z.string().optional() })
  .strict();
export interface PromptModifyPermissionSchema extends Named<
  typeof promptModifyPermissionSchemaDefinition
> {}
export const promptModifyPermissionSchema: PromptModifyPermissionSchema =
  promptModifyPermissionSchemaDefinition;
export type PromptModifyPermission = z.infer<typeof promptModifyPermissionSchema>;

const promptTagAssignmentSchemaDefinition = z
  .object({
    configId: z.string().min(1),
    versionId: z.string().min(1),
    promptTag: promptTagSchema,
    updatedAt: z.date(),
  })
  .strict();
export interface PromptTagAssignmentSchema extends Named<
  typeof promptTagAssignmentSchemaDefinition
> {}
export const promptTagAssignmentSchema: PromptTagAssignmentSchema =
  promptTagAssignmentSchemaDefinition;
export type PromptTagAssignment = z.infer<typeof promptTagAssignmentSchema>;

const promptCopySummarySchemaDefinition = z
  .object({
    id: z.string().min(1),
    handle: z.string().nullable(),
    projectId: z.string().min(1),
    projectName: z.string(),
    teamName: z.string(),
    organizationName: z.string(),
  })
  .strict();
export interface PromptCopySummarySchema extends Named<typeof promptCopySummarySchemaDefinition> {}
export const promptCopySummarySchema: PromptCopySummarySchema = promptCopySummarySchemaDefinition;
export type PromptCopySummary = z.infer<typeof promptCopySummarySchema>;

const promptCopySourceSchemaDefinition = z
  .object({ sourcePromptId: z.string().min(1), sourceProjectId: z.string().min(1) })
  .strict();
export interface PromptCopySourceSchema extends Named<typeof promptCopySourceSchemaDefinition> {}
export const promptCopySourceSchema: PromptCopySourceSchema = promptCopySourceSchemaDefinition;
export type PromptCopySource = z.infer<typeof promptCopySourceSchema>;

const promptSyncResultSchemaDefinition = z
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
export interface PromptSyncResultSchema extends Named<typeof promptSyncResultSchemaDefinition> {}
export const promptSyncResultSchema: PromptSyncResultSchema = promptSyncResultSchemaDefinition;
export type PromptSyncResult = z.infer<typeof promptSyncResultSchema>;

export const promptHandleSchema = z.string().regex(/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/);
const promptShorthandSchemaDefinition = z
  .object({
    slug: z.string().min(1),
    tag: z.string().optional(),
    version: z.number().int().positive().optional(),
    hadSuffix: z.boolean(),
  })
  .strict();
export interface PromptShorthandSchema extends Named<typeof promptShorthandSchemaDefinition> {}
export const promptShorthandSchema: PromptShorthandSchema = promptShorthandSchemaDefinition;
export type PromptShorthand = z.infer<typeof promptShorthandSchema>;

/**
 * One copy a push may target, as the push-selection screen renders it:
 * identity, the path naming where it lives, and whether this caller may
 * write there. Never offered when they cannot, so the flag is what filters the list.
 */
const promptCopyChoiceSchemaDefinition = promptCopySummarySchema
  .safeExtend({
    /** The copy's handle, or its id when it has none. */
    handle: z.string(),
    /** `organization / team / project`, ready to render. */
    fullPath: z.string(),
    hasPermission: z.boolean(),
  })
  .strict();
export interface PromptCopyChoiceSchema extends Named<typeof promptCopyChoiceSchemaDefinition> {}
export const promptCopyChoiceSchema: PromptCopyChoiceSchema = promptCopyChoiceSchemaDefinition;
export type PromptCopyChoice = z.infer<typeof promptCopyChoiceSchema>;

/** A prompt that arrived in this project as a copy, with its source named. */
const copiedPromptSchemaDefinition = versionedPromptSchema.safeExtend({
  copiedFromPromptId: z.string().min(1),
});
export interface CopiedPromptSchema extends Named<typeof copiedPromptSchemaDefinition> {}
export const copiedPromptSchema: CopiedPromptSchema = copiedPromptSchemaDefinition;
export type CopiedPrompt = z.infer<typeof copiedPromptSchema>;

/**
 * What a push to a source prompt's copies answers. The three counts are
 * deliberately separate: a caller who may not write to every copy sees fewer
 * pushed than selected, and fewer selected than exist, rather than a whole-push refusal.
 */
const promptPushToCopiesResultSchemaDefinition = z
  .object({
    pushedTo: z.number().int(),
    totalCopies: z.number().int(),
    selectedCopies: z.number().int(),
    results: z.array(
      z
        .object({
          copyId: z.string().min(1),
          copyName: z.string(),
          prompt: versionedPromptSchema,
        })
        .strict(),
    ),
  })
  .strict();
export interface PromptPushToCopiesResultSchema extends Named<
  typeof promptPushToCopiesResultSchemaDefinition
> {}
export const promptPushToCopiesResultSchema: PromptPushToCopiesResultSchema =
  promptPushToCopiesResultSchemaDefinition;
export type PromptPushToCopiesResult = z.infer<typeof promptPushToCopiesResultSchema>;
