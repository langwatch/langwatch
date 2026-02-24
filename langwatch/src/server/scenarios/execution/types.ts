/**
 * Types for scenario execution.
 *
 * Zod schemas with inferred types for data contracts.
 * Interfaces are segregated by responsibility (ISP) so consumers
 * only depend on what they actually need.
 */

import { z } from "zod";

// ============================================================================
// Adapter Data Types (Zod schemas for data contracts)
// ============================================================================

/**
 * Pre-fetched prompt configuration data for serialized execution.
 * Contains all data needed to execute prompt-based scenarios without DB access.
 */
export const PromptConfigDataSchema = z.object({
  type: z.literal("prompt"),
  promptId: z.string(),
  systemPrompt: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })
  ),
  /** Model configured on prompt (if any). Used for model selection logic. */
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
});
export type PromptConfigData = z.infer<typeof PromptConfigDataSchema>;

/**
 * Authentication configuration schemas using discriminated union.
 * Each auth type has its required fields enforced by the schema.
 */
export const AuthConfigNoneSchema = z.object({
  type: z.literal("none"),
});

export const AuthConfigBearerSchema = z.object({
  type: z.literal("bearer"),
  token: z.string(),
});

export const AuthConfigApiKeySchema = z.object({
  type: z.literal("api_key"),
  header: z.string(),
  value: z.string(),
});

export const AuthConfigBasicSchema = z.object({
  type: z.literal("basic"),
  username: z.string(),
  password: z.string().optional(),
});

export const AuthConfigSchema = z.discriminatedUnion("type", [
  AuthConfigNoneSchema,
  AuthConfigBearerSchema,
  AuthConfigApiKeySchema,
  AuthConfigBasicSchema,
]);

/**
 * Pre-fetched HTTP agent configuration for serialized execution.
 * Contains all data needed to execute HTTP-based scenarios without DB access.
 */
export const HttpAgentDataSchema = z.object({
  type: z.literal("http"),
  agentId: z.string(),
  url: z.string(),
  method: z.string(),
  headers: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
  auth: AuthConfigSchema.optional(),
  bodyTemplate: z.string().optional(),
  outputPath: z.string().optional(),
});
export type HttpAgentData = z.infer<typeof HttpAgentDataSchema>;

/**
 * Pre-fetched code agent configuration for serialized execution.
 * Contains all data needed to execute code-based scenarios without DB access.
 *
 * The code field contains Python source code, and inputs/outputs define
 * the data shape expected by the code execution engine (langwatch_nlp).
 */
export const CodeAgentDataSchema = z.object({
  type: z.literal("code"),
  agentId: z.string(),
  code: z.string(),
  inputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.string(),
    })
  ),
  outputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.string(),
    })
  ),
});
export type CodeAgentData = z.infer<typeof CodeAgentDataSchema>;

/** Union type for all supported target adapter data */
export const TargetAdapterDataSchema = z.discriminatedUnion("type", [
  PromptConfigDataSchema,
  HttpAgentDataSchema,
  CodeAgentDataSchema,
]);
export type TargetAdapterData = z.infer<typeof TargetAdapterDataSchema>;

// ============================================================================
// LiteLLM Types
// ============================================================================

/** LiteLLM proxy parameters for model access */
export const LiteLLMParamsSchema = z
  .object({
    api_key: z.string(),
    model: z.string(),
  })
  .catchall(z.string());
export type LiteLLMParams = z.infer<typeof LiteLLMParamsSchema>;

// ============================================================================
// Segregated Interfaces (ISP) - Zod schemas for serializable contracts
// ============================================================================

/** Scenario definition - what to test */
export const ScenarioConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
});
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;

/** Execution context - grouping and correlation */
export const ExecutionContextSchema = z.object({
  projectId: z.string(),
  scenarioId: z.string(),
  setId: z.string(),
  batchRunId: z.string(),
});
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

/** Model configuration - LLM settings */
export const ModelConfigSchema = z.object({
  defaultModel: z.string(),
  defaultParams: LiteLLMParamsSchema,
  nlpServiceUrl: z.string(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/** Telemetry configuration - where to send traces */
export const TelemetryConfigSchema = z.object({
  endpoint: z.string(),
  apiKey: z.string(),
});
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

/** Target configuration - what to test against */
export const TargetConfigSchema = z.object({
  type: z.enum(["prompt", "http", "code"]),
  referenceId: z.string(),
});
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

// ============================================================================
// Result Types
// ============================================================================

/** Result of scenario execution */
export const ScenarioExecutionResultSchema = z.object({
  success: z.boolean(),
  runId: z.string().optional(),
  reasoning: z.string().optional(),
  error: z.string().optional(),
});
export type ScenarioExecutionResult = z.infer<
  typeof ScenarioExecutionResultSchema
>;

// ============================================================================
// Child Process Types (for OTEL isolation)
// ============================================================================

/**
 * Complete data package for child process execution.
 * Contains everything needed to run a scenario without DB access.
 */
export const ChildProcessJobDataSchema = z.object({
  context: ExecutionContextSchema,
  scenario: ScenarioConfigSchema,
  adapterData: TargetAdapterDataSchema,
  modelParams: LiteLLMParamsSchema,
  nlpServiceUrl: z.string(),
  target: TargetConfigSchema,
});
export type ChildProcessJobData = z.infer<typeof ChildProcessJobDataSchema>;
