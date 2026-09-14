/** tRPC input shapes; accept unknown keys for forward-compatible clients. */
import { z } from "zod";
import {
  handleSchema,
  inputsSchema,
  messageSchema,
  nodeDatasetSchema,
  outputsSchema,
  responseFormatSchema,
  runtimeParametersSchema,
} from "./prompt.field-schemas.ts";
import { promptingTechniqueSchema, promptScopeSchema } from "./prompt.ts";
import type { PromptTagAssignment, VersionedPrompt } from "./prompt.ts";

/** One project, named by the surface that is reading it. */
export const promptProjectTrpcInputSchema = z.object({ projectId: z.string() });

/**
 * One prompt inside one project, addressed by id or handle. Shared by every
 * read and write that needs nothing else: the copies listing, the modify
 * probe, the version listing, delete, duplicate and the sync-from-source.
 */
export const promptIdOrHandleTrpcInputSchema = z.object({
  projectId: z.string(),
  idOrHandle: z.string(),
});

export const promptRestoreVersionTrpcInputSchema = z.object({
  versionId: z.string(),
  projectId: z.string(),
});

/** The dataset schema the two write shapes take for `demonstrations`. */
export type PromptDemonstrationsSchemaInput<TDemonstrations extends z.ZodType> = Readonly<{
  demonstrationsSchema: TDemonstrations;
}>;

export function createPromptCreateTrpcInputSchema<TDemonstrations extends z.ZodType>({
  demonstrationsSchema,
}: PromptDemonstrationsSchemaInput<TDemonstrations>) {
  return z.object({
    projectId: z.string(),
    data: z.object({
      scope: promptScopeSchema.optional(),
      authorId: z.string().optional(),
      commitMessage: z.string().optional(),
      prompt: z.string().optional(),
      messages: z.array(messageSchema).optional(),
      inputs: z.array(inputsSchema).optional(),
      outputs: z.array(outputsSchema).optional(),
      model: z.string().optional(),
      temperature: z.number().optional(),
      maxTokens: z.number().optional(),
      // Traditional sampling parameters
      topP: z.number().optional(),
      frequencyPenalty: z.number().optional(),
      presencePenalty: z.number().optional(),
      // Other sampling parameters
      seed: z.number().optional(),
      topK: z.number().optional(),
      minP: z.number().optional(),
      repetitionPenalty: z.number().optional(),
      // Reasoning parameter (canonical/unified field)
      reasoning: z.string().optional(),
      verbosity: z.string().optional(),
      promptingTechnique: promptingTechniqueSchema.optional(),
      responseFormat: responseFormatSchema.optional(),
      demonstrations: demonstrationsSchema.optional(),
      handle: handleSchema,
      parameters: runtimeParametersSchema.optional(),
    }),
  });
}

export function createPromptUpdateTrpcInputSchema<TDemonstrations extends z.ZodType>({
  demonstrationsSchema,
}: PromptDemonstrationsSchemaInput<TDemonstrations>) {
  return z.object({
    projectId: z.string(),
    id: z.string(),
    data: z.object({
      commitMessage: z.string(),
      authorId: z.string().optional(),
      prompt: z.string().optional(),
      messages: z.array(messageSchema).optional(),
      inputs: z.array(inputsSchema).optional(),
      outputs: z.array(outputsSchema).optional(),
      model: z.string().optional(),
      temperature: z.number().optional(),
      maxTokens: z.number().optional(),
      // Traditional sampling parameters
      topP: z.number().optional(),
      frequencyPenalty: z.number().optional(),
      presencePenalty: z.number().optional(),
      // Other sampling parameters
      seed: z.number().optional(),
      topK: z.number().optional(),
      minP: z.number().optional(),
      repetitionPenalty: z.number().optional(),
      // Reasoning parameter (canonical/unified field)
      reasoning: z.string().optional(),
      verbosity: z.string().optional(),
      promptingTechnique: promptingTechniqueSchema.optional(),
      responseFormat: responseFormatSchema.optional(),
      demonstrations: demonstrationsSchema.optional(),
      parameters: runtimeParametersSchema.optional(),
    }),
  });
}

