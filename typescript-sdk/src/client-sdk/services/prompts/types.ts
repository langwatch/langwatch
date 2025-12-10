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

/**
 * Fetch policy for prompt retrieval.
 * Controls how prompts are fetched and cached.
 */
export enum FetchPolicy {
  /** Use local file if available, otherwise fetch from API (default) */
  MATERIALIZED_FIRST = "MATERIALIZED_FIRST",
  /** Always try API first, fall back to materialized */
  ALWAYS_FETCH = "ALWAYS_FETCH",
  /** Fetch every X minutes, use materialized between fetches */
  CACHE_TTL = "CACHE_TTL",
  /** Never fetch, use materialized files only */
  MATERIALIZED_ONLY = "MATERIALIZED_ONLY",
}

