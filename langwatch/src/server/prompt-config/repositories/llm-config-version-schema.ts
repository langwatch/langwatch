import type { LlmPromptConfigVersion } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  inputsSchema,
  messageSchema,
  outputsSchema,
  promptingTechniqueSchema,
  responseFormatSchema,
  versionSchema,
} from "~/prompts/schemas/field-schemas";
import { nodeDatasetSchema } from "../../../optimization_studio/types/dsl";
import { SchemaVersion } from "../enums";
import type { LlmConfigVersionDTO } from "./llm-config-versions.repository";

export const LATEST_SCHEMA_VERSION = SchemaVersion.V1_0 as const;

/**
 * Schema v1.0 - Base configuration schema
 * Validates the configData JSON field in LlmPromptConfigVersion
 */
const configSchemaV1_0 = z.object({
  id: z.string(),
  authorId: z.string().nullable().optional(),
  author: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable()
    .optional(),
  projectId: z.string().min(1, "Project ID cannot be empty"),
  configId: z.string().min(1, "Config ID cannot be empty"),
  schemaVersion: z.literal(SchemaVersion.V1_0),
  commitMessage: z.string(),
  version: versionSchema,
  createdAt: z.date(),
  configData: z.object({
    prompt: z.string(),
    messages: z.array(messageSchema).default([]),
    inputs: z.array(inputsSchema).default([]),
    outputs: z.array(outputsSchema).min(1, "At least one output is required"),
    model: z.string().min(1, "Model identifier cannot be empty"),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    // Traditional sampling parameters
    top_p: z.number().optional(),
    frequency_penalty: z.number().optional(),
    presence_penalty: z.number().optional(),
    // Other sampling parameters
    seed: z.number().optional(),
    top_k: z.number().optional(),
    min_p: z.number().optional(),
    repetition_penalty: z.number().optional(),
    // Reasoning parameter (canonical/unified field)
    // Provider-specific mapping happens at runtime boundary (reasoningBoundary.ts)
    reasoning: z.string().optional(),
    // Provider-specific fields - kept for backward compatibility reading old data
    // New data should only use 'reasoning' field
    reasoning_effort: z.string().optional(), // OpenAI (legacy)
    thinkingLevel: z.string().optional(), // Gemini (legacy)
    effort: z.string().optional(), // Anthropic (legacy)
    verbosity: z.string().optional(),
    demonstrations: nodeDatasetSchema.optional(),
    prompting_technique: promptingTechniqueSchema.optional(),
    // Deprecated: response_format is now derived from outputs at read time.
    // Kept optional for backward compat reading old data, but never written for new data.
    response_format: responseFormatSchema.optional(),
  }),
});

/**
 * Map of schema validators by version
 * Used to validate the configData field in LlmPromptConfigVersion
 */
export const schemaValidators = {
  [SchemaVersion.V1_0]: configSchemaV1_0,
};

export function getSchemaValidator(version: SchemaVersion | string) {
  const validator = schemaValidators[version as SchemaVersion];
  if (!validator) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown schema version: ${version}`,
    });
  }
  return validator;
}

export type LatestConfigVersionSchema = z.infer<typeof configSchemaV1_0>;

/**
 * Returns the latest schema version for LlmPromptConfigVersion
 */
export function getLatestConfigVersionSchema() {
  return configSchemaV1_0;
}

export function getVersionValidator(schemaVersion: SchemaVersion) {
  return schemaValidators[schemaVersion];
}

/**
 * Parses configuration data against a specific schema version
 * Used to validate configData in LlmPromptConfigVersion before saving
 * @param llmConfigVersion - The configuration data to parse
 * @returns The parsed config data
 * @throws TRPCError if the schema llmConfigVersion is unknown
 * @throws ZodError if the config data is invalid
 */
export function parseLlmConfigVersion(
  llmConfigVersion:
    | Omit<LlmPromptConfigVersion, "deletedAt">
    | LlmConfigVersionDTO,
): LatestConfigVersionSchema {
  const { schemaVersion } = llmConfigVersion;

  const validator = getVersionValidator(schemaVersion as SchemaVersion);

  if (!validator) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown schema llmConfigVersion: ${schemaVersion}`,
    });
  }

  return validator.parse(llmConfigVersion);
}

export function isValidHandle(handle: string): boolean {
  // npm package name pattern: allows lowercase letters, numbers, hyphens, and optionally one slash
  const npmPackagePattern = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/;
  const nanoIdPattern = /^prompt_[a-zA-Z0-9_-]+$/;
  return npmPackagePattern.test(handle) || nanoIdPattern.test(handle);
}