/** Handle and scope move without cutting a version, so they write alone. */
export const promptUpdateHandleTrpcInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
  data: z.object({
    handle: handleSchema,
    scope: promptScopeSchema,
  }),
});

export const promptGetByIdOrHandleTrpcInputSchema = z.object({
  idOrHandle: z.string(),
  projectId: z.string(),
  /** Optional: fetch a specific version by ID */
  versionId: z.string().optional(),
  /** Optional: fetch a specific version by number */
  version: z.number().optional(),
  /** Optional: fetch the version pointed to by this tag */
  tag: z.string().optional(),
});

export const promptHandleUniquenessTrpcInputSchema = z.object({
  handle: handleSchema,
  projectId: z.string(),
  scope: promptScopeSchema,
});

export const promptCopyTrpcInputSchema = z.object({
  idOrHandle: z.string(),
  projectId: z.string(),
  sourceProjectId: z.string(),
});

export const promptPushToCopiesTrpcInputSchema = z.object({
  projectId: z.string(),
  idOrHandle: z.string(),
  copyIds: z.array(z.string()).optional(), // Optional: if provided, only push to selected copies
});

export const promptConfigTagsTrpcInputSchema = z.object({
  projectId: z.string(),
  configId: z.string(),
});

export const promptAssignTagTrpcInputSchema = z.object({
  projectId: z.string(),
  configId: z.string(),
  versionId: z.string(),
  tag: z.string().min(1),
});

/** Write payload types for create and update prompts (inferred from schema factories). */
export type PromptCreateTrpcInput = z.infer<
  ReturnType<typeof createPromptCreateTrpcInputSchema<typeof nodeDatasetSchema>>
>;

export type PromptUpdateTrpcInput = z.infer<
  ReturnType<typeof createPromptUpdateTrpcInputSchema<typeof nodeDatasetSchema>>
>;

/**
 * The input shapes the nine borrowed procedures take, as declared types.
 *
 * The schemas above were already this contract's; only the `z.infer` aliases
 * were missing, and without them a browser package could name the wire shape
 * only by inferring it through the whole application router — the inference a
 * feature-web package may not do.
 */
export type PromptProjectTrpcInput = z.infer<typeof promptProjectTrpcInputSchema>;
export type PromptIdOrHandleTrpcInput = z.infer<typeof promptIdOrHandleTrpcInputSchema>;
export type PromptUpdateHandleTrpcInput = z.infer<typeof promptUpdateHandleTrpcInputSchema>;
export type PromptGetByIdOrHandleTrpcInput = z.infer<typeof promptGetByIdOrHandleTrpcInputSchema>;
export type PromptHandleUniquenessTrpcInput = z.infer<typeof promptHandleUniquenessTrpcInputSchema>;
export type PromptConfigTagsTrpcInput = z.infer<typeof promptConfigTagsTrpcInputSchema>;
export type PromptAssignTagTrpcInput = z.infer<typeof promptAssignTagTrpcInputSchema>;

/** tRPC output types; VersionedPrompt and PromptTagAssignment DTOs. */
export type PromptGetAllForProjectTrpcOutput = VersionedPrompt[];
export type PromptGetByIdOrHandleTrpcOutput = VersionedPrompt | null;
export type PromptGetAllVersionsTrpcOutput = VersionedPrompt[];
export type PromptCreateTrpcOutput = VersionedPrompt;
export type PromptUpdateTrpcOutput = VersionedPrompt;
export type PromptUpdateHandleTrpcOutput = VersionedPrompt;

/** Whether the handle is still free — the drawer's inline validation reads it. */
export type PromptHandleUniquenessTrpcOutput = boolean;

export type PromptConfigTagsTrpcOutput = PromptTagAssignment[];
export type PromptAssignTagTrpcOutput = PromptTagAssignment;
