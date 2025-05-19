import type { Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { LlmSignatureNodeFactory } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/slices/factories/llm-signature-node.factory";
import type {
  LlmPromptConfigComponent,
  Workflow,
  ExecutionState,
} from "~/optimization_studio/types/dsl";
import { createLogger } from "~/utils/logger";
import { fetchSSE } from "~/utils/sse/fetchSSE";
import type { StudioServerEvent } from "~/optimization_studio/types/events";

const logger = createLogger("invokeLLM");

export interface PromptExecutionResult {
  status: string;
  output?: string;
  error?: string;
  executionState?: ExecutionState;
}

/**
 * Executes a prompt configuration by creating a minimal workflow
 */
export async function invokeLLM({
  projectId,
  data,
}: {
  projectId: string;
  data: Node<LlmPromptConfigComponent>["data"];
}): Promise<PromptExecutionResult> {
  try {
    // Generate unique IDs for tracing and node identification
    const traceId = `trace_${nanoid()}`;
    const nodeId = `prompt_node`;
    const workflowId = `prompt_execution_${nanoid(6)}`;

    // Create minimal workflow with signature node
    const workflow: Workflow = createWorkflow(workflowId, nodeId, data);

    // Extract input values from the data
    const inputs = extractInputs(data);

    // Create the event payload
    const event = createEventPayload(traceId, workflow, nodeId, inputs);

    // Result object that we'll update as events arrive
    const result: PromptExecutionResult = { status: "waiting" };

    // Fetch and process workflow events
    await fetchSSE<StudioServerEvent>({
      endpoint: "/api/workflows/post_event",
      payload: { projectId, event },
      timeout: 20000,

      // Process each event as it arrives
      onEvent: (serverEvent) => {
        if (
          serverEvent.type === "component_state_change" &&
          serverEvent.payload?.component_id === nodeId
        ) {
          const executionState = serverEvent.payload.execution_state;

          if (!executionState) {
            logger.warn("No execution state received");
            return;
          }

          // Update result with execution state
          result.status = executionState.status;
          result.executionState = executionState;

          if (executionState.outputs?.output) {
            result.output = executionState.outputs.output;
          }

          if (executionState.error) {
            result.error = executionState.error;
          }
        }

        if (serverEvent.type === "error") {
          result.status = "error";
          result.error = serverEvent.payload.message;
        }
      },

      // Determine when to stop processing
      shouldStopProcessing: (serverEvent) => {
        // If we received a terminal status, stop processing
        if (
          result.status &&
          ["completed", "error", "cancelled"].includes(result.status)
        ) {
          return true;
        }

        // Also stop on error events
        return serverEvent.type === "error";
      },

      // Handle errors during the stream processing
      onError: (error) => {
        result.status = "error";
        result.error = error.message;
      },
    });

    return result;
  } catch (error) {
    // Handle any errors outside the SSE processing
    logger.error({ error, projectId, data }, "Error executing prompt");
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Creates a workflow object for prompt execution
 */
function createWorkflow(
  workflowId: string,
  nodeId: string,
  data: Node<LlmPromptConfigComponent>["data"]
): Workflow {
  return {
    spec_version: "1.4",
    workflow_id: workflowId,
    name: "Prompt Execution",
    icon: "",
    description: "",
    version: "1.0",
    default_llm: {
      model: "gpt-4o",
    },
    template_adapter: "default",
    enable_tracing: true,
    nodes: [
      {
        ...LlmSignatureNodeFactory.build({
          id: nodeId,
          data,
        }),
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    state: { execution: { status: "idle" } },
  };
}

/**
 * Extracts input values from the prompt configuration data
 */
function extractInputs(
  data: Node<LlmPromptConfigComponent>["data"]
): Record<string, string> {
  return (
    data.inputs?.reduce(
      (acc, input) => {
        acc[input.identifier] = input.value as string;
        return acc;
      },
      {} as Record<string, string>
    ) || {}
  );
}

/**
 * Creates the event payload for the API request
 */
function createEventPayload(
  traceId: string,
  workflow: Workflow,
  nodeId: string,
  inputs: Record<string, string>
) {
  return {
    type: "execute_component",
    payload: {
      trace_id: traceId,
      workflow,
      node_id: nodeId,
      inputs,
    },
  };
}
