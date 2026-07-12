/**
 * reconcileAgentTurn reactor (ADR-044 part 2).
 *
 * A delayed, per-turn liveness timer. It arms on `agent_response_started` and
 * re-arms on every durable milestone (`tool_call_initiated/succeeded/failed`) — those
 * milestones double as the reconcile timer's re-arm, so a healthy turn that
 * keeps producing milestones keeps pushing the timer out.
 * When it finally fires (grace window past the last milestone) it checks whether
 * the turn is still in flight on the fold AND its heartbeat has lapsed; if so it
 * drives the turn to a terminal state.
 *
 * This is the PRECISE per-turn detector; the boot/interval sweep
 * (`reconcileLangyTurns`) is the deploy-survival backstop for when a pod dies
 * and its per-turn timer is lost with it.
 *
 * @see specs/langy/langy-event-driven-turns.feature
 */

import { createLogger } from "~/utils/logger/server";
import type { LangyConversationService } from "~/server/app-layer/langy/langy-conversation.service";
import type { LangyTokenBuffer } from "~/server/services/langy/streaming/langyTokenBuffer";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import { LANGY_LIVENESS } from "~/server/services/langy/streaming/langy.streaming.constants";
import type { LangyConversationStateData } from "../projections/langyConversationState.foldProjection";
import type { LangyConversationProcessingEvent } from "../schemas/events";
import {
  LangyTurnStalledError,
  serializeLangyTurnError,
} from "~/server/services/langy/execution/langy-turn-errors";
import {
  isLangyAgentResponseStartedEvent,
  isLangyToolCallFailedEvent,
  isLangyToolCallInitiatedEvent,
  isLangyToolCallSucceededEvent,
} from "../schemas/typeGuards";

const logger = createLogger("langwatch:langy:reconcile-reactor");

/** Events that arm / re-arm the per-turn reconcile timer. */
function isArmingEvent(event: LangyConversationProcessingEvent): boolean {
  return (
    isLangyAgentResponseStartedEvent(event) ||
    isLangyToolCallInitiatedEvent(event) ||
    isLangyToolCallSucceededEvent(event) ||
    isLangyToolCallFailedEvent(event)
  );
}

export function createReconcileAgentTurnReactor(deps: {
  buffer: Pick<LangyTokenBuffer, "liveness">;
  conversations: Pick<LangyConversationService, "failTurn">;
}): ReactorDefinition<
  LangyConversationProcessingEvent,
  LangyConversationStateData
> {
  return {
    name: "reconcileAgentTurn",
    options: {
      runIn: ["worker"],
      delay: LANGY_LIVENESS.HEARTBEAT_GRACE_MS,
      ttl: LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 2,
      // Per-turn dedup key: a new milestone for the same turn replaces the armed
      // timer, resetting the grace window (the re-arm).
      makeJobId: ({ event }) => {
        const data = (event as { data?: { conversationId?: string; turnId?: string } })
          .data;
        return `langy-reconcile:${data?.conversationId ?? "?"}:${data?.turnId ?? "?"}`;
      },
    },

    shouldReact(event) {
      return isArmingEvent(event);
    },

    async handle(
      event: LangyConversationProcessingEvent,
      context: ReactorContext<LangyConversationStateData>,
    ): Promise<void> {
      // Recovery is the sweep's / this timer's job, never replay's (ADR-030).
      if (context.isReplay) return;

      const { foldState } = context;
      const currentTurn = foldState.CurrentTurnId;
      // No turn in flight -> a terminal (finalize/fail) already cleared it.
      if (!currentTurn) return;

      const eventTurnId = (event as { data?: { turnId?: string } }).data?.turnId;
      // The timer fired for an older turn that has since been superseded.
      if (eventTurnId && eventTurnId !== currentTurn) return;

      const conversationId = foldState.ConversationId;
      const liveness = await deps.buffer.liveness({
        conversationId,
        turnId: currentTurn,
      });
      if (!liveness.stale) {
        // Still beating — a healthy turn. A later milestone re-armed us anyway.
        return;
      }

      logger.info(
        { tenantId: context.tenantId, conversationId, turnId: currentTurn },
        "Reconciling stalled langy turn (heartbeat lapsed)",
      );
      await deps.conversations.failTurn({
        projectId: context.tenantId,
        conversationId,
        turnId: currentTurn,
        // Serialized: `LastError` is rendered on history load, so it carries a
        // vetted domain error, never prose.
        error: serializeLangyTurnError(new LangyTurnStalledError()),
      });
    },
  };
}
