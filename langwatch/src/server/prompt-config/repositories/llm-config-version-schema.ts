// src/server/schemas/llm-config-schema.ts
import type { LlmPromptConfigVersion } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { DATASET_COLUMN_TYPES } from "../../datasets/types";

import type { LlmConfigVersionDTO } from "./llm-config-versions.repository";

import { FIELD_TYPES } from "~/optimization_studio/types/dsl";

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
const inputOutputSchema = z.object({
  identifier: z.string().min(1, "Identifier cannot be empty"),
  type: z.enum(FIELD_TYPES),
});

/**
 * Schema for few-shot demonstrations
 */
const demonstrationsSchema = z.object({
  columns: z.array(
    z.object({
      id: z.string().min(1, "Column ID cannot be empty"),
      name: z.string().min(1, "Column name cannot be empty"),
      type: z.enum(DATASET_COLUMN_TYPES),
    })
  ),
  rows: z
    .array(
      z
        .object({
          id: z.string().min(1, "Row ID cannot be empty"),
        })
        .and(z.record(z.any()))
    )
    .default([]),
});

/**
 * Schema v1.0 - Base configuration schema
 * Validates the configData JSON field in LlmPromptConfigVersion
 */
const configSchemaV1_0 = z.object({
  authorId: z.string().nullable().optional(),
  projectId: z.string().min(1, "Project ID cannot be empty"),
  configId: z.string().min(1, "Config ID cannot be empty"),
  schemaVersion: z.literal(SchemaVersion.V1_0),
  commitMessage: z.string(),
  version: z.number(),
  configData: z.object({
    version: z.number().min(1, "Version must be greater than 0").optional(),
    prompt: z.string().min(1, "Prompt cannot be empty"),
    inputs: z.array(inputOutputSchema).min(1, "At least one input is required"),
    outputs: z
      .array(inputOutputSchema)
      .min(1, "At least one output is required"),
    model: z.string().min(1, "Model identifier cannot be empty"),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    litellm_params: z.record(z.string()).optional(),
    demonstrations: demonstrationsSchema,
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
    console.error(
      `Unknown schema llmConfigVersion: ${schemaVersion}`,
      llmConfigVersion
    );
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown schema llmConfigVersion: ${schemaVersion}`,
    });
  }

  return validator.parse(llmConfigVersion);
}
