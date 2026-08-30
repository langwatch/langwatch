/**
 * Types for scenario execution.
 *
 * Zod schemas with inferred types for data contracts.
 * Interfaces are segregated by responsibility (ISP) so consumers
 * only depend on what they actually need.
 */

import { z } from "zod";
import { FieldMappingSchema } from "../field-mapping";
import { runParameterValuesSchema } from "../parameters";

// ============================================================================
// Field Mapping Types
// (defined first so adapter schemas can reference them)
// ============================================================================

// FieldMappingSchema lives in ../field-mapping: it is the one thing here that
// the suite schema and the studio DSL also need, and keeping it out means this
// module has no importers outside the child's own code.

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
    }),
  ),
  /**
   * The prompt's declared input variables. Without these the adapter cannot
   * know a template's `{{question}}` was meant to be bound to anything, and it
   * rendered as an empty string instead (#6590). Defaulted so a job queued by
   * an older worker still parses.
   */
  inputs: z
    .array(
      z.object({
        identifier: z.string(),
        type: z.string(),
      }),
    )
    .default([]),
  /**
   * Explicit bindings from the suite target for this prompt. Declared inputs
   * these leave out are matched to a scenario source by name.
   */
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
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
    }),
  ),
  auth: AuthConfigSchema.optional(),
  bodyTemplate: z.string().optional(),
  outputPath: z.string().optional(),
  /**
   * JSONPath of the value the endpoint returns for the conversation. What it
   * matches is held per thread and rendered as `{{ session }}` on the next
   * turn of the same thread.
   */
  sessionPath: z.string().optional(),
  /** Maps agent input field identifiers to scenario data sources or static values. */
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
  /**
   * The project's decrypted secrets, so `{{ secrets.NAME }}` resolves in the
   * url, the header values and the auth fields, the places a credential
   * belongs. Defaulted so a job queued before secrets reached http targets
   * still parses.
   */
  secrets: z.record(z.string(), z.string()).default({}),
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
    }),
  ),
  outputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.string(),
    }),
  ),
  /** Maps agent input field identifiers to scenario data sources or static values. */
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
  /** Which output field to use as the scenario result. When unset, uses the first output. */
  scenarioOutputField: z.string().optional(),
  /**
   * Project secrets exposed to the Python code as the `secrets.NAME` namespace.
   * Pre-fetched so the worker-thread adapter runs without DB access. Mirrors
   * the studio's addEnvs behavior for in-app workflow execution.
   */
  secrets: z.record(z.string(), z.string()).default({}),
  /**
   * The run's own LangWatch credential, minted once for the run. It reaches
   * the project's agent cache and nothing else, and expires by itself, so the
   * code under test can keep state between turns without the project key ever
   * entering the sandbox. Absent when the platform could not mint one, which
   * leaves every turn doing its own work.
   */
  sandboxApiKey: z.string().optional(),
  /**
   * Wall-clock budget for the agent's Python, in milliseconds, sent to the
   * engine as the code node's `timeout_ms` parameter.
   *
   * It can only SHORTEN the run: the code executor clamps every per-node
   * request to the operator's ceiling
   * (`NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`, 60s when unset), so a value
   * above that ceiling is silently ignored. Absent leaves the engine on the
   * operator default.
   */
  timeoutMs: z.number().int().positive().optional(),
});
export type CodeAgentData = z.infer<typeof CodeAgentDataSchema>;

/**
 * Pre-fetched workflow agent configuration for serialized execution.
 *
 * Contains the fully published workflow DSL plus scenario-mapping metadata.
 * Workflow execution is delegated to the langwatch_nlp service's /studio/execute_sync
 * endpoint using an execute_flow event, identical to code agents but with the
 * user's own workflow DSL (rather than a synthesized entry→code→end workflow).
 */
export const WorkflowAgentDataSchema = z.object({
  type: z.literal("workflow"),
  agentId: z.string(),
  workflowId: z.string(),
  /** The published workflow DSL (from WorkflowVersion.dsl). Opaque to the adapter. */
  workflow: z.record(z.string(), z.unknown()),
  /** Ordered declared entry-node inputs used for mapping resolution + fallback. */
  inputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.string(),
    }),
  ),
  /** Ordered end-node outputs used for default/fallback output extraction. */
  outputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.string(),
    }),
  ),
  /** Maps agent input field identifiers to scenario data sources or static values. */
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
  /** Which output field to use as the scenario result. When unset, uses the first output. */
  scenarioOutputField: z.string().optional(),
  /**
   * Project secrets merged into the workflow DSL before execution. Mirrors the
   * studio's addEnvs behavior so `secrets.NAME` works inside code nodes of the
   * published workflow.
   */
  secrets: z.record(z.string(), z.string()).default({}),
});
export type WorkflowAgentData = z.infer<typeof WorkflowAgentDataSchema>;

