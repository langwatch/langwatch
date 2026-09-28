/**
 * Scenario event schemas
 * Extends the AG-UI base event schema to add scenario-specific fields.
 */
import { EventType } from "@ag-ui/core";
import { z } from "zod";

import { runActorLabelSchema } from "../run-actor.ts";
import { scenarioCriterionResultSchema } from "../scenario-criterion-result.ts";
import {
  SCENARIO_EVALUATION_STATUSES,
  scenarioEvaluationResultSchema,
  type ScenarioEvaluationStatus,
  type ScenarioEvaluationResult,
} from "../scenario-evaluation-result.ts";
import { scenarioMessageSchema } from "../scenario-message.schema.ts";
import { ScenarioEventType, ScenarioRunStatus, Verdict } from "../scenario-run.ts";
import { runParameterValuesSchema } from "../scenario.parameters.ts";

/**
 * AG-UI Base Event Schema
 * Provides the foundation for all events with type, timestamp, and raw event data
 */
const baseEventSchema = z.object({
  type: z.nativeEnum(EventType),
  timestamp: z.number(),
  rawEvent: z.unknown().optional(),
});

/**
 * Batch Run ID Schema
 */
export const batchRunIdSchema = z.string();

/**
 * Scenario Run ID Schema
 */
export const scenarioRunIdSchema = z.string();

/**
 * Scenario ID Schema
 */
export const scenarioIdSchema = z.string();

/**
 * Base Scenario Event Schema
 * Common fields shared by all scenario events including batch tracking and scenario identification.
 * Extends the base event schema with scenario-specific identifiers.
 */
const baseScenarioEventSchema = z.object({
  ...baseEventSchema.shape,
  batchRunId: batchRunIdSchema,
  scenarioId: scenarioIdSchema,
  scenarioRunId: scenarioRunIdSchema,
  scenarioSetId: z
    .string()
    .optional()
    .default("default")
    .transform((v) => v || "default"),
});

/**
 * LangWatch platform metadata schema.
 * Reserved namespace for platform-internal context injected by the suite runner.
 * Direct SDK users should not populate this.
 */
export const langwatchMetadataSchema = z.object({
  targetReferenceId: z.string(),
  targetType: z.enum(["prompt", "http", "code", "workflow", "connected", "voice"]),
  /**
   * The key the target folds under: the reference id alone, or with a hash
   * of its parameter overrides when it carries any. Absent on runs recorded
   * before targets carried parameters, read as the reference id alone.
   * @see specs/features/agent-testing/results-atoms.feature
   */
  targetKey: z.string().optional(),
  /**
   * The parameter overrides of this target alone, so a reader can name the
   * variant. Absent when the target carries none. The merged values the run
   * resolved sit beside the namespace under `parameters`, as they always did.
   */
  targetParameters: runParameterValuesSchema.optional(),
  simulationSuiteId: z.string().optional(),
  /**
   * The version of the scenario when the run was queued. A later edit never
   * changes what an old run says; absent on runs recorded before versions
   * existed.
   * @see specs/scenarios/scenario-version-on-runs.feature
   */
  scenarioVersion: z.number().int().optional(),
  /** Models configured at queue time; unchanged if project default later
   * changes.
   */
  simulatorModel: z.string().optional(),
  judgeModel: z.string().optional(),
  /** Resolved models at queue time: configured, case own choice, or project
   * default; used in run history since project default drifts over time.
   */
  resolvedSimulatorModel: z.string().optional(),
  resolvedJudgeModel: z.string().optional(),
  /** Run starter's user id; absent for project-key and SDK runs; id not name
   * so run still points right person after rename.
   */
  actorId: z.string().optional(),
  actorLabel: runActorLabelSchema.optional(),
  /**
   * The connected agent instance that served the run, recorded when it
   * finished. Absent for every other kind of target, and for a run recorded
   * before instances existed.
   * @see specs/scenarios/served-agent-instance-on-runs.feature
   */
  agentInstance: z.object({ hostname: z.string(), label: z.string().nullable() }).optional(),
  /**
   * Who phoned a voice agent: "simulated" for a pool run's simulated caller,
   * "human" for a panel run someone spoke on themselves (slice 3). Absent
   * for every non-voice run, which the Caller column reads as no caller.
   * @see specs/features/agents/voice-agents-v1.feature (AC24)
   */
  callerKind: z.enum(["simulated", "human"]).optional(),
  /**
   * The effective caller voice a simulated run spoke with: the resolved voice
   * model, the interrupt probability and the effect. Recorded so a finished run
   * reads back the caller settings it ran under (AC20). Absent for non-voice.
   */
  caller: z
    .object({
      voice: z.string(),
      interruptProbability: z.number(),
      effects: z.string(),
    })
    .optional(),
  /**
   * True when LangWatch ended a voice call at VOICE_CALL_MAX_SECONDS; the run
   * header shows "Cut at the call limit" (AC28). Absent otherwise.
   */
  isCutAtLimit: z.boolean().optional(),
});

