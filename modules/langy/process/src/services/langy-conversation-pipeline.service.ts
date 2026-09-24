import {
  type AppendStore,
  defineAggregate,
  definePipeline,
  type EventSubscriberDefinition,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy-contract";

import type { LangyEffectMembers } from "../app/langy.members.ts";
import {
  LangyAnalyticsEventMapProjection,
  type LangyAnalyticsEventProjectionRecord,
} from "../eventing/langy-analytics-event.projection.ts";
import { LANGY_CONVERSATION_PROCESS_NAME } from "../eventing/langy-conversation-process.schemas.ts";
import {
  LangyConversationStateFoldProjection,
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
} from "../eventing/langy-conversation-state.projection.ts";
import type { LangyConversationProcessingEvent } from "../eventing/langy-conversation-state.projection.ts";
import { LangyConversationTurnFoldProjection } from "../eventing/langy-conversation-turn.projection.ts";
import {
  AcceptAgentTurnCommand,
  ArchiveConversationCommand,
  ChangeLocalPolicyCommand,
  ConnectLocalWorkspaceCommand,
  ConsumeTurnHandoffCommand,
  CreateConversationCommand,
  DisconnectLocalWorkspaceCommand,
  EndUserWaitCommand,
  FailAgentResponseCommand,
  FailToolCallCommand,
  ForkConversationCommand,
  GenerateConversationTitleCommand,
  ImportMessageCommand,
  InitiateToolCallCommand,
  RecordAgentResponseCommand,
  RecordMessageCommand,
  RecordTurnHandoffCommand,
  RequestLocalControlCommand,
  StartUserWaitCommand,
  SucceedToolCallCommand,
  UpdateConversationMetadataCommand,
  UpdatePlanCommand,
} from "../eventing/langy-conversation.intent.ts";
import { langyConversationProcess } from "../eventing/langy-conversation.process.ts";
import { LangyMessageOperationalMapProjection } from "../eventing/langy-message-operational.projection.ts";

export interface LangyConversationProcessingPipelineDeps {
  langyConversationProjectionStore: StateProjectionStore<LangyConversationStateData>;
  /**
   * Per-turn render document (langyConversationTurn): a second fold over the same
   * stream, keyed by `${conversationId}:${turnId}`. Folds one turn into its final
   * state (status, answer parts, tool-call lifecycle) for one-read rendering.
   */
  langyConversationTurnProjectionStore: StateProjectionStore<LangyConversationTurnData>;
  langyMessageProjectionStore: AppendStore<LangyMessageProjectionRecord>;
  /** Content-free event-grain ClickHouse analytics; never an operational read. */
  langyAnalyticsEventProjectionStore: AppendStore<LangyAnalyticsEventProjectionRecord>;
  /** Live consumers are independent from projection state and replay. */
  subscribers?: EventSubscriberDefinition<LangyConversationProcessingEvent>[];
  /**
   * Effect ports the conversation process manager dispatches into. Only the
   * effects are injected -- the process topology is declared on this pipeline.
   */
  langyProcessPorts: LangyEffectMembers;
}

/**
 * Aggregate: `langy_conversation` (aggregateId = conversationId, TenantId = projectId).
 * Creates the langy-conversation-processing pipeline definition (ADR-046).
 * Status/progress are EPHEMERAL signals (ADR-046): NOT commands and NOT durable
 */
function buildLangyConversationPipeline(
  deps: LangyConversationProcessingPipelineDeps,
): StaticPipelineDefinition<
  LangyConversationProcessingEvent,
  Record<string, Projection>,
  RegisteredCommand
> {
  let builder = definePipeline({
    name: "langy_conversation_processing",
    aggregate: defineAggregate({
      type: "langy_conversation",
    }),
  })
    .withEvents([
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
    ])
    .withPostgresProjection(
      LangyConversationStateFoldProjection.create({
        store: deps.langyConversationProjectionStore,
      }),
    )
    .withPostgresProjection(
      LangyConversationTurnFoldProjection.create({
        store: deps.langyConversationTurnProjectionStore,
      }),
    )
    .withClickHouseMapProjection(
      LangyMessageOperationalMapProjection.create({
        store: deps.langyMessageProjectionStore,
      }),
    )
    .withClickHouseMapProjection(
      LangyAnalyticsEventMapProjection.create({
        store: deps.langyAnalyticsEventProjectionStore,
      }),
    );

  for (const subscriber of deps.subscribers ?? []) {
    builder = builder.withEventSubscriber(subscriber.name, subscriber);
  }

  return builder
    .withProcessManager(
      LANGY_CONVERSATION_PROCESS_NAME,
      langyConversationProcess(deps.langyProcessPorts),
    )
    .withCommand("createConversation", CreateConversationCommand)
    .withCommand("forkConversation", ForkConversationCommand)
    .withCommand("recordMessage", RecordMessageCommand)
    .withCommand("importMessage", ImportMessageCommand)
    .withCommand("acceptAgentTurn", AcceptAgentTurnCommand)
    .withCommand("initiateToolCall", InitiateToolCallCommand)
    .withCommand("succeedToolCall", SucceedToolCallCommand)
    .withCommand("failToolCall", FailToolCallCommand)
    .withCommand("updatePlan", UpdatePlanCommand)
    .withCommand("failAgentResponse", FailAgentResponseCommand)
    .withCommand("recordAgentResponse", RecordAgentResponseCommand)
    .withCommand("archiveConversation", ArchiveConversationCommand)
    .withCommand("updateConversationMetadata", UpdateConversationMetadataCommand)
    .withCommand("recordTurnHandoff", RecordTurnHandoffCommand)
    .withCommand("consumeTurnHandoff", ConsumeTurnHandoffCommand)
    .withCommand("generateConversationTitle", GenerateConversationTitleCommand)
    .withCommand("requestLocalControl", RequestLocalControlCommand)
    .withCommand("connectLocalWorkspace", ConnectLocalWorkspaceCommand)
    .withCommand("disconnectLocalWorkspace", DisconnectLocalWorkspaceCommand)
    .withCommand("changeLocalPolicy", ChangeLocalPolicyCommand)
    .withCommand("startUserWait", StartUserWaitCommand)
    .withCommand("endUserWait", EndUserWaitCommand)
    .build();
}

/** Deliberate process-facing adapter for the Langy conversation pipeline. */
export class LangyConversationPipelineAdapter {
  static create(deps: LangyConversationProcessingPipelineDeps): LangyConversationPipelineAdapter {
    return new LangyConversationPipelineAdapter(deps);
  }

  private constructor(private readonly deps: LangyConversationProcessingPipelineDeps) {}

  build(): ReturnType<typeof buildLangyConversationPipeline> {
    return buildLangyConversationPipeline(this.deps);
  }
}
