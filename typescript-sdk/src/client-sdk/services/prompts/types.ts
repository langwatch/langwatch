import { type z } from "zod";
import type { paths } from "@/internal/generated/openapi/api-client";
import {
  type corePromptDataSchema,
  type promptMetadataSchema,
  type promptDataSchema
} from "./schema";

/**
 * Type for template variables - supporting common data types
 */
export type TemplateVariables = Record<
  string,
  string | number | boolean | object | null
>;

/**
 * Core data needed for prompt functionality
 */
export type CorePromptData = z.infer<typeof corePromptDataSchema>;

/**
 * Optional metadata for identification and tracing
 */
export type PromptMetadata = z.infer<typeof promptMetadataSchema>;

/**
 * Combined type for creating prompts
 */
export type PromptData = z.infer<typeof promptDataSchema>;

// Extract API types from OpenAPI schema for backwards compatibility
export type CreatePromptBody = NonNullable<
  paths["/api/prompts"]["post"]["requestBody"]
>["content"]["application/json"];

export type UpdatePromptBody = NonNullable<
  paths["/api/prompts/{id}"]["put"]["requestBody"]
>["content"]["application/json"];

export type PromptResponse = NonNullable<
  paths["/api/prompts/{id}"]["get"]["responses"]["200"]["content"]["application/json"]
>;

// Extract the PromptScope type from the API client
export type PromptScope = paths["/api/prompts"]["post"]["responses"]["200"]["content"]["application/json"]["scope"];
