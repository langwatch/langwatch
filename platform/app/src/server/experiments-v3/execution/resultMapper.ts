/**
 * ResultMapper - Maps NLP server events to Evaluations V3 SSE events.
 *
 * The workflow builder creates node IDs in the format:
 * - Target nodes: "{targetId}" (e.g., "target-1")
 * - Evaluator nodes: "{targetId}.{evaluatorId}" (e.g., "target-1.eval-1")
 *
 * This mapper extracts those IDs and transforms NLP events into the
 * appropriate SSE event format for the frontend.
 */

import { HandledError } from "@langwatch/handled-error";
import { trace as otelTrace } from "@opentelemetry/api";

import type { StudioServerEvent } from "~/optimization_studio/types/events";
import { nodeErrorToDomainError } from "~/optimization_studio/utils/nodeErrorDomain";
import { EvaluatorExecutionError } from "~/server/app-layer/evaluations/errors";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators";
import {
  type EvaluationV3EvaluatorResult,
  type EvaluationV3Event,
  UNNAMED_FAILURE,
} from "./types";

/**
 * Configuration for result mapping.
 */
export type ResultMapperConfig = {
  /**
   * Set of evaluator IDs whose scores should be stripped.
   * This is used for guardrail-type evaluators where the score is just 0 or 1
   * and doesn't provide meaningful information beyond the pass/fail status.
   */
  stripScoreEvaluatorIds?: Set<string>;
  /**
   * Set of target node IDs that are evaluator-as-target.
   * Used to detect evaluator outputs without relying on a heuristic.
   */
  evaluatorTargetNodeIds?: Set<string>;
};

/**
 * Parses a composite node ID to extract targetId and optional evaluatorId.
 *
 * Node ID patterns:
 * - "target-1" -> { targetId: "target-1", evaluatorId: undefined }
 * - "target-1.eval-1" -> { targetId: "target-1", evaluatorId: "eval-1" }
 */
export const parseNodeId = (
  nodeId: string,
): { targetId: string; evaluatorId?: string } => {
  const dotIndex = nodeId.indexOf(".");
  if (dotIndex === -1) {
    return { targetId: nodeId };
  }
  return {
    targetId: nodeId.substring(0, dotIndex),
    evaluatorId: nodeId.substring(dotIndex + 1),
  };
};

/**
 * Checks if a node ID represents an evaluator node.
 */
export const isEvaluatorNode = (nodeId: string): boolean => {
  return nodeId.includes(".");
};

/**
 * Coerces a value to a number score.
 * Handles native numbers and string representations (e.g. "0.85" from workflow evaluators).
 */
export const coerceScore = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
};

/**
 * Coerces a value to a boolean passed status.
 * Handles native booleans and string representations (e.g. "true"/"false" from workflow evaluators).
 */
export const coercePassed = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return undefined;
};

const HTTP_STATUS_PREFIX_PATTERN = /^\s*(\d{3})\b/;

const classifyEvaluatorExecutionError = (
  rawMessage: string,
): EvaluatorExecutionError | undefined => {
  const status = Number(rawMessage.match(HTTP_STATUS_PREFIX_PATTERN)?.[1]);
  if (status !== 401 && status !== 403) return undefined;

  return new EvaluatorExecutionError(rawMessage, {
    meta: { httpStatus: status, reason: "auth_failed" },
    // A 401/403 from the evaluator's LLM call is the customer's credential or
    // config, not our backend — override the class's platform default.
    // `meta.reason` carries the typed sub-classifier (same convention as the
    // Go envelopes) so clients can branch without parsing the message.
    fault: "customer",
    tips: [
      "Check the API key and model configuration for this evaluator — the provider rejected the call with 401/403",
    ],
  });
};

/**
 * Extracts target output from execution outputs.
 *
 * Strategy:
 * 1. If isEvaluatorAsTarget -> filter null/undefined values, return undefined if empty
 *    This handles evaluator-as-target where the evaluator outputs become target output.
 *    Uses an explicit marker instead of a heuristic so custom-only evaluators are detected.
 * 2. If outputs has exactly one key named "output" -> return its value (backward compatible)
 * 3. Otherwise -> return full outputs object (preserves structure for custom fields)
 *
 * The client-side formatTargetOutput utility handles display formatting.
 * This ensures structured outputs like {pizza: false} are preserved for display.
 */
