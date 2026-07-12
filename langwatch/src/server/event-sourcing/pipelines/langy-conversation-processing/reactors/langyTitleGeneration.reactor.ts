/**
 * langyTitleGeneration reactor.
 *
 * Fires on `agent_responded` and, when the throttle allows, asks a CHEAP model
 * for a concise conversation title, then dispatches `GenerateConversationTitle`
 * (→ `conversation_title_generated`). The title is a first-class event on the
 * `langy_conversation` aggregate; this reactor is the only producer of the
 * `auto` source.
 *
 * Throttle (LANGY_TITLE_GENERATION):
 *   - the FIRST finalized turn regenerates, replacing the first-message
 *     placeholder (fold `TitleSource === "derived"`);
 *   - thereafter an `auto` title is refined only every N finalized turns;
 *   - a per-conversation dedup window (makeJobId + ttl) is the cooldown
 *     backstop against bursts and redelivered events;
 *   - a `user` title (manual rename) is never touched.
 *
 * Resilience: the actual model call lives behind an injected generator (wired
 * from the app layer where the model provider + message reads are available).
 * Any failure — generator unwired, model unavailable, empty title — is a no-op
 * and never affects the turn.
 *
 * Modeled on `reconcileAgentTurn.reactor.ts` / `spawnAgent.reactor.ts`.
 *
 * @see specs/langy/langy-conversation-title.feature
 */

import { createLogger } from "~/utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import {
  LANGY_CONVERSATION_STATUS,
  LANGY_TITLE_GENERATION,
  LANGY_TITLE_SOURCE,
} from "../schemas/constants";
import type { LangyConversationStateData } from "../projections/langyConversationState.foldProjection";
import type { LangyConversationProcessingEvent } from "../schemas/events";
import { isLangyAgentRespondedEvent } from "../schemas/typeGuards";

const logger = createLogger("langwatch:langy:title-generation-reactor");

/**
 * Reads the conversation and produces a title on a cheap model. Returns the
 * title plus the model id that produced it, or null when it cannot (no
 * transcript, model unavailable, empty output). Injected from the app layer.
 */
export type LangyTitleGenerator = (args: {
  projectId: string;
  conversationId: string;
}) => Promise<{ title: string; model: string } | null>;

export interface LangyTitleGenerationReactorHandle {
  reactor: ReactorDefinition<
    LangyConversationProcessingEvent,
    LangyConversationStateData
  >;
  /** Wire the model-backed generator after construction (composition root). */
  setGenerator: (generate: LangyTitleGenerator) => void;
}

/**
 * Finalized-turn number derived from the message count. A turn contributes a
 * user message and a finalized assistant message, so after the Kth finalized
 * turn the count is ~2K. Exact alternation is not required — an approximate
 * cadence is all the every-N-turns throttle needs.
 */
function finalizedTurnNumber(state: LangyConversationStateData): number {
  return Math.floor((state.MessageCount ?? 0) / 2);
}

/** Whether this finalized turn is allowed to (re)generate the auto title. */
function shouldRegenerate(state: LangyConversationStateData): boolean {
  // A manual rename is sticky.
  if (state.TitleSource === LANGY_TITLE_SOURCE.USER) return false;
  // Never touch an archived conversation.
  if (state.Status === LANGY_CONVERSATION_STATUS.ARCHIVED) return false;
  // First auto title: replace the derived placeholder on the first finalized turn.
  if (state.TitleSource === LANGY_TITLE_SOURCE.DERIVED) return true;
  // Already auto: refine only every Nth finalized turn.
  const turn = finalizedTurnNumber(state);
  return turn > 0 && turn % LANGY_TITLE_GENERATION.REGENERATE_EVERY_N_TURNS === 0;
}

export function createLangyTitleGenerationReactor(deps: {
  saveTitle: (args: {
    projectId: string;
    conversationId: string;
    title: string;
    model: string;
  }) => Promise<void>;
}): LangyTitleGenerationReactorHandle {
  let generate: LangyTitleGenerator | null = null;

  const reactor: ReactorDefinition<
    LangyConversationProcessingEvent,
    LangyConversationStateData
  > = {
    name: "langyTitleGeneration",
    options: {
      runIn: ["worker"],
      // Per-conversation dedup window: at most one title generation per
      // conversation per cooldown, collapsing bursts and redelivered turns.
      makeJobId: ({ event }) => {
        const conversationId =
          (event as { data?: { conversationId?: string } }).data
            ?.conversationId ?? "?";
        return `langy-title:${event.tenantId}:${conversationId}`;
      },
      ttl: LANGY_TITLE_GENERATION.COOLDOWN_MS,
    },

    shouldReact(event, context) {
      // Only a cleanly finalized turn is a title-worthy checkpoint.
      if (!isLangyAgentRespondedEvent(event)) return false;
      if (event.data.outcome !== "completed") return false;
      return shouldRegenerate(context.foldState);
    },

    async handle(
      event: LangyConversationProcessingEvent,
      context: ReactorContext<LangyConversationStateData>,
    ): Promise<void> {
      // Never regenerate on replay — a side effect, not recoverable state.
      if (context.isReplay) return;
      // Re-check against the freshest fold: a rename may have landed after the
      // predicate captured its snapshot.
      if (!shouldRegenerate(context.foldState)) return;

      if (!generate) {
        logger.warn(
          { conversationId: context.aggregateId },
          "Langy title generator not wired, skipping",
        );
        return;
      }

      const projectId = context.tenantId;
      const conversationId = context.aggregateId;

      try {
        const result = await generate({ projectId, conversationId });
        // No transcript / model unavailable / empty output → leave the title.
        if (!result?.title) return;

        await deps.saveTitle({
          projectId,
          conversationId,
          title: result.title,
          model: result.model,
        });
        logger.debug(
          { projectId, conversationId, model: result.model },
          "Generated Langy conversation title",
        );
      } catch (error) {
        // A title is a nicety — its failure must never surface on the turn.
        logger.warn(
          {
            projectId,
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Langy title generation failed — non-fatal",
        );
      }
    },
  };

  return {
    reactor,
    setGenerator: (g) => {
      generate = g;
    },
  };
}