/**
 * Pre-fetched connected agent configuration for serialized execution.
 *
 * The child reaches the agent through the relay route with the project key,
 * so all it needs is the agent id, where the platform is, and the per-call
 * budget the agent declared. The parameters the agent declares travel with
 * the job so a typed value is sent as its declared type.
 */
export const ConnectedAgentDataSchema = z.object({
  type: z.literal("connected"),
  agentId: z.string(),
  /** The platform's own address, the origin the relay route is posted to. */
  endpoint: z.string(),
  /** Per-call budget in milliseconds, already capped by the platform. */
  timeoutMs: z.number().int().positive(),
});
export type ConnectedAgentData = z.infer<typeof ConnectedAgentDataSchema>;

/** Union type for all supported target adapter data */
export const TargetAdapterDataSchema = z.discriminatedUnion("type", [
  PromptConfigDataSchema,
  HttpAgentDataSchema,
  CodeAgentDataSchema,
  WorkflowAgentDataSchema,
  ConnectedAgentDataSchema,
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
  maxTurns: z.number().int().optional(),
  minTurns: z.number().int().optional(),
});
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;

/** Execution context - grouping and correlation */
export const ExecutionContextSchema = z.object({
  projectId: z.string(),
  scenarioId: z.string(),
  setId: z.string(),
  batchRunId: z.string(),
  /** Pre-assigned scenario run ID passed through to the SDK to prevent duplicate entries.
   *  Optional during validation prefetch; required at execution time. */
  scenarioRunId: z.string().optional(),
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
  type: z.enum(["prompt", "http", "code", "workflow", "connected"]),
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
  /** When true, the job was cancelled by user (not a crash/error). */
  cancelled: z.boolean().optional(),
  /** The connected agent instance that answered the run, when one did. */
  agentInstance: z
    .object({ hostname: z.string(), label: z.string().nullable() })
    .optional(),
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
 *
 * All three model-params fields are individually optional because the
 * producer and the consumer of a job payload can be on different builds: a
 * job queued just before the simulator/judge model split carries only
 * `modelParams`, and it must still parse and run after the deploy that
 * introduced the split. What is NOT optional is that every role ends up with
 * a model — the refinement below rejects a payload from which the simulator
 * or the judge could not be built, so that failure is a named schema error at
 * the process boundary rather than an opaque "undefined has no properties"
 * crash three layers into model construction (issue #6634).
 *
 * `selectRoleModelParams` (job-model-params.ts) applies the fallback the
 * refinement guarantees is available.
 */
export const ChildProcessJobDataSchema = z
  .object({
    context: ExecutionContextSchema,
    scenario: ScenarioConfigSchema,
    /**
     * The values the run resolved for this scenario. The scenario's own text
     * arrives already rendered against them; the target under test reads them
     * as `params.NAME`. Defaulted so a job queued before parameters existed
     * still parses.
     */
    parameters: runParameterValuesSchema.default({}),
    /** Pre-generated scenario run ID so the SDK uses the same aggregate ID. */
    scenarioRunId: z.string().optional(),
    adapterData: TargetAdapterDataSchema,
    /**
     * Model params for the target adapter (the prompt under test). Only a
     * prompt target ever resolves one — workflow / code / http targets send
     * the project's platform API key instead (see
     * serialized-adapter.registry.ts) and never consume an LLM key for the
     * agent under test, so this is absent for them.
     *
     * Doubles as the legacy fallback for the two fields below: before the
     * model split this single value drove all three agents.
     */
    modelParams: LiteLLMParamsSchema.optional(),
    /**
     * Model params for the user-simulator agent. Resolved from the run-plan /
     * scenario override or the scenarios.user_simulator default. Absent only
     * on a pre-split payload, which falls back to `modelParams`.
     */
    simulatorModelParams: LiteLLMParamsSchema.optional(),
    /** Model params for the judge agent — same resolution and same pre-split
     *  fallback as the simulator, from the scenarios.judge default. */
    judgeModelParams: LiteLLMParamsSchema.optional(),
    nlpServiceUrl: z.string(),
    target: TargetConfigSchema,
    /**
     * Total time in milliseconds the judge waits at verdict time for an http
     * target's remote traces to arrive and stabilize. Computed by the
     * prefetcher from the project's own ingest lag; absent for non-http
     * targets and on jobs queued before the budget existed, in which case
     * the scenario SDK's default applies.
     */
    traceWaitTimeoutMs: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.simulatorModelParams && !data.modelParams) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulatorModelParams"],
        message:
          "No model params for the user simulator, and no modelParams to fall back to",
      });
    }
    if (!data.judgeModelParams && !data.modelParams) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["judgeModelParams"],
        message:
          "No model params for the judge, and no modelParams to fall back to",
      });
    }
  });
export type ChildProcessJobData = z.infer<typeof ChildProcessJobDataSchema>;
