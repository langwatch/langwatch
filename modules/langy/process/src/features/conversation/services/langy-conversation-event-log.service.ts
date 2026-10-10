import type { PriorEventsRead, TenantId } from "@langwatch/eventing";
import { LANGY_CONVERSATION_PROCESSING_EVENT_TYPES } from "@langwatch/langy-contract";

import type { LangyConversationProcessingEvent } from "../../../eventing/langy-conversation-state.projection.ts";
import type { LangyConversationEventsReader } from "./langy-conversation.service.ts";

const PROCESSING_EVENT_TYPES: ReadonlySet<string> = new Set(
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
);

/** An event the langy_conversation aggregate declared, by its type; the log validated it. */
function isLangyConversationProcessingEvent(
  event: unknown,
): event is LangyConversationProcessingEvent {
  if (typeof event !== "object" || event === null || !("type" in event)) return false;
  return typeof event.type === "string" && PROCESSING_EVENT_TYPES.has(event.type);
}

/**
 * The conversation's own event log, as this role holds it. The module is built before its
 * pipeline registers, so the read is bound late. A role that holds no readable log never
 * binds one, and every read answers an empty tail: a settlement wait there never settles.
 */
export class LangyConversationEventLogService implements LangyConversationEventsReader {
  #read: PriorEventsRead | undefined;

  private constructor() {}

  static create(): LangyConversationEventLogService {
    return new LangyConversationEventLogService();
  }

  /** Binds the pipeline's own read; a later registration replaces an earlier one. */
  connect(read: PriorEventsRead): void {
    this.#read = read;
  }

  async getEventsOccurredSince({
    aggregateId,
    context,
    occurredAtFromMs,
  }: {
    aggregateId: string;
    context: { tenantId: TenantId };
    aggregateType: "langy_conversation";
    occurredAtFromMs: number;
  }): Promise<readonly LangyConversationProcessingEvent[]> {
    if (!this.#read) return [];
    const events = await this.#read({
      tenantId: context.tenantId,
      aggregateId,
      accepts: isLangyConversationProcessingEvent,
    });
    return events.filter((event) => event.occurredAt >= occurredAtFromMs);
  }
}
