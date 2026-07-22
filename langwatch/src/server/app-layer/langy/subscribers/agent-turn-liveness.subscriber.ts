import { createLogger } from "@langwatch/observability";

import {
  LangyWorkerStoppedError,
  serializeLangyTurnError,
} from "~/server/app-layer/langy/execution/langy-turn-errors";
import { LangyTurnDispatchRetry } from "~/server/app-layer/langy/langy-turn-retry.error";
import type { LangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import { LANGY_LIVENESS } from "~/server/app-layer/langy/streaming/langy.streaming.constants";
import type { LangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import type { LangyTurnHandoffStore } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import type { ProjectionCursor } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_STATUS,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

import {
  projectionCursorHasReachedEvent,
  projectionNotReadyError,
} from "./projection-cursor";

const logger = createLogger("langwatch:langy:agent-turn-liveness-subscriber");
const MAX_STALL_MS = LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 3;

const LIVENESS_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
] as const;

export interface LangyConversationLivenessRecord {
  cursor: ProjectionCursor;
  status: string;
  currentTurnId: string | null;
  lastActivityAtMs: number | null;
}

/** Narrow Postgres read port used at timer execution time, never at arm time. */
export interface LangyConversationLivenessReader {
  read(params: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationLivenessRecord | null>;
}

export interface LangyFailTurnCommandPort {
  failTurn(params: {
    projectId: string;
    conversationId: string;
    turnId: string;
    error: string;
  }): Promise<void>;
}

export interface AgentTurnLivenessSubscriberDeps {
  buffer: Pick<LangyTokenBuffer, "liveness" | "appendStatus" | "markError">;
  conversations: LangyConversationLivenessReader;
  failTurn: LangyFailTurnCommandPort;
  worker: Pick<LangyWorkerPort, "dispatch">;
  handoffStore: Pick<LangyTurnHandoffStore, "read">;
  clock?: () => number;
}

function turnIdOf(event: LangyConversationProcessingEvent): string | null {
  if (!("turnId" in event.data)) return null;
  return event.data.turnId ?? null;
}

/**
 * Delayed liveness check over a fresh operational read and the ephemeral Redis
 * heartbeat. No projection snapshot or event-log read enters the decision.
 */
export function createAgentTurnLivenessSubscriber(
  deps: AgentTurnLivenessSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  const clock = deps.clock ?? (() => Date.now());
  return {
    name: "agentTurnLiveness",
    eventTypes: LIVENESS_EVENT_TYPES,
    options: {
      delay: LANGY_LIVENESS.HEARTBEAT_GRACE_MS,
      deduplication: {
        makeId: (event) =>
          `langy-liveness:${event.tenantId}:${String(event.aggregateId)}:${turnIdOf(event) ?? "?"}`,
        ttlMs: LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 2,
      },
    },
    async handle(event): Promise<void> {
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      const eventTurnId = turnIdOf(event);
      if (!eventTurnId) return;

      const conversation = await deps.conversations.read({
        projectId,
        conversationId,
      });
      if (
        !conversation ||
        !projectionCursorHasReachedEvent(conversation.cursor, event)
      ) {
        throw projectionNotReadyError({
          projectionName: "langyConversation",
          eventId: event.id,
        });
      }

      if (
        conversation.status !== LANGY_CONVERSATION_STATUS.RUNNING ||
        conversation.currentTurnId === null ||
        conversation.currentTurnId !== eventTurnId
      ) {
        return;
      }

      const turnId = conversation.currentTurnId;
      const now = clock();
      const liveness = await deps.buffer.liveness({
        conversationId,
        turnId,
        now,
        graceMs: LANGY_LIVENESS.HEARTBEAT_GRACE_MS,
      });
      if (!liveness.stale) {
        // Only the FOUR event types above ever re-arm this delayed check, and
        // each is deduped to at most one pending check per turn. A turn whose
        // last qualifying event lands early (e.g. its final tool call) then
        // spends its tail in pure response generation gets exactly one check
        // here — if the worker is still healthy at that instant, returning
        // silently means NO further check is ever scheduled, so a crash a
        // moment later is never caught and the turn stays RUNNING forever
        // (observed as a `langy_turn_in_progress` 409 that no client-side
        // retry ever resolves, because the server-side projection is
        // genuinely stuck, not racing). Re-throwing a retryable DispatchError
        // makes the group queue re-deliver this same check on its own
        // schedule instead, floored at HEARTBEAT_GRACE_MS so healthy turns
        // aren't repolled on the queue's fast initial exponential steps. This
        // self-perpetuates until the turn leaves RUNNING (the guard above
        // returns cleanly) or genuinely goes stale (the branch below fires) —
        // bounded by the queue's own max attempts, which at a ~30s-and-
        // growing cadence covers well over an hour, comfortably past any
        // real turn duration.
        throw new DispatchError({
          message: `langy turn ${turnId} still live; re-checking liveness`,
          retryable: true,
          retryAfterMs: LANGY_LIVENESS.HEARTBEAT_GRACE_MS,
        });
      }

      const stalledMs =
        conversation.lastActivityAtMs === null
          ? MAX_STALL_MS + 1
          : now - conversation.lastActivityAtMs;
      const candidateHandoff = await deps.handoffStore.read({
        conversationId,
        turnId,
      });
      const handoff =
        candidateHandoff?.projectId === projectId &&
        candidateHandoff.conversationId === conversationId &&
        candidateHandoff.turnId === turnId
          ? candidateHandoff
          : null;

      if (stalledMs > MAX_STALL_MS || !handoff) {
        // This is the branch that kills a user's turn — it must never be
        // silent. `reason` says which guard tripped: too stale to revive, or
        // nothing to revive with.
        logger.warn(
          {
            projectId,
            conversationId,
            turnId,
            stalledMs,
            reason: stalledMs > MAX_STALL_MS ? "stall_expired" : "no_handoff",
          },
          "failing a stalled langy turn",
        );
        const error = serializeLangyTurnError(new LangyWorkerStoppedError());
        await deps.buffer
          .markError({ conversationId, turnId, error })
          .catch(() => undefined);
        await deps.failTurn.failTurn({
          projectId,
          conversationId,
          turnId,
          error,
        });
        return;
      }

      await deps.buffer
        .appendStatus({
          conversationId,
          turnId,
          status: "Reconnecting to the agent…",
        })
        .catch(() => undefined);

      const intent = handoff.resumeToken
        ? "revive"
        : handoff.credentials.langwatchApiKey
          ? "create"
          : "continue";
      const outcome = await deps.worker.dispatch({
        intent,
        conversationId,
        turnId,
        projectId,
        userId: handoff.actorUserId,
        runToken: handoff.runToken,
        prompt: handoff.prompt,
        system: handoff.system,
        credentials: handoff.credentials,
        ...(handoff.modelOverride
          ? { modelOverride: handoff.modelOverride }
          : {}),
        ...(handoff.resumeToken ? { resumeToken: handoff.resumeToken } : {}),
      });
      logger.info(
        { projectId, conversationId, turnId, stalledMs, outcome },
        "Re-dispatched stalled Langy turn",
      );
      throw new LangyTurnDispatchRetry(
        `langy turn ${turnId} stalled (${stalledMs}ms); re-driven, awaiting liveness`,
      );
    },
  };
}