/** One run participant: agent, user simulator, or judge. Only `agent` role
 * names run target; lives in metadata, not langwatch namespace.
 */
export const scenarioAgentSchema = z.object({
  name: z.string(),
  role: z.enum(["agent", "user", "judge"]),
});

/**
 * User-defined metadata fields pass through via `.passthrough()`; the
 * `langwatch` namespace is strictly validated.
 */
export const scenarioRunStartedSchema = z.object({
  ...baseScenarioEventSchema.shape,
  type: z.literal(ScenarioEventType.RUN_STARTED),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      /** Why the run started; trimmed and dropped when empty so event and
       * platform-stamped notes read the same. No length limit: losing a run
       * over note length is worse than unlimited notes.
       */
      note: z
        .string()
        .trim()
        .transform((note) => (note === "" ? undefined : note))
        .optional(),
      /** Who took part in the run. See {@link scenarioAgentSchema}. */
      agents: z.array(scenarioAgentSchema).optional(),
      langwatch: langwatchMetadataSchema.optional(),
    })
    .passthrough(),
});

export {
  SCENARIO_EVALUATION_STATUSES,
  scenarioEvaluationResultSchema,
  type ScenarioEvaluationStatus,
  type ScenarioEvaluationResult,
};

/**
 * Scenario Results Schema
 * Defines the structure for scenario evaluation results including verdict and criteria analysis.
 * Matches the Python dataclass structure used in the evaluation system.
 */
export const scenarioResultsSchema = z.object({
  verdict: z.nativeEnum(Verdict),
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()),
  unmetCriteria: z.array(z.string()),
  /**
   * Criteria the judge could not decide, each also listed in `unmetCriteria`:
   * an undecided criterion never passes. Absent on results recorded before.
   */
  inconclusiveCriteria: z.array(z.string()).optional(),
  /**
   * Each criterion with its own status and reasoning, in declared order.
   * Absent on SDKs before per-criterion verdicts.
   */
  criteria: z.array(scenarioCriterionResultSchema).optional(),
  error: z.string().optional(),
  /**
   * One result per evaluator that ran on the scenario. Absent on a run with
   * no evaluators, and on results recorded before evaluators existed.
   */
  evaluations: z.array(scenarioEvaluationResultSchema).optional(),
});
export type ScenarioResults = z.infer<typeof scenarioResultsSchema>;

/**
 * Scenario Run Finished Event Schema
 * Captures the completion of a scenario run with final status and evaluation results.
 * Status indicates success/failure, while results contain detailed evaluation outcomes.
 */
export const scenarioRunFinishedSchema = z.object({
  ...baseScenarioEventSchema.shape,
  type: z.literal(ScenarioEventType.RUN_FINISHED),
  status: z.nativeEnum(ScenarioRunStatus),
  results: scenarioResultsSchema.optional().nullable(),
});

/** Voice `input_audio` part: validates both pre-extraction shape
 * `{ data, format }` and post-extraction `{ url, mimeType }`.
 */
const inputAudioContentPartSchema = z.object({
  type: z.literal("input_audio"),
  input_audio: z.object({
    data: z.string().optional(),
    format: z.string().optional(),
    mimeType: z.string().optional(),
    url: z.string().optional(),
    id: z.string().optional(),
  }),
});

/**
 * A message whose `content` array mixes plain text with `input_audio` parts,
 * added as a third message-union member so `MessageSchema` /
 * `chatMessageSchema` keep validating unchanged — purely additive.
 */
const scenarioAudioMessageSchema = z.object({
  role: z.string().optional(),
  content: z.array(
    z.union([z.object({ type: z.literal("text"), text: z.string() }), inputAudioContentPartSchema]),
  ),
});

const agUiToolCallSchema = z.looseObject({
  id: z.string().optional(),
  type: z.literal("function").optional(),
  function: z
    .looseObject({
      name: z.string().optional(),
      arguments: z.string().optional(),
    })
    .optional(),
  encryptedValue: z.string().optional(),
});

/**
 * The AG-UI message boundary, loose so its validator stays out of the Zod graph;
 * the fields restate `@ag-ui/core` MessageSchema so the body documents them as main did.
 */
const agUiMessageSchema = z.looseObject({
  id: z.string(),
  role: z.enum(["developer", "system", "assistant", "user", "tool", "activity", "reasoning"]),
  content: z
    .union([
      z.string(),
      z.array(z.looseObject({ metadata: z.unknown().optional() })),
      z.record(z.string(), z.unknown()),
    ])
    .optional(),
  name: z.string().optional(),
  encryptedValue: z.string().optional(),
  toolCallId: z.string().optional(),
  error: z.string().optional(),
  activityType: z.string().optional(),
  toolCalls: z.array(agUiToolCallSchema).optional(),
  tool_calls: z.array(agUiToolCallSchema).optional(),
});

