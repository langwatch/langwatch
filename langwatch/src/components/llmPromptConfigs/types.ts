/**
 * LLM Config Type Definitions
 *
 * Centralized type definitions for LLM configuration components.
 */

/**
 * External LLM config values type - supports both naming conventions
 * for backward compatibility with existing form schemas.
 *
 * The max_tokens parameter uses a discriminated union to ensure only
 * one of max_tokens or maxTokens is set at a time.
 */
export type LLMConfigValues = {
  model: string;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  reasoning_effort?: string;
  thinkingLevel?: string;
  effort?: string;
  verbosity?: string;
} & (
  | { max_tokens?: number; maxTokens?: never }
  | { maxTokens?: number; max_tokens?: never }
);

