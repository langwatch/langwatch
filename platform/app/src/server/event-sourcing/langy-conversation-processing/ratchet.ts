import {
  checkTypeStringRatchet,
  definePipeline,
  type RatchetViolation,
  type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import {
  LANGY_CONVERSATION_PIPELINE_NAME,
  LANGY_CONVERSATION_PIPELINE_PREFIX,
  langyConversationEvents,
} from "./events";

/**
 * Committed by hand, never derived from `events.ts`: a snapshot generated
 * from the thing it checks compares the vocabulary against itself and passes
 * unconditionally. A string remembered here but no longer declared means
 * every stored event carrying it just lost its route back into state
 * (ADR-105 decision 10). These are byte-equal to `LANGY_CONVERSATION_EVENT_TYPES`
 * in `@langwatch/langy` — the durable wire vocabulary.
 */
export const LANGY_CONVERSATION_PROCESSING_TYPE_STRING_SNAPSHOT: TypeStringSnapshot =
  {
    langy_conversation: [
      "lw.langy_conversation.conversation_started",
      "lw.langy_conversation.conversation_forked",
      "lw.langy_conversation.message_recorded",
      "lw.langy_conversation.message_imported",
      "lw.langy_conversation.agent_turn_accepted",
      "lw.langy_conversation.tool_call_initiated",
      "lw.langy_conversation.tool_call_succeeded",
      "lw.langy_conversation.tool_call_failed",
      "lw.langy_conversation.plan_updated",
      "lw.langy_conversation.agent_response_failed",
      "lw.langy_conversation.agent_responded",
      "lw.langy_conversation.conversation_archived",
      "lw.langy_conversation.conversation_metadata_updated",
      "lw.langy_conversation.conversation_handoff_pending",
      "lw.langy_conversation.conversation_handoff_consumed",
      "lw.langy_conversation.conversation_title_generated",
    ],
  };

/**
 * What the vocabulary currently declares, in the shape the ratchet compares
 * against. Building only through `.events()` — no mount, no client — is
 * enough to derive the persisted strings.
 */
export function currentLangyConversationProcessingTypeStrings(): TypeStringSnapshot {
  const built = definePipeline(LANGY_CONVERSATION_PIPELINE_NAME)
    .prefix(LANGY_CONVERSATION_PIPELINE_PREFIX)
    .events(langyConversationEvents)
    .build();
  return { [built.name]: built.eventTypes };
}

/** Checks the committed snapshot against what `events.ts` declares right now. */
export function checkLangyConversationProcessingRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: LANGY_CONVERSATION_PROCESSING_TYPE_STRING_SNAPSHOT,
    current: currentLangyConversationProcessingTypeStrings(),
  });
}
