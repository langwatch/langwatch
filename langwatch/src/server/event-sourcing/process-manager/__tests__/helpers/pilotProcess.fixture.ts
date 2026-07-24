import type {
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessRef,
} from "../../processManager.types";

/**
 * Test-only miniature of the Langy conversation process from ADR-049 §4:
 * a started turn dispatches a worker and schedules a liveness wake-up,
 * durable activity moves the wake-up, wakes retry within a deadline and
 * fail once past it, and a manual rename suppresses automatic titles.
 */
export interface PilotState {
  turnId: string | null;
  status: "idle" | "running" | "completed" | "failed";
  dispatchGeneration: number;
  retryDeadlineAt: number | null;
  finalizedTurnCount: number;
  titleSource: "derived" | "user";
  lastActivityAt: number | null;
}

export const T0 = 1_752_600_000_000;
export const LIVENESS_MS = 30_000;
export const RETRY_WINDOW_MS = 120_000;

export const PROCESS_NAME = "langyConversation";
export const PROJECT_ID = "proj_1";
export const TENANT_ID = "tenant_1";
export const CONVERSATION_ID = "conv_1";

export const pilotRef: ProcessRef = {
  processName: PROCESS_NAME,
  projectId: PROJECT_ID,
  processKey: CONVERSATION_ID,
};

export const pilotDefinition: ProcessDefinition<PilotState> = {
  name: PROCESS_NAME,
  initialState: {
    turnId: null,
    status: "idle",
    dispatchGeneration: 0,
    retryDeadlineAt: null,
    finalizedTurnCount: 0,
    titleSource: "derived",
    lastActivityAt: null,
  },
  evolve: ({ previousState, input }) => {
    if (input.kind === "event") {
      const event = input.event;
      switch (event.eventType) {
        case "langy.agent-response.started": {
          const { turnId } = event.payload as { turnId: string };
          return {
            state: {
              ...previousState,
              turnId,
              status: "running",
              dispatchGeneration: 1,
              retryDeadlineAt: event.occurredAt + RETRY_WINDOW_MS,
              lastActivityAt: event.occurredAt,
            },
            nextWakeAt: event.occurredAt + LIVENESS_MS,
            intents: [
              {
                messageKey: `dispatch:${turnId}:1`,
                intentType: "worker-dispatch",
                payload: { turnId, generation: 1, handoffKey: `handoff:${turnId}` },
              },
            ],
          };
        }
        case "langy.turn.tool-completed":
          return {
            state: { ...previousState, lastActivityAt: event.occurredAt },
            nextWakeAt: event.occurredAt + LIVENESS_MS,
            intents: [],
          };
        case "langy.agent-response.completed":
          return {
            state: {
              ...previousState,
              status: "completed",
              finalizedTurnCount: previousState.finalizedTurnCount + 1,
            },
            nextWakeAt: null,
            intents:
              previousState.titleSource === "user"
                ? []
                : [
                    {
                      messageKey: `title:${previousState.turnId}`,
                      intentType: "title-generation",
                      payload: { turnId: previousState.turnId },
                    },
                  ],
          };
        case "langy.conversation.renamed":
          return {
            state: { ...previousState, titleSource: "user" },
            nextWakeAt: null,
            intents: [],
          };
        default:
          return { state: previousState, nextWakeAt: null, intents: [] };
      }
    }

    // Liveness wake-up.
    if (previousState.status !== "running") {
      return { state: previousState, nextWakeAt: null, intents: [] };
    }
    if (
      previousState.retryDeadlineAt !== null &&
      input.scheduledFor >= previousState.retryDeadlineAt
    ) {
      return {
        state: { ...previousState, status: "failed" },
        nextWakeAt: null,
        intents: [
          {
            messageKey: `fail:${previousState.turnId}`,
            intentType: "fail-agent-response",
            payload: { turnId: previousState.turnId },
          },
        ],
      };
    }
    const generation = previousState.dispatchGeneration + 1;
    return {
      state: { ...previousState, dispatchGeneration: generation },
      nextWakeAt: input.scheduledFor + LIVENESS_MS,
      intents: [
        {
          messageKey: `dispatch:${previousState.turnId}:${generation}`,
          intentType: "worker-dispatch",
          payload: {
            turnId: previousState.turnId,
            generation,
            handoffKey: `handoff:${previousState.turnId}`,
          },
        },
      ],
    };
  },
};

let eventCounter = 0;

export function pilotEvent(
  overrides: Partial<ProcessEventEnvelope> = {},
): ProcessEventEnvelope {
  eventCounter += 1;
  return {
    eventId: `evt_${eventCounter}`,
    eventType: "langy.agent-response.started",
    occurredAt: T0,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    processKey: CONVERSATION_ID,
    userId: "user_1",
    payload: { turnId: "turn_1" },
    ...overrides,
  };
}
