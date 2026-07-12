/**
 * spawnAgent reactor (ADR-044 part 1).
 *
 * Fires on `agent_response_started` and DISPATCHES the turn to the Go langyagent
 * manager (`POST /worker/{intent}`) directly — no in-process worker pool. The
 * manager Claims the worker synchronously (so a busy conversation is a real 409),
 * returns the pre-stream status, and drives the turn detached, pushing signed
 * frames to the control-plane relay. This reactor never holds the turn's output;
 * it only cares whether the dispatch was accepted.
 *
 * The durable event carries only `{ conversationId, turnId }`. The non-durable
 * spawn inputs (session-scoped credentials, prompt, system, AND the per-conversation
 * `runToken` the manager signs its relay frames with) all come from the short-lived
 * Redis handoff the service stashed. The runToken rides the handoff — not a
 * getRunToken read off the ClickHouse fold — so a brand-new conversation's first
 * turn never races the fold's projection lag.
 *
 * @see specs/langy/langy-event-driven-turns.feature
 */

import { createLogger } from "~/utils/logger/server";
import type { LangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import type { LangyTurnHandoffStore } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import { LangyTurnDispatchRetry } from "~/server/app-layer/langy/langy-turn-retry.error";
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
}

export function createSpawnAgentReactor(deps: {
  handoffStore: LangyTurnHandoffStore;
  /** The manager dispatch port (probe/warm/dispatch over the internal secret). */
  worker: Pick<LangyWorkerPort, "dispatch">;
}): SpawnAgentReactorHandle {
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

      // Never re-spawn from a replay — recovery is the liveness reactor's job, not
      // the event log's (ADR-030 / ADR-044 part 2). The handoff is single-use and
      // already consumed on the live pass, so this is belt-and-braces.
      if (context.isReplay) return;

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

      // read (peek), not take: a throw below re-fires this reactor, and the
      // liveness reactor re-drives the same turn — both must re-read these inputs.
      // The handoff ages out on its own TTL.
      const handoff = await deps.handoffStore.read({ conversationId, turnId });
      if (!handoff) {
        // Aged out (long queue) or never stashed. Nothing to dispatch — and no
        // retry would help, so DON'T throw. The liveness reactor terminalizes an
        // in-flight turn with no fresh heartbeat.
        logger.warn(
          { conversationId, turnId },
          "No spawn handoff found for turn — leaving to the liveness reactor",
        );
        return;
      }

      // The runToken (from the handoff, not a fold read) lets the manager sign the
      // frames it pushes to the relay. Empty only for a legacy conversation with
      // none: dispatch anyway — the turn runs with no live edge, the durable final
      // is the backstop.
      const runToken = handoff.runToken;

      // Intent is a per-turn label the manager records (it runs the SAME logic for
      // all three — Acquire reconciles the real worker state). revive: resume a
      // prior turn's checkpoint. create: a session key rode along (cold spawn).
      // continue: no key — the route's probe said a live worker already exists.
      const intent = handoff.resumeToken
        ? "revive"
        : handoff.credentials.langwatchApiKey
          ? "create"
          : "continue";

      const outcome = await deps.worker.dispatch({
        intent,
        conversationId,
        turnId,
        projectId: handoff.projectId,
        userId: handoff.actorUserId,
        runToken,
        prompt: handoff.prompt,
        system: handoff.system,
        credentials: handoff.credentials,
        ...(handoff.modelOverride ? { modelOverride: handoff.modelOverride } : {}),
        ...(handoff.resumeToken ? { resumeToken: handoff.resumeToken } : {}),
      });

      if (outcome === "accepted") {
        logger.debug({ conversationId, turnId, intent }, "Dispatched langy turn");
        return;
      }
      // Not accepted (manager down / at capacity / a stale busy / 428). THROW —
      // the GroupQueue re-fires this reactor with exponential backoff up to
      // maxAttempts (the self-retry). No event is emitted, so replay never
      // re-drives; the dispatch is turnId-idempotent (Go ClaimTurn), so a re-fire
      // that races a now-live worker is a benign no-op. (G6 428 re-mint is a
      // later step; until then a persistent 428 just exhausts the retries.)
      logger.info(
        { conversationId, turnId, intent, outcome },
        "Manager did not accept the turn — throwing to retry via the queue",
      );
      throw new LangyTurnDispatchRetry(
        `langy dispatch not accepted (${outcome}) for turn ${turnId}`,
      );
    },
  };

  return { reactor };
}
