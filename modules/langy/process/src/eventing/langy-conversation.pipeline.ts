/**
 * langy_conversation_processing, registered by the module that owns it: the api sends its
 * commands, the worker folds the conversation, its turns, messages and analytics.
 */
import {
  type AppendStore,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type EventSubscriberDefinition,
  type Projection,
  type RegisteredCommand,
  type RetentionPolicyResolver,
  type StateProjectionStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy-contract";

import type { LangyModule } from "../app/langy.app.ts";
import type { LangyEffectMembers } from "../app/langy.members.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import {
  LangyAnalyticsEventMapProjection,
  type LangyAnalyticsEventProjectionRecord,
} from "./langy-analytics-event.projection.ts";
import { LANGY_CONVERSATION_PROCESS_NAME } from "./langy-conversation-process.schemas.ts";
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
} from "./langy-conversation-state.projection.ts";
import type { LangyConversationProcessingEvent } from "./langy-conversation-state.projection.ts";
import { LangyConversationTurnFoldProjection } from "./langy-conversation-turn.projection.ts";
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
} from "./langy-conversation.intent.ts";
import { langyConversationProcess } from "./langy-conversation.process.ts";
import { LangyMessageOperationalMapProjection } from "./langy-message-operational.projection.ts";

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
  /** Each tenant's retention, stamped on the analytics rows in place of the default (§9). */
  retention?: RetentionPolicyResolver;
  /** Live consumers are independent from projection state and replay. */
  subscribers?: EventSubscriberDefinition<LangyConversationProcessingEvent>[];
  /**
   * Effect ports the conversation process manager dispatches into. Only the
   * effects are injected -- the process topology is declared on this pipeline.
   */
  langyProcessPorts: LangyEffectMembers;
}

/** The langy_conversation_processing definition, whichever half of it a role registers. */
export type LangyConversationDefinition = StaticPipelineDefinition<
  LangyConversationProcessingEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/** The langy_conversation_processing pipeline and the events it carries. */
function defineLangyConversationEvents() {
  return definePipeline({
    name: "langy_conversation_processing",
    aggregate: defineAggregate({
      type: "langy_conversation",
    }),
  }).withEvents([
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
}

/**
 * Aggregate: `langy_conversation` (aggregateId = conversationId, TenantId = projectId).
 * Creates the langy-conversation-processing pipeline definition (ADR-046).
 * Status/progress are EPHEMERAL signals (ADR-046): NOT commands and NOT durable
 */
export function buildLangyConversationPipeline(
  deps: LangyConversationProcessingPipelineDeps,
): LangyConversationDefinition {
  let builder = defineLangyConversationEvents()
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
  if (deps.retention) builder = builder.withRetention(deps.retention);

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

export const langyConversationEventing = defineEventingModule({
  pipeline: "langy_conversation_processing",
  build: ({ app, participation }: EventingSetup<LangyRepositories, LangyModule>) =>
    app.conversationPipeline({ participation }),
  connect: ({ app, commands }) => app.connectConversationCommands(commands),
});
