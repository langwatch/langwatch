// src/server/schemas/llm-config-schema.ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";

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
  type: z.string().min(1, "Type cannot be empty"),
});

/**
 * Schema for few-shot demonstrations
 */
const demonstrationsSchema = z.object({
  columns: z.array(
    z.object({
      name: z.string().min(1, "Column name cannot be empty"),
      type: z.string().min(1, "Column type cannot be empty"),
    })
  ),
  rows: z.array(z.record(z.any())).default([]),
});

/**
 * Schema v1.0 - Base configuration schema
 * Validates the configData JSON field in LlmPromptConfigVersion
 */
const configSchemaV1_0 = z.object({
  authorId: z.string().nullable(),
  projectId: z.string().min(1, "Project ID cannot be empty"),
  configId: z.string().min(1, "Config ID cannot be empty"),
  schemaVersion: z.literal(SchemaVersion.V1_0),
  commitMessage: z.string(),
  configData: z.object({
    version: z.literal(SchemaVersion.V1_0),
    prompt: z.string().min(1, "Prompt cannot be empty"),
    model: z.string().min(1, "Model identifier cannot be empty"),
    inputs: z.array(inputOutputSchema).min(1, "At least one input is required"),
    outputs: z
      .array(inputOutputSchema)
      .min(1, "At least one output is required"),
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

/**
 * Validates configuration data against a specific schema version
 * Used to validate configData in LlmPromptConfigVersion before saving
 * @param configData - The configuration data to validate
 * @param version - The schema version to validate against
 * @returns True if validation succeeds, throws error otherwise
 */
export function validateConfig(configData: LatestConfigVersionSchema): boolean {
  const { schemaVersion } = configData;
  const validator = schemaValidators[schemaVersion];
  if (!validator) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown schema version: ${schemaVersion}`,
    });
  }

  const result = validator.safeParse(configData);
  if (!result.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid config data: ${result.error.message}`,
    });
  }

  return true;
}
