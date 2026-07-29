import type { LangyConversationStateData } from "@langwatch/langy";
import type {
  LangyConversationFreshnessReader,
  LangyConversationLivenessReader,
} from "~/server/app-layer/langy/subscribers";
import { createTenantId } from "../../domain/tenantId";
import type { StateProjectionStore } from "../../projections/stateProjection.types";

/**
 * ADR-082 layer 5. The conversation-state store, adapted to the two narrow read
 * ports the live subscribers declare. Nothing here constructs, decides or
 * caches — it is one `store.load` and a field projection.
 *
 * The returned record satisfies both ports at once because they read the same
 * row for different reasons: liveness needs the turn's status, the broadcast
 * needs enough to filter a tenant-wide signal down to who may see it. Neither
 * gets the folded conversation state.
 */
export type LangyConversationReader = LangyConversationLivenessReader &
  LangyConversationFreshnessReader;

export function createLangyConversationReader(
  store: Pick<StateProjectionStore<LangyConversationStateData>, "load">,
): LangyConversationReader {
  return {
    read: async ({ projectId, conversationId }) => {
      const projection = await store.load(conversationId, {
        tenantId: createTenantId(projectId),
        aggregateId: conversationId,
      });
      if (!projection) return null;
      return {
        cursor: projection.cursor,
        status: projection.state.Status,
        currentTurnId: projection.state.CurrentTurnId,
        lastActivityAtMs: projection.state.LastActivityAt,
        ownerUserId: projection.state.UserId,
        isShared: projection.state.IsShared,
      };
    },
  };
}
