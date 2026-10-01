/**
 * A conversation's freshness signal, published on presence's tenant fabric. Langy's own watch
 * drops it for anyone who may not read the conversation (owner, or anyone once it is shared).
 */
import type { PresenceApi } from "@langwatch/presence-contract";

import type { LangyConversationUpdateChannel } from "../eventing/langy-conversation.subscriber.ts";

export class LangyConversationUpdateService implements LangyConversationUpdateChannel {
  private constructor(private readonly presence: Pick<PresenceApi, "publishProjectEvent">) {}

  static create(input: {
    presence: Pick<PresenceApi, "publishProjectEvent">;
  }): LangyConversationUpdateService {
    return new LangyConversationUpdateService(input.presence);
  }

  broadcastToTenant(
    tenantId: string,
    payload: string,
    eventType: "langy_conversation_updated",
  ): Promise<void> {
    return this.presence.publishProjectEvent({
      projectId: tenantId,
      channel: eventType,
      event: payload,
    });
  }
}
