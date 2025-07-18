// src/server/schemas/llm-config-schema.ts
import type { LlmPromptConfigVersion } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { LlmConfigVersionDTO } from "./llm-config-versions.repository";
import { LlmConfigInputTypes, LlmConfigOutputTypes } from "../../../types";
import { createLogger } from "../../../utils/logger";
import { nodeDatasetSchema } from "../../../optimization_studio/types/dsl";

const logger = createLogger(
  "langwatch:prompt-config:llm-config-version-schema"
);

/**
 * Schema version enum for LLM configuration
 * Used to track and manage schema evolution over time
 * Corresponds to the schemaVersion field in LlmPromptConfigVersion model
 */
export enum SchemaVersion {
  V1_0 = "1.0",
}

export const LATEST_SCHEMA_VERSION = SchemaVersion.V1_0 as const;

/**
 * Base schema for input and output parameters
 */
const inputsSchema = z.object({
  identifier: z.string().min(1, "Identifier cannot be empty"),
  type: z.enum(LlmConfigInputTypes),
});

export const outputsSchema = z.object({
  identifier: z.string().min(1, "Identifier cannot be empty"),
  type: z.enum(LlmConfigOutputTypes),
  json_schema: z
    .object({
      type: z.string().min(1, "Type cannot be empty"),
    })
    .passthrough()
    .optional(),
});

/**
 * Schema v1.0 - Base configuration schema
 * Validates the configData JSON field in LlmPromptConfigVersion
 */
const configSchemaV1_0 = z.object({
  id: z.string().optional(),
  authorId: z.string().nullable().optional(),
  projectId: z.string().min(1, "Project ID cannot be empty"),
  configId: z.string().min(1, "Config ID cannot be empty"),
  schemaVersion: z.literal(SchemaVersion.V1_0),
  commitMessage: z.string(),
  version: z.number(),
  createdAt: z.date().optional(),
  configData: z.object({
    version: z.number().min(1, "Version must be greater than 0").optional(),
    prompt: z.string(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant", "system"]),
            content: z.string(),
          })
          .passthrough()
      )
      .default([]),
    inputs: z.array(inputsSchema).min(1, "At least one input is required"),
    outputs: z.array(outputsSchema).min(1, "At least one output is required"),
    model: z.string().min(1, "Model identifier cannot be empty"),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    demonstrations: nodeDatasetSchema.optional(),
    prompting_technique: z
      .object({
        ref: z.string().optional(),
      })
      .optional(),
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
  llmConfigVersion: LlmPromptConfigVersion | LlmConfigVersionDTO
): LatestConfigVersionSchema {
  const { schemaVersion } = llmConfigVersion;

  const validator = getVersionValidator(schemaVersion as SchemaVersion);

  if (!validator) {
    logger.error(
      { schemaVersion, llmConfigVersion },
      "Unknown schema llmConfigVersion"
    );
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown schema llmConfigVersion: ${schemaVersion}`,
    });
  }

  return validator.parse(llmConfigVersion);
}
