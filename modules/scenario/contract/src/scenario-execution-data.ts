import { z } from "zod";

import { FieldMappingSchema } from "./field-mapping.ts";
import { runParameterValuesSchema } from "./scenario.parameters.ts";
import { callerVoiceConfigSchema } from "./voice/caller-voice.config.ts";

// ============================================================================
// Field Mapping Types
// (defined first so adapter schemas can reference them)
// ============================================================================

// FieldMappingSchema lives in the scenario contract: it is the one thing here that
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
   * The prompt's declared input variables (#6590): without these the adapter can't bind a
   * template's `{{question}}`, and it rendered as an empty string instead. Defaulted so a
   * job queued by an older worker still parses.
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
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

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
   * The project's decrypted secrets, so `{{ secrets.NAME }}` resolves in the url, the
   * header values and the auth fields. Defaulted so a job queued before secrets reached
   * http targets still parses.
   */
  secrets: z.record(z.string(), z.string()).default({}),
});
export type HttpAgentData = z.infer<typeof HttpAgentDataSchema>;

/**
 * Pre-fetched code agent configuration: `code` is Python source, and inputs/outputs
 * define the data shape expected by the code execution engine (langwatch_nlp).
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
   * Workflow Studio preparation for in-app execution.
   */
  secrets: z.record(z.string(), z.string()).default({}),
  /**
   * The run's own LangWatch credential, minted once, reaching only the
   * project's agent cache and self-expiring, so the sandbox never sees the
   * project key. Absent when minting failed, leaving each turn on its own.
   */
  sandboxApiKey: z.string().optional(),
  /** Wall-clock budget (ms) for agent Python, clamped to engine ceiling if
   * exceeding operator's limit.
   */
  timeoutMs: z.number().int().positive().optional(),
});
export type CodeAgentData = z.infer<typeof CodeAgentDataSchema>;

/**
 * Delegated to the langwatch_nlp service's /studio/execute_sync endpoint using an
 * execute_flow event — identical to code agents but with the user's own workflow DSL
 * (rather than a synthesized entry→code→end workflow).
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
   * Project secrets merged into the workflow DSL before execution. This keeps
   * `secrets.NAME` aligned with Workflow Studio preparation.
   */
  secrets: z.record(z.string(), z.string()).default({}),
});
export type WorkflowAgentData = z.infer<typeof WorkflowAgentDataSchema>;

/**
 * Pre-fetched connected agent configuration. The child reaches the agent through the relay
 * route with the project key, so it only needs the agent id, platform address, and per-call
 * budget; declared parameters travel with the job as their declared type.
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

// Voice run carries transport, agent id, and provider credential (never stored on agent).
// When project lacks a key, child fails with a named reason instead of an empty credential.
export const ElevenLabsVoiceTargetSchema = z.object({
  transport: z.literal("elevenlabs_convai"),
  agentId: z.string(),
  credential: z
    .object({
      kind: z.literal("elevenlabs"),
      apiKey: z.string(),
      baseUrl: z.string(),
    })
    .nullable(),
});
export const PhoneVoiceTargetSchema = z.object({
  transport: z.literal("phone"),
  agentId: z.string(),
  credential: z
    .object({
      kind: z.literal("twilio"),
      accountSid: z.string(),
      authToken: z.string(),
      fromNumber: z.string(),
    })
    .nullable(),
  /**
   * Which way the call goes: "inbound" opens the run with the agent's own
   * turn (it greets on connect); "outbound" (default) opens with the caller.
   * Defaulted so a job queued before this field existed still parses.
   */
  callDirection: z.enum(["inbound", "outbound"]).default("outbound"),
});
export const VoiceTargetSchema = z.discriminatedUnion("transport", [
  ElevenLabsVoiceTargetSchema,
  PhoneVoiceTargetSchema,
]);
export type VoiceTarget = z.infer<typeof VoiceTargetSchema>;

/** Pre-fetched voice agent configuration for serialized execution. */
export const VoiceAgentDataSchema = z.object({
  type: z.literal("voice"),
  agentId: z.string(),
  voiceTarget: VoiceTargetSchema,
  // OpenAI env for caller's TTS and transcription; merged for voice targets only.
  // Empty when no key, surfaces as named failure. Defaulted for backward compatibility.

  callerEnv: z.record(z.string(), z.string()).default({}),
  /**
   * The whole-call budget in seconds (VOICE_CALL_MAX_SECONDS): the transport clamps a
   * single turn's wait to it, and the child arms a timer that ends the call at it so the
   * judge still runs on what was said. Defaulted so a job queued before the limit existed.
   */
  maxCallSeconds: z.number().int().positive().default(300),
});
export type VoiceAgentData = z.infer<typeof VoiceAgentDataSchema>;

