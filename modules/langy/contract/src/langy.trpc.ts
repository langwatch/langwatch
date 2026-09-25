/**
 * Every `langy.*` procedure the panel calls, declared once: name, kind, input, answer.
 * Spec: modules/langy/specs/langy-panel-trpc.feature
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  langyAnswerLocalPermissionInputSchema,
  langyAnswerQuestionInputSchema,
  langyClaimUiActionInputSchema,
  langyCompleteUiActionInputSchema,
  langyContinueConversationInputSchema,
  langyControlRequestRenewedSchema,
  langyPanelConversationInputSchema,
  langyPanelCreateConversationInputSchema,
  langyEgressGetInputSchema,
  langyEgressSetInputSchema,
  langyEgressStateSchema,
  langyEventsAfterInputSchema,
  langyFeedbackPromptShownInputSchema,
  langyForkInputSchema,
  langyListInputSchema,
  langyLocalAnsweredSchema,
  langyLocalDisconnectedSchema,
  langyLocalPolicySchema,
  langyProjectInputSchema,
  langyRecordFeedbackInputSchema,
  langyRenameInputSchema,
  langySetCodeAccessPreferenceInputSchema,
  langySetLocalPolicyInputSchema,
  langyStopTurnPanelInputSchema,
  langyTurnStreamInputSchema,
  langyWarmWorkerInputSchema,
} from "./langy-trpc.schemas.ts";
import {
  langyConversationDeletedSchema,
  langyConversationDetailSchema,
  langyConversationEventPageDtoSchema,
  langyConversationListPageDtoSchema,
  langyConversationMessagesDtoSchema,
  langyConversationUpdateFrameSchema,
  langyModelsAllowedSchema,
  langyTurnStartedSchema,
  langyTurnStoppedSchema,
  langyUiActionClaimedSchema,
  langyUiActionCompletedSchema,
  langyWarmedWorkerSchema,
} from "./langy.dtos.ts";
import {
  langyCodeAccessPreferenceSchema,
  langyLocalRecordSchema,
  langyLocalWorkspaceStatusSchema,
} from "./langy.local-control-http.ts";
import { langyStreamEntrySchema } from "./langy.stream-entry.ts";

export const langyTrpc = defineTrpcContract("langy")
  .query("list")
  .withInput(langyListInputSchema)
  .withOutput(langyConversationListPageDtoSchema)

  .query("conversationEventsAfter")
  .withInput(langyEventsAfterInputSchema)
  .withOutput(langyConversationEventPageDtoSchema)

  /** Null while the conversation is not visible, including one whose fold is not projected yet. */
  .query("detail")
  .withInput(langyPanelConversationInputSchema)
  .withOutput(langyConversationDetailSchema.nullable())

  .query("messages")
  .withInput(langyPanelConversationInputSchema)
  .withOutput(langyConversationMessagesDtoSchema)

  .mutation("deleteConversation")
  .withInput(langyPanelConversationInputSchema)
  .withOutput(langyConversationDeletedSchema)

  .mutation("renameConversation")
  .withInput(langyRenameInputSchema)
  .withOutput(langyConversationDetailSchema)

  .mutation("forkConversation")
  .withInput(langyForkInputSchema)
  .withOutput(langyConversationDetailSchema)

  .mutation("createConversation")
  .withInput(langyPanelCreateConversationInputSchema)
  .withOutput(langyTurnStartedSchema)

  .mutation("continueConversation")
  .withInput(langyContinueConversationInputSchema)
  .withOutput(langyTurnStartedSchema)

  .mutation("stopTurn")
  .withInput(langyStopTurnPanelInputSchema)
  .withOutput(langyTurnStoppedSchema)

  .mutation("claimUiAction")
  .withInput(langyClaimUiActionInputSchema)
  .withOutput(langyUiActionClaimedSchema)

  .mutation("completeUiAction")
  .withInput(langyCompleteUiActionInputSchema)
  .withOutput(langyUiActionCompletedSchema)

  .mutation("answerLocalPermission")
  .withInput(langyAnswerLocalPermissionInputSchema)
  .withOutput(langyLocalAnsweredSchema)

  .mutation("answerQuestion")
  .withInput(langyAnswerQuestionInputSchema)
  .withOutput(langyLocalAnsweredSchema)

  .mutation("setLocalPolicy")
  .withInput(langySetLocalPolicyInputSchema)
  .withOutput(langyLocalPolicySchema)

  .mutation("disconnectLocalWorkspace")
  .withInput(langyPanelConversationInputSchema)
  .withOutput(langyLocalDisconnectedSchema)

  .mutation("setCodeAccessPreference")
  .withInput(langySetCodeAccessPreferenceInputSchema)
  .withOutput(langyCodeAccessPreferenceSchema)

  .query("getCodeAccessPreference")
  .withInput(langyProjectInputSchema)
  .withOutput(langyCodeAccessPreferenceSchema)

  .query("localRecord")
  .withInput(langyPanelConversationInputSchema)
  .withOutput(langyLocalRecordSchema)

  .query("getLocalWorkspace")
  .withInput(langyPanelConversationInputSchema)
  .withOutput(langyLocalWorkspaceStatusSchema)

  .mutation("renewLocalControlRequest")
  .withInput(langyPanelConversationInputSchema)
  .withOutput(langyControlRequestRenewedSchema)

  /** A warm failure is a cold start, never an error. */
  .mutation("warmWorker")
  .withInput(langyWarmWorkerInputSchema)
  .withOutput(langyWarmedWorkerSchema)

  .query("modelsAllowed")
  .withInput(langyProjectInputSchema)
  .withOutput(langyModelsAllowedSchema)

  .mutation("recordFeedback")
  .withInput(langyRecordFeedbackInputSchema)

  .mutation("feedbackPromptShown")
  .withInput(langyFeedbackPromptShownInputSchema)

  .subscription("onConversationUpdate")
  .withInput(langyProjectInputSchema)
  .withOutput(langyConversationUpdateFrameSchema)

  .subscription("onTurnStream")
  .withInput(langyTurnStreamInputSchema)
  .withOutput(langyStreamEntrySchema)
  .build();

/** The project's egress allow-list editor; `set` wants `langy:manage`, behind the same gate. */
export const langyEgressTrpc = defineTrpcContract("langyEgress")
  .query("get")
  .withInput(langyEgressGetInputSchema)
  .withOutput(langyEgressStateSchema)

  .mutation("set")
  .withInput(langyEgressSetInputSchema)
  .withOutput(langyEgressStateSchema)
  .build();
