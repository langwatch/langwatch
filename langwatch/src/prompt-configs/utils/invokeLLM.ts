import type { Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { LlmSignatureNodeFactory } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/slices/factories/llm-signature-node.factory";
import type {
  LlmPromptConfigComponent,
  Workflow,
  ExecutionState,
} from "~/optimization_studio/types/dsl";
import { createLogger } from "~/utils/logger";

const logger = createLogger("invokeLLM");

export interface PromptExecutionResult {
  status: string;
  output?: string;
  error?: string;
  executionState?: ExecutionState; // Full execution state from the server
}

/**
 * Executes a prompt configuration by creating a minimal workflow and processing the server-sent events response.
 *
 * @param projectId - The ID of the project
 * @param data - The LLM prompt configuration data
 * @returns A promise that resolves to the execution result
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

    // Send request and get response
    const response = await sendRequest(projectId, event);

    // Process the SSE stream
    return await processSSEStream(response, nodeId);
  } catch (error) {
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
  const event = {
    type: "execute_component",
    payload: {
      trace_id: traceId,
      workflow,
      node_id: nodeId,
      inputs,
    },
  };

  return event;
}

/**
 * Sends the request to the API endpoint
 */
async function sendRequest(projectId: string, event: any): Promise<Response> {
  const response = await fetch("/api/workflows/post_event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId, event }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || response.statusText);
  }

  return response;
}

/**
 * Processes the server-sent events stream from the response
 */
async function processSSEStream(
  response: Response,
  nodeId: string
): Promise<PromptExecutionResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  // For parsing SSE events
  const decoder = new TextDecoder();
  let buffer = "";
  let result: PromptExecutionResult = { status: "waiting" };

  try {
    // Read the stream
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      if (buffer.includes("\n\n")) {
        const chunks = buffer.split("\n\n");
        const readyChunks = chunks.slice(0, -1).join("\n\n");
        processEvents(readyChunks, result, nodeId);
        buffer = chunks[chunks.length - 1] ?? "";
      }

      // If we have a completed or error state, we can exit early
      if (["completed", "error", "cancelled"].includes(result.status)) {
        break;
      }
    }

    // Process any remaining events in buffer
    if (buffer) {
      processEvents(buffer, result, nodeId);
    }

    return result;
  } finally {
    // Always release the reader
    reader.releaseLock();
  }
}

/**
 * Processes SSE event chunks and updates the result object
 */
function processEvents(
  chunk: string,
  result: PromptExecutionResult,
  nodeId: string
): void {
  const events = chunk.split("\n\n").filter(Boolean);

  for (const event of events) {
    if (event.startsWith("data: ")) {
      try {
        const serverEvent = JSON.parse(event.slice(6));

        if (
          serverEvent.type === "component_state_change" &&
          serverEvent.payload?.component_id === nodeId
        ) {
          const executionState = serverEvent.payload.execution_state;
          result.status = executionState.status;
          result.executionState = executionState; // Store the full execution state

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
      } catch (error) {
        logger.error(
          { error, chunk, result, nodeId },
          "Error parsing SSE event"
        );
      }
    }
  }
}
