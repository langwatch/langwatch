/**
 * The input shapes the prompt library's tRPC surface parses.
 *
 * Kept apart from the service commands in `prompt.commands.ts`: those are
 * `.strict()` and require non-empty ids, while these have always accepted (and
 * dropped) unknown keys. Tightening one to match the other would turn a
 * forward-compatible client into a validation error, so the two shapes stay
 * named separately rather than collapsed into one.
 *
 * The two write shapes are built rather than declared. Their `demonstrations`
 * field is a workflow dataset, and the workflow contract already depends on
 * this one — importing it back would close a package cycle — so the caller
 * hands the dataset schema in. The generic keeps the field's exact type on the
 * way out, so a client still sees the dataset shape rather than `unknown`.
 */
import { z } from "zod";
import {
  handleSchema,
  inputsSchema,
  messageSchema,
  nodeDatasetSchema,
  outputsSchema,
  responseFormatSchema,
  runtimeParametersSchema,
} from "./prompt.field-schemas";
import { promptingTechniqueSchema, promptScopeSchema } from "./prompt";

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

/**
 * The two write payloads a browser sends, as declared types.
 *
 * `platform/app`'s prompt surfaces read these off
 * `RouterInputs["prompts"]["create"]["data"]`, which is an inference through
 * the whole application router and is exactly what a browser package may not
 * name. The producer is PACKAGED — `@langwatch/prompt-server`'s tRPC transport
 * builds `createInputSchema` and `updateInputSchema` from the two factories
 * above — so this is a real declaration rather than a restatement: both halves
 * of the wire now resolve to the same schema.
 *
 * The demonstrations schema is this contract's own `nodeDatasetSchema`. The
 * transport hands `@langwatch/workflow-contract`'s, and the two are the same
 * shape; taking the workflow one here would close a package cycle, which is the
 * reason the factories take it as an argument in the first place.
 */
export type PromptCreateTrpcInput = z.infer<
  ReturnType<typeof createPromptCreateTrpcInputSchema<typeof nodeDatasetSchema>>
>;

export type PromptUpdateTrpcInput = z.infer<
  ReturnType<typeof createPromptUpdateTrpcInputSchema<typeof nodeDatasetSchema>>
>;
