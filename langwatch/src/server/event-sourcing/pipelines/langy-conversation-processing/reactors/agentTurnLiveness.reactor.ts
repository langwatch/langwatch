/**
 * agentTurnLiveness reactor (ADR-044 part 2) — the SELF-RETRYING liveness timer.
 *
 * A delayed, per-turn timer. It arms on `agent_response_started` and re-arms on
 * every durable milestone (`tool_call_initiated/succeeded/failed`). When it fires
 * (grace window past the last activity) it checks whether the turn is still in
 * flight AND its heartbeat has lapsed.
 *
 * A live turn keeps pushing the timer out. A STALLED turn — the worker died or
 * went silent — is RE-DRIVEN: re-dispatch to a fresh worker + an ephemeral
 * "retrying…" note, then THROW so the GroupQueue re-fires this check with
 * exponential backoff (the self-retry). No event is emitted to re-drive — that
 * would double-fire on replay; the retry is simply the queue re-running this
 * reactor. The re-dispatch is turnId-idempotent (Go `ClaimTurn`), so a re-fire
 * that races a now-live worker is a benign no-op.
 *
 * Give-up is time-bounded, not counted: once the turn has had NO durable activity
 * for `maxStallMs` (heartbeat still lapsed the whole time), it fails the turn. A
 * worker that recovers refreshes the heartbeat (not stale ⇒ we return) or emits a
 * milestone (bumps LastActivityAt ⇒ the window resets), so a healthy turn is never
 * failed.
 *
 * @see specs/langy/langy-event-driven-turns.feature
 */

import { createLogger } from "~/utils/logger/server";
import type { LangyConversationService } from "~/server/app-layer/langy/langy-conversation.service";
import type { LangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import type { LangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import type { LangyTurnHandoffStore } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import { LangyTurnDispatchRetry } from "~/server/app-layer/langy/langy-turn-retry.error";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import { LANGY_LIVENESS } from "~/server/app-layer/langy/streaming/langy.streaming.constants";
import type { LangyConversationStateData } from "../projections/langyConversationState.foldProjection";
import type { LangyConversationProcessingEvent } from "../schemas/events";
import {
  LangyTurnStalledError,
  serializeLangyTurnError,
} from "~/server/app-layer/langy/execution/langy-turn-errors";
import {
  isLangyAgentResponseStartedEvent,
  isLangyToolCallFailedEvent,
  isLangyToolCallInitiatedEvent,
  isLangyToolCallSucceededEvent,
} from "../schemas/typeGuards";

const logger = createLogger("langwatch:langy:liveness-reactor");

/**
 * Total no-activity window before the self-retry gives up and fails the turn.
 * Three grace windows: the turn is re-driven across ~2 backoff-spaced attempts
 * before it is declared dead.
 */
const MAX_STALL_MS = LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 3;

/** Events that arm / re-arm the per-turn liveness timer. */
function isArmingEvent(event: LangyConversationProcessingEvent): boolean {
  return (
    isLangyAgentResponseStartedEvent(event) ||
    isLangyToolCallInitiatedEvent(event) ||
    isLangyToolCallSucceededEvent(event) ||
    isLangyToolCallFailedEvent(event)
  );
}

export function createAgentTurnLivenessReactor(deps: {
  buffer: Pick<LangyTokenBuffer, "liveness" | "appendStatus">;
  conversations: Pick<LangyConversationService, "failTurn">;
  worker: Pick<LangyWorkerPort, "dispatch">;
  handoffStore: Pick<LangyTurnHandoffStore, "read">;
}): ReactorDefinition<
  LangyConversationProcessingEvent,
  LangyConversationStateData
> {
  return {
    name: "agentTurnLiveness",
    options: {
      runIn: ["worker"],
      delay: LANGY_LIVENESS.HEARTBEAT_GRACE_MS,
      ttl: LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 2,
      // Per-turn dedup key: a new milestone for the same turn replaces the armed
      // timer, resetting the grace window (the re-arm).
      makeJobId: ({ event }) => {
        const data = (event as { data?: { conversationId?: string; turnId?: string } })
          .data;
        return `langy-liveness:${data?.conversationId ?? "?"}:${data?.turnId ?? "?"}`;
      },
    },

    shouldReact(event) {
      return isArmingEvent(event);
    },

    async handle(
      event: LangyConversationProcessingEvent,
      context: ReactorContext<LangyConversationStateData>,
    ): Promise<void> {
      // Recovery is this timer's job, never replay's (ADR-030).
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

      // Stalled: the worker died or went silent. Give up if we've been trying for
      // too long with no durable activity; otherwise re-drive and retry.
      const stalledMs =
        foldState.LastActivityAt != null
          ? Date.now() - foldState.LastActivityAt
          : MAX_STALL_MS + 1;
      const handoff = await deps.handoffStore.read({
        conversationId,
        turnId: currentTurn,
      });
      if (stalledMs > MAX_STALL_MS || !handoff) {
        logger.info(
          { tenantId: context.tenantId, conversationId, turnId: currentTurn, stalledMs },
          "Langy turn stalled past the retry window — failing",
        );
        await deps.conversations.failTurn({
          projectId: context.tenantId,
          conversationId,
          turnId: currentTurn,
          // Serialized: `LastError` is rendered on history load, so it carries a
          // vetted domain error, never prose.
          error: serializeLangyTurnError(new LangyTurnStalledError()),
        });
        return;
      }

      // Re-drive: tell the browser we're reconnecting (ephemeral), re-dispatch to
      // a fresh worker, then throw so the queue re-checks after a backoff.
      await deps.buffer
        .appendStatus({
          conversationId,
          turnId: currentTurn,
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
        turnId: currentTurn,
        projectId: handoff.projectId,
        userId: handoff.actorUserId,
        runToken: handoff.runToken,
        prompt: handoff.prompt,
        system: handoff.system,
        credentials: handoff.credentials,
        ...(handoff.modelOverride ? { modelOverride: handoff.modelOverride } : {}),
        ...(handoff.resumeToken ? { resumeToken: handoff.resumeToken } : {}),
      });
      logger.info(
        { tenantId: context.tenantId, conversationId, turnId: currentTurn, stalledMs, outcome },
        "Re-dispatched stalled langy turn — throwing to re-check via the queue",
      );
      throw new LangyTurnDispatchRetry(
        `langy turn ${currentTurn} stalled (${stalledMs}ms); re-driven, awaiting liveness`,
      );
    },
  };
}
