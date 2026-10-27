import type { StudioClientEvent, StudioServerEvent } from "@langwatch/workflow-contract";

/** The event types the engine accepts, stated as a set rather than a `switch` nothing can reach. */
export const DISPATCHABLE_STUDIO_EVENT_TYPES: ReadonlySet<StudioClientEvent["type"]> = new Set<
  StudioClientEvent["type"]
>([
  "is_alive",
  "stop_execution",
  "execute_component",
  "execute_flow",
  "execute_evaluation",
  "stop_evaluation_execution",
  "execute_optimization",
  "stop_optimization_execution",
]);

/** The posted document, or nothing where the body was not a JSON object. */
export function findPostedJson(raw: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? [{ ...parsed }] : [];
  } catch {
    return [];
  }
}

/** The frame a failed run writes: against the node it names, or on its own. */
export function studioFailureFrame({
  error,
  message,
  finishedAtMs,
}: {
  error: unknown;
  message: StudioClientEvent;
  finishedAtMs: number;
}): StudioServerEvent {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const nodeId = "node_id" in message.payload ? message.payload.node_id : undefined;

  if (typeof nodeId !== "string" || !nodeId) {
    return { type: "error", payload: { message: errorMessage } };
  }

  return {
    type: "component_state_change",
    payload: {
      component_id: nodeId,
      execution_state: {
        status: "error",
        error: errorMessage,
        timestamps: { finished_at: finishedAtMs },
      },
    },
  };
}