export const extractTargetOutput = (
  outputs: Record<string, unknown> | undefined,
  options?: { isEvaluatorAsTarget?: boolean },
): unknown => {
  if (!outputs) return undefined;

  // Evaluator-as-target: return all non-null/undefined output fields dynamically.
  // This avoids hardcoding specific field names (like `details`) which can cause
  // "sticky" fields that persist even after removal from the End node.
  if (options?.isEvaluatorAsTarget) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(outputs)) {
      if (value !== undefined && value !== null) {
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  // Empty outputs
  const keys = Object.keys(outputs);
  if (keys.length === 0) return undefined;

  // Only unwrap if there's exactly one key named "output"
  // This maintains backward compatibility with standard prompts/signatures
  // while preserving structured outputs like {pizza: false} for display
  if (keys.length === 1 && keys[0] === "output") {
    return outputs.output;
  }

  // Return full object for all other cases:
  // - Multiple fields like {result, reason}
  // - Single field with non-"output" name like {pizza: false}
  return outputs;
};

/**
 * Wall-clock duration from a pair of epoch-millisecond timestamps.
 *
 * Guards on `undefined` rather than truthiness. The target and evaluator
 * paths each computed this inline and had already drifted on that point, and
 * a truthy test reads a `started_at` of 0 as "no timestamp" — unreachable
 * with real epoch milliseconds, but the two readers of one field disagreeing
 * is worth removing rather than reasoning about.
 */
const durationOf = (
  timestamps: { started_at?: number; finished_at?: number } | undefined,
): number | undefined =>
  timestamps?.started_at !== undefined && timestamps?.finished_at !== undefined
    ? timestamps.finished_at - timestamps.started_at
    : undefined;

/**
 * Maps a target completion event to a target_result SSE event.
 */
export const mapTargetResult = (
  nodeId: string,
  rowIndex: number,
  executionState: {
    outputs?: Record<string, unknown>;
    cost?: number;
    timestamps?: { started_at?: number; finished_at?: number };
    trace_id?: string;
    error?: string;
    error_type?: string;
    upstream_status?: number;
  },
  options?: { isEvaluatorAsTarget?: boolean },
): EvaluationV3Event => {
  const { targetId } = parseNodeId(nodeId);

  const duration = durationOf(executionState.timestamps);

  // A coded engine failure travels the handled channel; the raw `error`
  // string is kept only as a legacy fallback for engines that don't send a
  // code. See `nodeErrorToDomainError`.
  const domainError = executionState.error_type
    ? nodeErrorToDomainError({
        errorType: executionState.error_type,
        message: executionState.error,
        upstreamStatus: executionState.upstream_status,
        traceId: executionState.trace_id,
      })
    : undefined;

  return {
    type: "target_result",
    rowIndex,
    targetId,
    output: extractTargetOutput(executionState.outputs, {
      isEvaluatorAsTarget: options?.isEvaluatorAsTarget,
    }),
    cost: executionState.cost,
    duration,
    traceId: executionState.trace_id,
    error: executionState.error,
    ...(domainError ? { domainError } : {}),
  };
};

/**
 * The part of an evaluator's request worth keeping forever.
 *
 * Only the candidate IDS are ever read back — `readCandidateIds` rebuilds the
 * per-row matchup set from them for the leaderboard. The rest of the payload
 * (every candidate's full output text, the golden answer, the task input,
 * per-candidate cost and duration) duplicates data the run already stores per
 * target, and it is not cheap duplication: it reaches ClickHouse twice, in the
 * event log and in `experiment_run_items.EvaluationInputs`, is handed to the
 * browser by a `SELECT *`, and is billed against the storage meter — all at
 * rows × targets × evaluators. On main this column was null for orchestrator
 * runs, so persisting the whole payload would have been a new cost introduced
 * by this branch rather than an existing one it inherited.
 *
 * Returns undefined when there is no candidate list, so every non-Comparison
 * evaluator persists nothing here rather than an empty object.
 */
const persistableInputs = (
  inputs: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  const candidates = inputs?.candidates;
  if (!Array.isArray(candidates)) return undefined;

  return {
    candidates: candidates.map((candidate) => ({
      id:
        candidate && typeof candidate === "object"
          ? (candidate as { id?: unknown }).id
          : undefined,
    })),
  };
};

/**
 * Maps an evaluator completion event to an evaluator_result SSE event.
 *
 * @param nodeId - The node ID in format "{targetId}.{evaluatorId}"
 * @param rowIndex - The dataset row index
 * @param executionState - The execution state from langwatch_nlp
 * @param options - Additional options
 * @param options.stripScore - If true, the score will be omitted from the result
 */
export const mapEvaluatorResult = (
  nodeId: string,
  rowIndex: number,
  executionState: {
    status: string;
    outputs?: Record<string, unknown>;
    cost?: number;
    timestamps?: { started_at?: number; finished_at?: number };
    error?: string;
  },
  options?: {
    stripScore?: boolean;
    /**
     * The evaluator's own request payload (e.g. a Comparison evaluator's
     * ordered `candidates` list). Persisted alongside the result so
     * downstream aggregation (Bradley-Terry leaderboard) can recover which
     * variants the judge actually compared on this row — the response alone
     * only names the winner, not the full candidate set.
     */
    inputs?: Record<string, unknown>;
  },
): EvaluationV3Event => {
  const { targetId, evaluatorId } = parseNodeId(nodeId);

  if (!evaluatorId) {
    throw new Error(`Expected evaluator node ID but got: ${nodeId}`);
  }

  const duration = durationOf(executionState.timestamps);

  // Build SingleEvaluationResult
  // Check for errors: either execution-level error OR evaluator returned error status in outputs
  const hasExecutionError = !!executionState.error;
  const hasEvaluatorError = executionState.outputs?.status === "error";

  const rawErrorDetails =
    executionState.error ??
    (executionState.outputs?.details as string | undefined) ??
    "Unknown evaluator error";
  const classifiedDomainError = classifyEvaluatorExecutionError(rawErrorDetails);

  const result: SingleEvaluationResult & {
    domainError?: ReturnType<EvaluatorExecutionError["serialize"]>;
  } =
    hasExecutionError || hasEvaluatorError
      ? {
          status: "error",
          error_type: "EvaluatorError",
          details: rawErrorDetails,
          traceback: [],
          ...(classifiedDomainError
            ? { domainError: classifiedDomainError.serialize() }
            : {}),
        }
      : {
          status: "processed",
          // Strip score for guardrail-type evaluators where score is just 0 or 1
          score: options?.stripScore
            ? undefined
            : coerceScore(executionState.outputs?.score),
          passed: coercePassed(executionState.outputs?.passed),
          label:
            typeof executionState.outputs?.label === "string"
              ? executionState.outputs.label
              : undefined,
          // Only include details when it's a non-empty string.
          // Python's EvaluationResultWithMetadata always serializes details
          // (default None -> null), so we filter out null/undefined to prevent
          // the "sticky details" bug where details appears even after removal.
          details:
            typeof executionState.outputs?.details === "string" &&
            executionState.outputs.details
              ? executionState.outputs.details
              : undefined,
          cost: executionState.cost
            ? { currency: "USD", amount: executionState.cost }
            : undefined,
        };

  return {
    type: "evaluator_result",
    rowIndex,
    targetId,
    evaluatorId,
    result,
    duration,
    inputs: persistableInputs(options?.inputs),
  };
};

/**
 * Maps an NLP server event to an Evaluations V3 SSE event.
 *
 * @param event - The NLP server event
 * @param rowIndex - The dataset row index this event corresponds to
 * @param targetNodes - Set of node IDs that are target nodes (not evaluators)
 * @param config - Optional configuration for result mapping
 * @param evaluatorInputs - The request payload sent to the evaluator for this
 * cell (only relevant when the event's node is an evaluator node); passed
 * through untouched to `mapEvaluatorResult`.
 * @returns The mapped SSE event, or null if the event should be ignored
 */
export const mapNlpEvent = ({
  event,
  rowIndex,
  targetNodes,
  config,
  evaluatorInputs,
}: {
  event: StudioServerEvent;
  rowIndex: number;
  targetNodes: Set<string>;
  config?: ResultMapperConfig;
  evaluatorInputs?: Record<string, unknown>;
}): EvaluationV3Event | null => {
  if (event.type !== "component_state_change") {
    // Ignore non-component events (debug, done, etc.)
    return null;
  }

  const { component_id, execution_state } = event.payload;

  // Skip if not a success or error state
  if (execution_state?.status !== "success" && execution_state?.status !== "error") {
    return null;
  }

  // Skip entry node
  if (component_id === "entry") {
    return null;
  }

  const isError = execution_state.status === "error";

  // Determine if this is a target or evaluator node
  if (targetNodes.has(component_id)) {
    // Target node
    const isEvaluatorAsTarget =
      config?.evaluatorTargetNodeIds?.has(component_id) ?? false;
    return mapTargetResult(
      component_id,
      rowIndex,
      {
        outputs: execution_state.outputs,
        cost: execution_state.cost,
        timestamps: execution_state.timestamps,
        trace_id: execution_state.trace_id,
        error: isError ? execution_state.error : undefined,
        error_type: isError ? execution_state.error_type : undefined,
        upstream_status: isError ? execution_state.upstream_status : undefined,
      },
      { isEvaluatorAsTarget },
    );
  } else if (isEvaluatorNode(component_id)) {
    // Evaluator node - check if score should be stripped
    const { evaluatorId } = parseNodeId(component_id);
    const stripScore = evaluatorId
      ? config?.stripScoreEvaluatorIds?.has(evaluatorId)
      : false;

    return mapEvaluatorResult(
      component_id,
      rowIndex,
      {
        status: execution_state.status,
        outputs: execution_state.outputs,
        cost: execution_state.cost,
        timestamps: execution_state.timestamps,
        error: isError ? execution_state.error : undefined,
      },
      { stripScore, inputs: evaluatorInputs },
    );
  }

  // Unknown node type
  return null;
};

/**
 * Maps a *thrown* failure to an error SSE event.
 *
 * A handled error travels as its code on `domainError`, and the client renders
 * the registry's copy for it. An unhandled one has nothing safe to say — its
 * `message` can carry a Prisma string, a hostname or a Go net error — so the
 * frame carries {@link UNNAMED_FAILURE}, a marker, and the client's own
 * fallback copy owns the words. See ADR-045.
 *
 * The failure's own message is neither sent nor stored. It goes to the log
 * line at the catch site, beside the trace id this frame carries, which is
 * what ties "it broke" to what actually broke. Storing it instead put a
 * `connect ECONNREFUSED 10.0.0.5:5432` into the customer's cell every time
 * they reloaded the run.
 */
export const mapThrownErrorEvent = ({
  error,
  rowIndex,
  targetId,
  evaluatorId,
}: {
  error: unknown;
  rowIndex?: number;
  targetId?: string;
  evaluatorId?: string;
}): EvaluationV3Event => {
  const activeTraceId = otelTrace.getActiveSpan()?.spanContext().traceId;

  if (HandledError.isHandled(error)) {
    return {
      type: "error",
      // The wire message for a handled error is its code (#5984).
      message: error.code,
      domainError: error.serialize(),
      traceId: error.traceId ?? activeTraceId,
      rowIndex,
      targetId,
      evaluatorId,
    };
  }

  return {
    type: "error",
    message: UNNAMED_FAILURE,
    traceId: activeTraceId,
    rowIndex,
    targetId,
    evaluatorId,
  };
};

/**
 * Maps a studio workflow evaluator node's execution state to an
 * evaluator_result event.
 *
 * Unlike mapEvaluatorResult (which parses the v3 "{targetId}.{evaluatorId}"
 * node-id convention of a generated mini-workflow), this maps an evaluator node
 * from a real studio workflow run, keyed by the evaluator's own DSL node id.
 * Workflow evaluators can return stringy score/passed values, so they go
 * through coerceScore/coercePassed like the legacy workflow-evaluation path.
 */
export const mapWorkflowEvaluatorResult = (
  rowIndex: number,
  targetId: string,
  evaluatorId: string,
  evaluatorName: string | undefined,
  executionState: {
    status: string;
    outputs?: Record<string, unknown>;
    cost?: number;
    error?: string;
    /**
     * The engine's stable code for the failure (`NodeError.Type`).
     *
     * Named apart from the result's own `error_type` below, which is a
     * free-text display label ("EvaluatorError") on `SingleEvaluationResult`.
     * One identifier meaning both a stable code and a display string, twelve
     * lines apart, is how a code ends up rendered as a label.
     */
    nodeErrorCode?: string;
    upstream_status?: number;
    trace_id?: string;
  },
): EvaluationV3Event => {
  const hasExecutionError = !!executionState.error;
  const hasEvaluatorError =
    executionState.status === "error" || executionState.outputs?.status === "error";

  // A coded engine failure travels the handled channel, exactly as on the
  // target side (`mapTargetResult`): the client renders registry copy for the
  // code and keeps `details` for the raw-text popover. See
  // `nodeErrorToDomainError`.
  const domainError = executionState.nodeErrorCode
    ? nodeErrorToDomainError({
        errorType: executionState.nodeErrorCode,
        message: executionState.error,
        upstreamStatus: executionState.upstream_status,
        traceId: executionState.trace_id,
      })
    : undefined;

  const result: EvaluationV3EvaluatorResult =
    hasExecutionError || hasEvaluatorError
      ? {
          status: "error",
          error_type: "EvaluatorError",
          details:
            executionState.error ??
            (typeof executionState.outputs?.details === "string"
              ? executionState.outputs.details
              : undefined) ??
            "Unknown evaluator error",
          traceback: [],
          ...(domainError ? { domainError } : {}),
        }
      : {
          status: "processed",
          score: coerceScore(executionState.outputs?.score),
          passed: coercePassed(executionState.outputs?.passed),
          label:
            typeof executionState.outputs?.label === "string"
              ? executionState.outputs.label
              : undefined,
          details:
            typeof executionState.outputs?.details === "string" &&
            executionState.outputs.details
              ? executionState.outputs.details
              : undefined,
          cost: executionState.cost
            ? { currency: "USD", amount: executionState.cost }
            : undefined,
        };

  return {
    type: "evaluator_result",
    rowIndex,
    targetId,
    evaluatorId,
    evaluatorName,
    result,
  };
};
