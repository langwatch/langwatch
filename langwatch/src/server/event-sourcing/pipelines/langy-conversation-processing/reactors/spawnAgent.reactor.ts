/**
 * spawnAgent reactor (ADR-044 part 1).
 *
 * Fires on `agent_response_started` and submits the turn to the in-process
 * `LangyWorkerPool`, which calls the Go langyagent manager. A direct analog of
 * `createScenarioExecutionReactor`: fire-and-forget (does NOT await the turn, so
 * the GroupQueue keeps draining later events for the same aggregate), pool
 * late-bound via `setPool()` from worker startup.
 *
 * The durable event carries only `{ conversationId, turnId }`. The non-durable
 * spawn inputs (session-scoped credentials, prompt, system) are taken from the
 * short-lived Redis handoff the route stashed — never from the event log.
 *
 * @see src/server/event-sourcing/pipelines/simulation-processing/reactors/scenarioExecution.reactor.ts
 * @see specs/langy/langy-event-driven-turns.feature
 */

import { createLogger } from "~/utils/logger/server";
import type { LangyWorkerPool } from "~/server/services/langy/execution/langy-worker-pool";
import type { LangyTurnHandoffStore } from "~/server/services/langy/streaming/langyTurnHandoff";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import { LANGY_CONVERSATION_STATUS } from "../schemas/constants";
import type { LangyConversationStateData } from "../projections/langyConversationState.foldProjection";
import type { LangyConversationProcessingEvent } from "../schemas/events";
import { isLangyAgentResponseStartedEvent } from "../schemas/typeGuards";

const logger = createLogger("langwatch:langy:spawn-agent-reactor");

export interface SpawnAgentReactorHandle {
  reactor: ReactorDefinition<
    LangyConversationProcessingEvent,
    LangyConversationStateData
  >;
  /** Wire the worker pool after the reactor is created (worker startup). */
  setPool: (pool: LangyWorkerPool) => void;
}

export function createSpawnAgentReactor(deps: {
  handoffStore: LangyTurnHandoffStore;
}): SpawnAgentReactorHandle {
  let pool: LangyWorkerPool | null = null;

  const reactor: ReactorDefinition<
    LangyConversationProcessingEvent,
    LangyConversationStateData
  > = {
    name: "spawnAgent",
    options: {
      runIn: ["worker"],
    },

    async handle(
      event: LangyConversationProcessingEvent,
      context: ReactorContext<LangyConversationStateData>,
    ): Promise<void> {
      if (!isLangyAgentResponseStartedEvent(event)) return;

      // Never re-spawn from a replay — recovery is the liveness sweep's job, not
      // the event log's (ADR-030 / ADR-044 part 2). The handoff is single-use
      // and already consumed on the live pass, so this is belt-and-braces.
      if (context.isReplay) return;

      if (!pool) {
        logger.warn(
          { conversationId: context.foldState.ConversationId },
          "Langy worker pool not yet wired, skipping",
        );
        return;
      }

      const { foldState } = context;
      const { conversationId, turnId } = event.data;

      // Superseded: a newer turn started for the conversation before this event
      // was processed. The fold's CurrentTurnId always points at the latest.
      if (foldState.CurrentTurnId && foldState.CurrentTurnId !== turnId) {
        logger.info(
          { conversationId, turnId, current: foldState.CurrentTurnId },
          "Skipping spawn — turn superseded by a newer one",
        );
        return;
      }
      if (foldState.Status === LANGY_CONVERSATION_STATUS.ARCHIVED) {
        logger.info({ conversationId, turnId }, "Skipping spawn — archived");
        return;
      }

      const handoff = await deps.handoffStore.take({ conversationId, turnId });
      if (!handoff) {
        // Aged out (long queue) or already taken. The reconcile sweep detects
        // the in-flight turn with no live heartbeat and terminalizes it.
        logger.warn(
          { conversationId, turnId },
          "No spawn handoff found for turn — leaving to reconcile sweep",
        );
        return;
      }

      pool.submit(handoff);
      logger.debug({ conversationId, turnId }, "Submitted langy turn to pool");
    },
  };

  return {
    reactor,
    setPool: (p) => {
      pool = p;
    },
  };
}
