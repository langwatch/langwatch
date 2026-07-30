import { checkTypeStringRatchet, type RatchetViolation, type TypeStringSnapshot } from "@langwatch/event-sourcing";
import { langyConversation } from "./aggregate";

/**
 * A string this snapshot remembers but the aggregate no longer declares means
 * a persisted event type just lost its route back into state. Bump it in the
 * same commit as any change to `aggregate.ts`'s `events` map.
 */
export const LANGY_CONVERSATION_PROCESSING_TYPE_STRING_SNAPSHOT: TypeStringSnapshot = {
  langy_conversation: [
    "langy_conversation/conversationStarted",
    "langy_conversation/conversationForked",
    "langy_conversation/messageRecorded",
    "langy_conversation/messageImported",
    "langy_conversation/agentTurnAccepted",
    "langy_conversation/toolCallInitiated",
    "langy_conversation/toolCallSucceeded",
    "langy_conversation/toolCallFailed",
    "langy_conversation/planUpdated",
    "langy_conversation/agentResponseFailed",
    "langy_conversation/agentResponded",
    "langy_conversation/archived",
    "langy_conversation/metadataUpdated",
    "langy_conversation/conversationHandoffPending",
    "langy_conversation/conversationHandoffConsumed",
    "langy_conversation/titleGenerated",
  ],
};

/** What the aggregate currently declares, in the shape the ratchet compares against. */
export function currentLangyConversationProcessingTypeStrings(): TypeStringSnapshot {
  return { [langyConversation.name]: langyConversation.eventTypes };
}

/** Checks the committed snapshot against what `aggregate.ts` declares right now. */
export function checkLangyConversationProcessingRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: LANGY_CONVERSATION_PROCESSING_TYPE_STRING_SNAPSHOT,
    current: currentLangyConversationProcessingTypeStrings(),
  });
}
