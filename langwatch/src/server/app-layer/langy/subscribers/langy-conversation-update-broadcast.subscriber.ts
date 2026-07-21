import { createLogger } from "@langwatch/observability";

import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { ProjectionCursor } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import {
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

import {
  projectionCursorHasReachedEvent,
  projectionNotReadyError,
} from "./projection-cursor";

const logger = createLogger(
  "langwatch:langy:conversation-update-broadcast-subscriber",
);

export interface LangyConversationFreshnessRecord {
  cursor: ProjectionCursor;
  /** Required only to filter the tenant-wide signal before it reaches a user. */
  ownerUserId: string;
  /** Required only to filter the tenant-wide signal before it reaches a user. */
  isShared: boolean;
}

/** Narrow Postgres read port: no folded conversation state crosses it. */
export interface LangyConversationFreshnessReader {
  read(params: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationFreshnessRecord | null>;
}

export interface LangyConversationUpdateBroadcastSubscriberDeps {
  broadcast: Pick<BroadcastService, "broadcastToTenant">;
  conversations: LangyConversationFreshnessReader;
}

/**
 * Publishes a lightweight invalidation only after the independent Postgres
 * projection has reached the committed event. Throwing while its cursor is
 * behind lets the subscriber queue retry without loading the event log.
 */
export function createLangyConversationUpdateBroadcastSubscriber(
  deps: LangyConversationUpdateBroadcastSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "langyConversationUpdateBroadcast",
    eventTypes: LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
    options: {
      deduplication: {
        makeId: (event) =>
          `langy-conversation-update:${event.tenantId}:${String(event.aggregateId)}`,
        ttlMs: 15_000,
      },
    },
    async handle(event): Promise<void> {
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      const record = await deps.conversations.read({
        projectId,
        conversationId,
      });
      if (!record || !projectionCursorHasReachedEvent(record.cursor, event)) {
        throw projectionNotReadyError({
          projectionName: "langyConversation",
          eventId: event.id,
        });
      }

      try {
        await deps.broadcast.broadcastToTenant(
          projectId,
          JSON.stringify({
            event: "langy_conversation_updated",
            conversationId,
            // These fields are consumed by the server-side SSE authorization
            // gate and stripped from the client signal schema.
            ownerUserId: record.ownerUserId,
            isShared: record.isShared,
          }),
          "langy_conversation_updated",
        );
      } catch (error) {
        // Freshness is ephemeral; a failed broadcast must not block durable
        // event processing. The next event/refetch reconciles the client.
        logger.warn(
          { projectId, conversationId, error },
          "Failed to broadcast Langy conversation invalidation",
        );
      }
    },
  };
}
