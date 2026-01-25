/**
 * HTTP Agent Utilities for Evaluations V3
 *
 * Provides functions for working with HTTP agent targets, including:
 * - Extracting input variables from body templates
 * - Building target configs from HTTP agent data
 */

import type { Field } from "~/optimization_studio/types/dsl";
import type { HttpComponentConfig } from "~/optimization_studio/types/dsl";
import type { TargetConfig, HttpConfig } from "../types";

// ============================================================================
// Body Template Variable Extraction
// ============================================================================

/**
 * Extract variable names from an HTTP body template.
 * Variables are referenced using {{variableName}} mustache syntax.
 *
 * @param bodyTemplate - The body template string with mustache variables
 * @returns Array of unique variable names found in the template
 *
 * @example
 * extractVariablesFromBodyTemplate('{"thread_id": "{{thread_id}}", "messages": {{messages}}}')
 * // Returns: ["thread_id", "messages"]
 */
export const extractVariablesFromBodyTemplate = (
  bodyTemplate: string | undefined,
): string[] => {
  if (!bodyTemplate) return [];

  const pattern = /\{\{(\w+)\}\}/g;
  const variables = new Set<string>();
  let match;

  while ((match = pattern.exec(bodyTemplate)) !== null) {
    variables.add(match[1]!);
  }

  return Array.from(variables);
};

// ============================================================================
// HTTP Agent Config Conversion
// ============================================================================

/**
 * Convert HttpComponentConfig (from optimization_studio) to HttpConfig (for evaluations-v3).
 * These types are similar but HttpConfig is the Zod-validated version.
 *
 * @param config - The HTTP component config from optimization studio
 * @returns The HttpConfig for evaluations-v3
 */
export const convertHttpComponentConfig = (
  config: HttpComponentConfig,
): HttpConfig => {
  return {
    url: config.url,
    method: config.method ?? "POST",
    headers: config.headers,
    auth: config.auth,
    bodyTemplate: config.bodyTemplate,
    outputPath: config.outputPath,
    timeoutMs: config.timeout,
  };
};

/**
 * Build inputs array from HTTP body template variables.
 * All extracted variables become string inputs.
 *
 * @param bodyTemplate - The body template with mustache variables
 * @returns Array of Field objects for the inputs
 */
export const buildInputsFromBodyTemplate = (
  bodyTemplate: string | undefined,
): Field[] => {
  const variables = extractVariablesFromBodyTemplate(bodyTemplate);
  return variables.map((name) => ({
    identifier: name,
    type: "str" as const,
  }));
};

/**
 * Build a TargetConfig for an HTTP agent.
 * Extracts inputs from the body template automatically.
 *
 * @param params - Parameters for creating the HTTP agent target
 * @returns A TargetConfig ready to be added to the store
 */
export const buildHttpAgentTarget = (params: {
  id: string;
  name: string;
  dbAgentId?: string;
  httpConfig: HttpConfig;
}): TargetConfig => {
  const { id, name, dbAgentId, httpConfig } = params;

  // Extract inputs from body template
  const inputs = buildInputsFromBodyTemplate(httpConfig.bodyTemplate);

  return {
    id,
    type: "agent",
    agentType: "http",
    name,
    dbAgentId,
    inputs,
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {},
    httpConfig,
  };
};
