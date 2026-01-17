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

import type { StudioServerEvent } from "~/optimization_studio/types/events";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";
import type { EvaluationV3Event } from "./types";

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
  },
): EvaluationV3Event => {
  const { targetId } = parseNodeId(nodeId);

  // Calculate duration if timestamps available
  const duration =
    executionState.timestamps?.started_at &&
    executionState.timestamps?.finished_at
      ? executionState.timestamps.finished_at -
        executionState.timestamps.started_at
      : undefined;

  return {
    type: "target_result",
    rowIndex,
    targetId,
    output: executionState.outputs?.output,
    cost: executionState.cost,
    duration,
    traceId: executionState.trace_id,
    error: executionState.error,
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
  options?: { stripScore?: boolean },
): EvaluationV3Event => {
  const { targetId, evaluatorId } = parseNodeId(nodeId);

  if (!evaluatorId) {
    throw new Error(`Expected evaluator node ID but got: ${nodeId}`);
  }

  // Calculate duration if timestamps available
  const _duration =
    executionState.timestamps?.started_at &&
    executionState.timestamps?.finished_at
      ? executionState.timestamps.finished_at -
        executionState.timestamps.started_at
      : undefined;

  // Build SingleEvaluationResult
  const result: SingleEvaluationResult = executionState.error
    ? {
        status: "error",
        error_type: "EvaluatorError",
        details: executionState.error,
        traceback: [],
      }
    : {
        status: "processed",
        // Strip score for guardrail-type evaluators where score is just 0 or 1
        score: options?.stripScore
          ? undefined
          : (executionState.outputs?.score as number | undefined),
        passed: executionState.outputs?.passed as boolean | undefined,
        label: executionState.outputs?.label as string | undefined,
        details: executionState.outputs?.details as string | undefined,
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
  };
};

/**
 * Maps an NLP server event to an Evaluations V3 SSE event.
 *
 * @param event - The NLP server event
 * @param rowIndex - The dataset row index this event corresponds to
 * @param targetNodes - Set of node IDs that are target nodes (not evaluators)
 * @param config - Optional configuration for result mapping
 * @returns The mapped SSE event, or null if the event should be ignored
 */
export const mapNlpEvent = (
  event: StudioServerEvent,
  rowIndex: number,
  targetNodes: Set<string>,
  config?: ResultMapperConfig,
): EvaluationV3Event | null => {
  if (event.type !== "component_state_change") {
    // Ignore non-component events (debug, done, etc.)
    return null;
  }

  const { component_id, execution_state } = event.payload;

  // Skip if not a success or error state
  if (
    execution_state?.status !== "success" &&
    execution_state?.status !== "error"
  ) {
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
    return mapTargetResult(component_id, rowIndex, {
      outputs: execution_state.outputs,
      cost: execution_state.cost,
      timestamps: execution_state.timestamps,
      trace_id: execution_state.trace_id,
      error: isError ? execution_state.error : undefined,
    });
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
      { stripScore },
    );
  }

  // Unknown node type
  return null;
};

/**
 * Maps an error event to an error SSE event.
 */
export const mapErrorEvent = (
  message: string,
  rowIndex?: number,
  targetId?: string,
  evaluatorId?: string,
): EvaluationV3Event => {
  return {
    type: "error",
    message,
    rowIndex,
    targetId,
    evaluatorId,
  };
};