/**
 * An Anthropic `text` block. `citations` is carried through because zod drops
 * every key a schema does not declare: a block that cites the documents it
 * answered from would otherwise reach the transcript without them.
 */
const anthropicTextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  citations: z.array(z.unknown()).nullish(),
});

const anthropicToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

const anthropicToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
  is_error: z.boolean().optional(),
});

const anthropicThinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string().optional(),
});

const anthropicRedactedThinkingBlockSchema = z.object({
  type: z.literal("redacted_thinking"),
  data: z.string(),
});

/** Anthropic Messages API shape: thinking/text/tool_use blocks; validates
 * before scenarioMessageSchema so tool_result and citations pass through.
 */
const scenarioAnthropicMessageSchema = z.object({
  role: z.string().optional(),
  content: z
    .array(
      z.union([
        anthropicTextBlockSchema,
        anthropicToolUseBlockSchema,
        anthropicToolResultBlockSchema,
        anthropicThinkingBlockSchema,
        anthropicRedactedThinkingBlockSchema,
      ]),
    )
    .refine(
      (blocks) =>
        blocks.some(
          (block) =>
            block.type !== "text" || (block.citations !== undefined && block.citations !== null),
        ),
      {
        message:
          "An Anthropic message carries at least one non-text block, or a text block with citations",
      },
    ),
});

/**
 * Scenario Message Snapshot Event Schema
 * Captures the conversation state at a specific point during scenario execution.
 * Includes searchable_content and payload for full message functionality.
 */
export const scenarioMessageSnapshotSchema = z.object({
  ...baseScenarioEventSchema.shape,
  type: z.literal(ScenarioEventType.MESSAGE_SNAPSHOT),
  messages: z.array(
    z.intersection(
      z.union([
        agUiMessageSchema,
        scenarioAnthropicMessageSchema,
        scenarioMessageSchema,
        scenarioAudioMessageSchema,
      ]),
      z.object({
        id: z.string().optional(),
        trace_id: z.string().optional(),
      }),
    ),
  ),
});

/**
 * Scenario Text Message Start Event Schema
 * Emitted when a message begins (placeholder). Persisted via event-sourcing.
 */
export const scenarioTextMessageStartSchema = z.object({
  ...baseScenarioEventSchema.shape,
  type: z.literal(ScenarioEventType.TEXT_MESSAGE_START),
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});

/**
 * Scenario Text Message End Event Schema
 * Emitted when a message is complete with full content. Persisted via event-sourcing.
 */
export const scenarioTextMessageEndSchema = z.object({
  ...baseScenarioEventSchema.shape,
  type: z.literal(ScenarioEventType.TEXT_MESSAGE_END),
  messageId: z.string(),
  role: z.string(),
  content: z.string().optional(),
  message: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});

/**
 * Scenario Text Message Content Event Schema (broadcast only)
 * Streaming delta for real-time UX, not persisted.
 */
export const scenarioTextMessageContentSchema = z.object({
  ...baseScenarioEventSchema.shape,
  type: z.literal(ScenarioEventType.TEXT_MESSAGE_CONTENT),
  messageId: z.string(),
  delta: z.string(),
});

/**
 * Scenario Tool Call Start Event Schema (broadcast only)
 */
export const scenarioToolCallStartSchema = z.object({
  ...baseScenarioEventSchema.shape,
  type: z.literal(ScenarioEventType.TOOL_CALL_START),
  toolCallId: z.string(),
  toolCallName: z.string(),
  parentMessageId: z.string().optional(),
});

/**
 * Scenario Tool Call Args Event Schema (broadcast only)
 */
export const scenarioToolCallArgsSchema = z.object({
  ...baseScenarioEventSchema.shape,
  type: z.literal(ScenarioEventType.TOOL_CALL_ARGS),
  toolCallId: z.string(),
  delta: z.string(),
});

/**
 * Scenario Tool Call End Event Schema (broadcast only)
 */
export const scenarioToolCallEndSchema = z.object({
  ...baseScenarioEventSchema.shape,
  type: z.literal(ScenarioEventType.TOOL_CALL_END),
  toolCallId: z.string(),
});

/**
 * Scenario Event Union Schema
 * Discriminated union of all possible scenario event types.
 * Enables type-safe handling of different event types based on the 'type' field.
 */
export const scenarioEventSchema = z.discriminatedUnion("type", [
  scenarioRunStartedSchema,
  scenarioRunFinishedSchema,
  scenarioMessageSnapshotSchema,
  scenarioTextMessageStartSchema,
  scenarioTextMessageEndSchema,
  scenarioTextMessageContentSchema,
  scenarioToolCallStartSchema,
  scenarioToolCallArgsSchema,
  scenarioToolCallEndSchema,
]);
