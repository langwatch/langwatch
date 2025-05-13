import type { Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { LlmSignatureNodeFactory } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/slices/factories/llm-signature-node.factory";
import type {
  LlmPromptConfigComponent,
  Workflow,
  ExecutionState,
} from "~/optimization_studio/types/dsl";

export interface PromptExecutionResult {
  status: string;
  output?: string;
  error?: string;
  executionState?: ExecutionState; // Full execution state from the server
}

export async function executePrompt({
  projectId,
  data,
}: {
  projectId: string;
  data: Node<LlmPromptConfigComponent>["data"];
}): Promise<PromptExecutionResult> {
  try {
    // Generate trace ID
    const traceId = `trace_${nanoid()}`;
    const nodeId = `prompt_node`;

    // Create minimal workflow with signature node
    const workflow: Workflow = {
      spec_version: "1.4",
      workflow_id: `prompt_execution_${nanoid(6)}`,
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

    const inputs = data.inputs?.reduce(
      (acc, input) => {
        acc[input.identifier] = input.value as string;
        return acc;
      },
      {} as Record<string, string>
    );

    // Create the event to send
    const event = {
      type: "execute_component",
      payload: {
        trace_id: traceId,
        workflow,
        node_id: nodeId,
        inputs,
      },
    };

    console.log("Event:", event);

    // Send request via fetch with SSE response
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

    // Process the SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    // For parsing SSE events
    const decoder = new TextDecoder();
    let buffer = "";
    let result: PromptExecutionResult = { status: "waiting" };

    // Process events function
    const processEvents = (chunk: string) => {
      const events = chunk.split("\n\n").filter(Boolean);

      for (const event of events) {
        if (event.startsWith("data: ")) {
          try {
            const serverEvent = JSON.parse(event.slice(6));

            if (
              serverEvent.type === "component_state_change" &&
              serverEvent.payload?.component_id === "prompt_node"
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
            console.error("Error parsing SSE event:", error);
          }
        }
      }
    };

    // Read the stream
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      if (buffer.includes("\n\n")) {
        const chunks = buffer.split("\n\n");
        const readyChunks = chunks.slice(0, -1).join("\n\n");
        processEvents(readyChunks);
        buffer = chunks[chunks.length - 1] ?? "";
      }

      // If we have a completed or error state, we can exit early
      if (["completed", "error", "cancelled"].includes(result.status)) {
        break;
      }
    }

    // Process any remaining events in buffer
    if (buffer) {
      processEvents(buffer);
    }

    // Release the reader
    reader.releaseLock();

    return result;
  } catch (error) {
    console.error("Error executing prompt:", error);
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
