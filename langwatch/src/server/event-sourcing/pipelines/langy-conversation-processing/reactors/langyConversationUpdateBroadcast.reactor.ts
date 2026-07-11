import { createLogger } from "../../../../../utils/logger/server";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { LangyConversationStateData } from "../projections/langyConversationState.foldProjection";
import type { LangyConversationProcessingEvent } from "../schemas/events";
import {
  isLangyConversationMetadataUpdatedEvent,
  isLangyConversationTitleGeneratedEvent,
} from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:langy-conversation-processing:update-broadcast-reactor",
);

export interface LangyConversationUpdateBroadcastReactorDeps {
  broadcast: BroadcastService;
  hasRedis?: boolean;
}

/**
 * Reactor that broadcasts a lightweight per-conversation freshness signal to
 * connected SSE clients whenever a Langy conversation's fold projection
 * advances (ADR-046).
 *
 * Mirrors `traceUpdateBroadcast.reactor.ts`: the payload carries ONLY the
 * conversation id — never message content — so the frontend cancels +
 * invalidates its slim TanStack Query caches and refetches the projection
 * rather than accepting pushed rows. Fires on every conversation event; the
 * frontend debounces duplicates. Broadcast failure is swallowed — it must
 * never block the pipeline.
 */
export function createLangyConversationUpdateBroadcastReactor(
  deps: LangyConversationUpdateBroadcastReactorDeps,
): ReactorDefinition<
  LangyConversationProcessingEvent,
  LangyConversationStateData
> {
  return {
    name: "langyConversationUpdateBroadcast",
    options: {
      runIn: ["worker"],
      // Without Redis the worker-to-web pub/sub bridge is unavailable.
      disabled: deps.hasRedis === false,
      makeJobId: (payload) =>
        `langy-conversation-update:${payload.event.tenantId}:${payload.event.aggregateId}`,
      // Debounce broadcasts — the frontend already debounces duplicate events.
      ttl: 15_000,
    },

    async handle(
      event: LangyConversationProcessingEvent,
      context: ReactorContext<LangyConversationStateData>,
    ): Promise<void> {
      const { tenantId, aggregateId: conversationId, foldState } = context;

      // Whether THIS event changed the title. The title text itself is NEVER
      // put on the tenant-wide wire (privacy — a conversation is private to its
      // owner); this is just a boolean hint so a subscriber re-reads the
      // conversation through the server visibility gate to pick up the new
      // title. Covers both the auto title and a manual rename that set a title.
      const titleChanged =
        isLangyConversationTitleGeneratedEvent(event) ||
        (isLangyConversationMetadataUpdatedEvent(event) &&
          event.data.title !== undefined);

      try {
        // Enrich the signal with the operational spine the fold already holds
        // (zero extra reads) so the client applies it in place instead of
        // paying a ClickHouse round-trip. Content-derived fields (title,
        // messages) are deliberately excluded.
        //
        // The broadcast fans out on the tenant-wide (project) channel, so we
        // also carry the owner identity (`ownerUserId`) and `isShared` flag.
        // The `onConversationUpdate` subscription uses these to drop every
        // signal the subscriber is not allowed to see — a conversation is
        // private to its owner unless shared with the project — mirroring the
        // read routes' `(UserId = userId OR IsShared)` visibility gate. The
        // client's signal schema strips these server-only fields on parse.
        const payload = JSON.stringify({
          event: "langy_conversation_updated",
          conversationId,
          status: foldState?.Status,
          messageCount: foldState?.MessageCount,
          lastActivityAtMs: foldState?.LastActivityAt ?? null,
          isRunning: foldState?.Status === "running",
          ownerUserId: foldState?.UserId,
          isShared: foldState?.IsShared ?? false,
          // Boolean-only title-change hint (never the title text). Routes the
          // client to a visibility-gated refetch so the new title appears live.
          ...(titleChanged ? { titleChanged: true } : {}),
        });

        await deps.broadcast.broadcastToTenant(
          tenantId,
          payload,
          "langy_conversation_updated",
        );

        logger.debug(
          { tenantId, conversationId },
          "Broadcasted langy conversation update",
        );
      } catch (error) {
        logger.warn(
          {
            tenantId,
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast langy conversation update — non-fatal",
        );
      }
    },
  };
}
