import { z } from "zod";

import {
  LangyAgentRespondedEventSchema,
  LangyAgentResponseFailedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyConversationForkedEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  type LangyConversationProcessingEvent,
  LangyConversationStartedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
  LangyLocalControlRequestedEventSchema,
  LangyLocalPolicyChangedEventSchema,
  LangyLocalWorkspaceConnectedEventSchema,
  LangyLocalWorkspaceDisconnectedEventSchema,
  LangyMessageImportedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyPlanUpdatedEventSchema,
  LangyToolCallFailedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
  LangyUserWaitEndedEventSchema,
  LangyUserWaitStartedEventSchema,
} from "../../langy-conversation-state.projection.ts";

/** Every event the conversation aggregate folds, read the way the store reads them. */
const processingEventSchema = z.union([
  LangyConversationStartedEventSchema,
  LangyConversationForkedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyMessageImportedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
  LangyToolCallFailedEventSchema,
  LangyPlanUpdatedEventSchema,
  LangyAgentResponseFailedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
  LangyLocalControlRequestedEventSchema,
  LangyLocalWorkspaceConnectedEventSchema,
  LangyLocalWorkspaceDisconnectedEventSchema,
  LangyLocalPolicyChangedEventSchema,
  LangyUserWaitStartedEventSchema,
  LangyUserWaitEndedEventSchema,
]);

/** A stored event built from a fixture's own fields, checked against the real event schemas. */
export function processingEvent(raw: unknown): LangyConversationProcessingEvent {
  return processingEventSchema.parse(raw);
}
