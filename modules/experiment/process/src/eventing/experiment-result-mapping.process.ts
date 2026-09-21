/**
 * Maps NLP server events to Evaluations V3 SSE events, extracting node IDs from the workflow
 * builder's format and transforming them for the frontend.
 */

import { EvaluatorExecutionError } from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import {
  type EvaluationV3EvaluatorResult,
  type EvaluationV3Event,
  UNNAMED_FAILURE,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { nodeErrorToDomainError, type StudioServerEvent } from "@langwatch/workflow-contract";
import { trace as otelTrace } from "@opentelemetry/api";

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
 * Parses a composite node ID into `targetId` and an optional `evaluatorId`,
 * e.g. `"target-1.eval-1"` -> `{ targetId: "target-1", evaluatorId: "eval-1" }`.
 */
export const parseNodeId = (nodeId: string): { targetId: string; evaluatorId?: string } => {
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
 * Handles native booleans and string representations (e.g., "true"/"false" from workflow
 * evaluators).
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
 * Extracts target output from execution outputs, handling evaluator-as-target and backward
 * compatibility for the "output" key. Client-side formatTargetOutput handles display.
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
 * Guards on `undefined` rather than truthiness to avoid treating 0 as "no timestamp".
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
 * Persists only candidate IDs from an evaluator's request; other fields duplicate data already
 * stored per target. Returns undefined for non-Comparison evaluators.
 */
const persistableInputs = (
  inputs: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  const candidates = inputs?.candidates;
  if (!Array.isArray(candidates)) return undefined;

  return {
    candidates: candidates.map((candidate) => ({
      id:
        candidate && typeof candidate === "object" ? (candidate as { id?: unknown }).id : undefined,
    })),
  };
};

/**
 * What the evaluator spent, as the result carries it. An absent cost is not a
 * zero cost: 0 says it spent nothing, absent says it does not know, and the
 * stored row keeps them apart.
 */
const billedCost = (cost: number | undefined): { currency: "USD"; amount: number } | undefined =>
  typeof cost === "number" ? { currency: "USD", amount: cost } : undefined;

/**
 * The result of an evaluator that declined the row. The reason travels in
 * details; whatever it spent before declining is kept, since a skip is not
 * an error and may still have cost something.
 */
const skippedResult = (executionState: {
  outputs?: Record<string, unknown>;
  cost?: number;
}): SingleEvaluationResult => {
  const cost = billedCost(executionState.cost);
  return {
    status: "skipped",
    ...(typeof executionState.outputs?.details === "string" && executionState.outputs.details
      ? { details: executionState.outputs.details }
      : {}),
    ...(cost ? { cost } : {}),
  };
};

/**
 * The result of an evaluator that failed outright, either at execution or by
 * returning an error status. A recognised 401/403 carries a customer-facing
 * domain error; anything else stays an opaque failure.
 */
const errorResult = (
  executionError: string | undefined,
  outputs: Record<string, unknown> | undefined,
): SingleEvaluationResult & { domainError?: ReturnType<EvaluatorExecutionError["serialize"]> } => {
  const rawErrorDetails =
    executionError ?? (outputs?.details as string | undefined) ?? "Unknown evaluator error";
  const classifiedDomainError = classifyEvaluatorExecutionError(rawErrorDetails);
  return {
    status: "error",
    error_type: "EvaluatorError",
    details: rawErrorDetails,
    traceback: [],
    ...(classifiedDomainError ? { domainError: classifiedDomainError.serialize() } : {}),
  };
};

/**
 * The result of an evaluator that scored the row, strips a guardrail's score
 * on request, and keeps `details` only when it is a non-empty string (a null
 * default would otherwise stick around after the field is cleared).
 */
const processedResult = (
  executionState: { outputs?: Record<string, unknown>; cost?: number },
  options?: { stripScore?: boolean },
): SingleEvaluationResult => ({
  status: "processed",
  score: options?.stripScore ? undefined : coerceScore(executionState.outputs?.score),
  passed: coercePassed(executionState.outputs?.passed),
  label:
    typeof executionState.outputs?.label === "string" ? executionState.outputs.label : undefined,
  details:
    typeof executionState.outputs?.details === "string" && executionState.outputs.details
      ? executionState.outputs.details
      : undefined,
  cost: billedCost(executionState.cost),
});

/**
 * Maps an evaluator completion event to an evaluator_result SSE event.
 *
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
     * The evaluator's own request payload (e.g. Comparison's ordered
     * `candidates`). Persisted so the Bradley-Terry leaderboard can recover
     * which variants were compared — the response alone only names the winner.
     */
    inputs?: Record<string, unknown>;
  },
): EvaluationV3Event => {
  const { targetId, evaluatorId } = parseNodeId(nodeId);

  if (!evaluatorId) {
    throw new Error(`Expected evaluator node ID but got: ${nodeId}`);
  }

  const duration = durationOf(executionState.timestamps);

  // Check for errors: either execution-level error OR evaluator returned error status in outputs
  const hasEvaluatorError = !!executionState.error || executionState.outputs?.status === "error";

  let result: SingleEvaluationResult & {
    domainError?: ReturnType<EvaluatorExecutionError["serialize"]>;
  };
  if (hasEvaluatorError) {
    result = errorResult(executionState.error, executionState.outputs);
  } else if (executionState.outputs?.status === "skipped") {
    result = skippedResult(executionState);
  } else {
    result = processedResult(executionState, options);
  }

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
 * Maps an NLP server event to an Evaluations V3 SSE event, or null if the event should be ignored.
 *
 * @param evaluatorInputs - The request payload sent to the evaluator; passed through to
 * `mapEvaluatorResult`.
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
    const isEvaluatorAsTarget = config?.evaluatorTargetNodeIds?.has(component_id) ?? false;
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
    const stripScore = evaluatorId ? config?.stripScoreEvaluatorIds?.has(evaluatorId) : false;

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
 * Maps a *thrown* failure to an error SSE event. Handled errors send their code; unhandled
 * errors send UNNAMED_FAILURE with a trace id for log correlation (see ADR-045).
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
 * The result of a workflow evaluator node that failed, on the same coded
 * handled channel as `mapTargetResult`. See `nodeErrorToDomainError`.
 */
const workflowErrorResult = (executionState: {
  outputs?: Record<string, unknown>;
  error?: string;
  nodeErrorCode?: string;
  upstream_status?: number;
  trace_id?: string;
}): EvaluationV3EvaluatorResult => {
  const domainError = executionState.nodeErrorCode
    ? nodeErrorToDomainError({
        errorType: executionState.nodeErrorCode,
        message: executionState.error,
        upstreamStatus: executionState.upstream_status,
        traceId: executionState.trace_id,
      })
    : undefined;
  return {
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
  };
};

/**
 * Maps a studio workflow evaluator node's execution state to an evaluator_result event.
 * Unlike mapEvaluatorResult, this handles stringy score/passed values through coercion.
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
     * The engine's stable code for the failure (`NodeError.Type`). Named apart
     * from the result's own `error_type`, a free-text display label
     * ("EvaluatorError") — conflating the two renders a code as a label.
     */
    nodeErrorCode?: string;
    upstream_status?: number;
    trace_id?: string;
  },
): EvaluationV3Event => {
  const hasEvaluatorError =
    !!executionState.error ||
    executionState.status === "error" ||
    executionState.outputs?.status === "error";

  let result: EvaluationV3EvaluatorResult;
  if (hasEvaluatorError) {
    result = workflowErrorResult(executionState);
  } else if (executionState.outputs?.status === "skipped") {
    result = skippedResult(executionState);
  } else {
    result = processedResult(executionState);
  }

  return {
    type: "evaluator_result",
    rowIndex,
    targetId,
    evaluatorId,
    evaluatorName,
    result,
  };
};