/** Union type for all supported target adapter data */
export const TargetAdapterDataSchema = z.discriminatedUnion("type", [
  PromptConfigDataSchema,
  HttpAgentDataSchema,
  CodeAgentDataSchema,
  WorkflowAgentDataSchema,
  ConnectedAgentDataSchema,
  VoiceAgentDataSchema,
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
  type: z.enum(["prompt", "http", "code", "workflow", "connected", "voice"]),
  referenceId: z.string(),
});
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

// ============================================================================
// Result Types
// ============================================================================

/**
 * The connected agent instance that answered a run: the runner writes it on its stdout
 * result line, so the parent validates it against this schema — a line carrying no label,
 * or a label that isn't text, is not an instance.
 */
export const ScenarioAgentInstanceSchema = z.object({
  hostname: z.string(),
  label: z.string().nullable(),
});
export type ScenarioAgentInstance = z.infer<typeof ScenarioAgentInstanceSchema>;

/** Result of scenario execution */
export const ScenarioExecutionResultSchema = z.object({
  success: z.boolean(),
  runId: z.string().optional(),
  reasoning: z.string().optional(),
  error: z.string().optional(),
  /** When true, the job was cancelled by user (not a crash/error). */
  cancelled: z.boolean().optional(),
  /** The connected agent instance that answered the run, when one did. */
  agentInstance: ScenarioAgentInstanceSchema.optional(),
  /** A voice run LangWatch ended at VOICE_CALL_MAX_SECONDS (AC28). */
  isCutAtLimit: z.boolean().optional(),
});
export type ScenarioExecutionResult = z.infer<typeof ScenarioExecutionResultSchema>;

// ============================================================================
// Child Process Types (for OTEL isolation)
// ============================================================================

/**
 * A run whose conversation is written down in advance. The user sends one
 * message, the agent answers, and the run succeeds when the answer arrives.
 */
export const ScriptedRunSchema = z.object({
  kind: z.literal("agent_test"),
  userMessage: z.string().min(1),
});
export type ScriptedRun = z.infer<typeof ScriptedRunSchema>;

// Complete job data for child process: everything needed to run without DB access.
// Model params are optional per role (job/consumer may be on different builds);
// refinement ensures all roles get a model.

export const ChildProcessJobDataSchema = z
  .object({
    context: ExecutionContextSchema,
    scenario: ScenarioConfigSchema,
    /**
     * The values the run resolved for this scenario: the scenario's own text arrives
     * already rendered against them, and the target under test reads them as
     * `params.NAME`. Defaulted so a job queued before parameters existed still parses.
     */
    parameters: runParameterValuesSchema.default({}),
    /** Pre-generated scenario run ID so the SDK uses the same aggregate ID. */
    scenarioRunId: z.string().optional(),
    adapterData: TargetAdapterDataSchema,
    // Model params for prompt adapter only. Legacy fallback: pre-split this drove all
    // three roles.

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
     * Total time (ms) the judge waits at verdict for an http target's remote traces to
     * arrive and stabilize. Computed from the project's own ingest lag; absent for
     * non-http targets and pre-budget jobs, in which case the SDK's default applies.
     */
    traceWaitTimeoutMs: z.number().optional(),
    /**
     * A fixed conversation for the run. Present on an agent test run only:
     * the user's messages are written down, no simulator plays the person and
     * no judge decides, so the run needs no model at all.
     */
    script: ScriptedRunSchema.optional(),
    /**
     * The simulated caller's voice, interrupt probability and effects — carried from
     * the scenario for a voice target only. The child builds the voice user simulator
     * from it. Absent for non-voice runs and for a job queued before it existed.
     */
    callerVoice: callerVoiceConfigSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.script) return;
    if (!data.simulatorModelParams && !data.modelParams) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulatorModelParams"],
        message: "No model params for the user simulator, and no modelParams to fall back to",
      });
    }
    if (!data.judgeModelParams && !data.modelParams) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["judgeModelParams"],
        message: "No model params for the judge, and no modelParams to fall back to",
      });
    }
  });
export type ChildProcessJobData = z.infer<typeof ChildProcessJobDataSchema>;
