import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type EventSubscriberDefinition,
  type StateProjectionStore,
} from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy-contract";
import { LANGY_CONVERSATION_PROCESSING_EVENT_TYPES } from "@langwatch/langy-contract";
import { langyConversationProcess } from "../processes/langy-conversation.process";
import { LANGY_CONVERSATION_PROCESS_NAME } from "../ports/langy-conversation-process.port";
import type { LangyEffectPorts } from "../ports/langy-effect.port";
import {
  AcceptAgentTurnCommand,
  ArchiveConversationCommand,
  ConsumeTurnHandoffCommand,
  CreateConversationCommand,
  FailAgentResponseCommand,
  FailToolCallCommand,
  ForkConversationCommand,
  GenerateConversationTitleCommand,
  ImportMessageCommand,
  InitiateToolCallCommand,
  RecordAgentResponseCommand,
  RecordMessageCommand,
  RecordTurnHandoffCommand,
  SucceedToolCallCommand,
  UpdateConversationMetadataCommand,
  UpdatePlanCommand,
} from "../intents/langy-conversation.intent";
import {
  LangyAnalyticsEventMapProjection,
  type LangyAnalyticsEventProjectionRecord,
} from "../projections/langy-analytics-event.projection";
import { LangyConversationStateFoldProjection } from "../projections/langy-conversation-state.projection";
import { LangyConversationTurnFoldProjection } from "../projections/langy-conversation-turn.projection";
import { LangyMessageOperationalMapProjection } from "../projections/langy-message-operational.projection";
import type { LangyConversationProcessingEvent } from "./eventing.langy-conversation-events.adapter";

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
  langyProcessPorts: LangyEffectPorts;
}

/**
 * Aggregate: `langy_conversation` (aggregateId = conversationId, TenantId = projectId).
 * Creates the langy-conversation-processing pipeline definition (ADR-046).
 * Status/progress are EPHEMERAL signals (ADR-046): NOT commands and NOT durable
 */
function buildLangyConversationPipeline(deps: LangyConversationProcessingPipelineDeps) {
  let builder = definePipeline<LangyConversationProcessingEvent>({
    name: "langy_conversation_processing",
    aggregate: defineAggregate({
      type: "langy_conversation",
      events: defineEvents(LANGY_CONVERSATION_PROCESSING_EVENT_TYPES),
    }),
  })
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
    .build();
}

/** Deliberate process-facing adapter for the Langy conversation pipeline. */
export class LangyConversationPipelineAdapter {
  static create(deps: LangyConversationProcessingPipelineDeps): LangyConversationPipelineAdapter {
    return new LangyConversationPipelineAdapter(deps);
  }

  private constructor(private readonly deps: LangyConversationProcessingPipelineDeps) {}

  build() {
    return buildLangyConversationPipeline(this.deps);
  }
}
