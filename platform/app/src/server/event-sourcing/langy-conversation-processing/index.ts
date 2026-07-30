import { clickhouseAppend, type ClickHouseClient } from "@langwatch/clickhouse";
import {
  ConfigurationError,
  definePipeline,
  validateMount,
  type GroupKey,
  type HandlerContext,
  type Metrics,
  type Mount,
} from "@langwatch/event-sourcing";
import { acceptAgentTurn, acceptAgentTurnInputSchema } from "./acceptAgentTurn.command";
import { archiveConversation } from "./archiveConversation.command";
import { consumeTurnHandoff } from "./consumeTurnHandoff.command";
import { createConversation } from "./createConversation.command";
import { LANGY_CONVERSATION_PIPELINE_NAME, LANGY_CONVERSATION_PIPELINE_PREFIX, langyConversationEvents } from "./events";
import { failAgentResponse } from "./failAgentResponse.command";
import { failToolCall } from "./failToolCall.command";
import {
  applyLangyConversationSpineEvent,
  applyLangyConversationTurnEvent,
  initLangyConversationSpineState,
  initLangyConversationTurnState_,
  LANGY_CONVERSATION_SPINE_PROJECTION,
  LANGY_CONVERSATION_SPINE_VERSION,
  LANGY_CONVERSATION_TURN_PROJECTION,
  LANGY_CONVERSATION_TURN_VERSION,
  langyConversationSpineStateSchema,
  langyConversationTurnStateSchema,
} from "./folds";
import { forkConversation } from "./forkConversation.command";
import { generateConversationTitle } from "./generateConversationTitle.command";
import { importMessage } from "./importMessage.command";
import { initiateToolCall } from "./initiateToolCall.command";
import {
  handleAgentResponded,
  handleAgentResponseFailed,
  handleAgentTurnAccepted,
  handleArchived,
  handleHandoffConsumed,
  handleHandoffPending,
  handleMetadataUpdated,
  handleTitleGenerated,
  initLangyConversationProcessState,
  LANGY_CONVERSATION_PROCESS_NAME,
  langyConversationProcessStateSchema,
  langyGenerateTitleIntentSchema,
  langyWorkerDispatchIntentSchema,
} from "./langyConversation.process";
import { langyAnalyticsEventRecords, langyMessageRecords } from "./maps";
import { recordAgentResponse } from "./recordAgentResponse.command";
import { recordMessage } from "./recordMessage.command";
import { recordTurnHandoff } from "./recordTurnHandoff.command";
import {
  createLangyConversationStateStore,
  createLangyConversationTurnStore,
  createLangyMessageStore,
  type LangyProjectionPrisma,
} from "./postgres";
import { succeedToolCall } from "./succeedToolCall.command";
import { langyAnalyticsEventRow, langyAnalyticsEventsTable } from "./table";
import { updateConversationMetadata } from "./updateConversationMetadata.command";
import { updatePlan } from "./updatePlan.command";

export { checkLangyConversationProcessingRatchet } from "./ratchet";

function conversationScope(conversationId: string) {
  return {
    kind: "aggregate",
    aggregateType: LANGY_CONVERSATION_PIPELINE_NAME,
    aggregateId: conversationId,
  } as const;
}

export function langyConversationCommandGroupKey(args: {
  readonly tenantId: string;
  readonly command: string;
  readonly conversationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: args.command },
    scope: conversationScope(args.conversationId),
  };
}

/** A fold reads its own state back, so one lane per conversation (ADR-100 §2). */
export function langyConversationStateGroupKey(args: {
  readonly tenantId: string;
  readonly conversationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: LANGY_CONVERSATION_SPINE_PROJECTION },
    scope: conversationScope(args.conversationId),
  };
}

/** One lane per turn, matching the fold's own `${conversationId}:${turnId}`
 *  key, so two turns of one conversation may apply concurrently. */
export function langyConversationTurnGroupKey(args: {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly turnId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: LANGY_CONVERSATION_TURN_PROJECTION },
    scope: {
      kind: "aggregate",
      aggregateType: "langy_conversation_turn",
      aggregateId: `${args.conversationId}:${args.turnId}`,
    },
  };
}

export function langyConversationProcessGroupKey(args: {
  readonly tenantId: string;
  readonly conversationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "processManager", name: LANGY_CONVERSATION_PROCESS_NAME },
    scope: conversationScope(args.conversationId),
  };
}

/** Every message-bearing event carries a distinct `messageId`, so a per-event
 *  lane is already maximum parallelism and coalescing would buy nothing. */
export function langyMessageOperationalGroupKey(args: {
  readonly tenantId: string;
  readonly eventId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "langyMessageOperational" },
    scope: { kind: "event", eventId: args.eventId },
  };
}

/** One lane per conversation, so a conversation's analytics events coalesce
 *  into one ClickHouse insert instead of one part per event. */
export function langyAnalyticsEventGroupKey(args: {
  readonly tenantId: string;
  readonly conversationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "langyAnalyticsEvent" },
    scope: conversationScope(args.conversationId),
  };
}

/** Refuses an illegal mount at composition, not on the first delivery (ADR-106). */
function assertMountIsLegal(projection: string, mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `langy-conversation-processing's ${projection} mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: LANGY_CONVERSATION_PIPELINE_NAME, projection, violations },
    );
  }
  return mount;
}

/**
 * The worker-dispatch and title-generation effects a live process outbox
 * would call. Constructed outside this pipeline (ADR-105 decision 6) —
 * `event-sourcing.old`'s equivalent (`langyEffectPorts.ts`) mints session
 * keys, threads the handoff store and terminalizes a rejected turn, none of
 * which this declaration has anything to do it with.
 */
export interface LangyConversationEffects {
  readonly workerDispatch: {
    dispatchTurn(params: {
      readonly conversationId: string;
      readonly turnId: string;
      readonly resumeFromTurnId: string | null;
      readonly projectId: string;
    }): Promise<void>;
  };
  readonly titleGeneration: {
    generateTitle(params: {
      readonly conversationId: string;
      readonly turnId: string;
      readonly projectId: string;
    }): Promise<void>;
  };
}

export interface LangyConversationProcessingDeps {
  readonly client: ClickHouseClient;
  readonly prisma: LangyProjectionPrisma;
  readonly effects: LangyConversationEffects;
  readonly metrics?: Metrics;
}

const conversationIdOf = <Data extends { conversationId: string }>(
  data: Data,
): string => data.conversationId;

export function createLangyConversationProcessingPipeline(
  deps: LangyConversationProcessingDeps,
) {
  const spineStore = createLangyConversationStateStore({ prisma: deps.prisma });
  assertMountIsLegal(LANGY_CONVERSATION_SPINE_PROJECTION, {
    projection: "fold",
    store: spineStore.kind,
    scope: "aggregate",
    collapse: "batch",
  });

  const turnStore = createLangyConversationTurnStore({ prisma: deps.prisma });
  assertMountIsLegal(LANGY_CONVERSATION_TURN_PROJECTION, {
    projection: "fold",
    store: turnStore.kind,
    scope: "aggregate",
    collapse: "batch",
  });

  const messageStore = createLangyMessageStore({ prisma: deps.prisma });
  assertMountIsLegal("langyMessageOperational", {
    projection: "map",
    store: messageStore.kind,
    scope: "event",
    collapse: "none",
  });

  const analyticsStore = clickhouseAppend({
    client: deps.client,
    table: langyAnalyticsEventsTable,
    toRow: langyAnalyticsEventRow,
  });
  assertMountIsLegal("langyAnalyticsEvent", {
    projection: "map",
    store: analyticsStore.kind,
    scope: "aggregate",
    collapse: "batch",
  });

  return definePipeline(LANGY_CONVERSATION_PIPELINE_NAME)
    .prefix(LANGY_CONVERSATION_PIPELINE_PREFIX)
    .events(langyConversationEvents)
    .id({
      conversationStarted: conversationIdOf,
      conversationForked: conversationIdOf,
      messageRecorded: conversationIdOf,
      messageImported: conversationIdOf,
      agentTurnAccepted: conversationIdOf,
      toolCallInitiated: conversationIdOf,
      toolCallSucceeded: conversationIdOf,
      toolCallFailed: conversationIdOf,
      planUpdated: conversationIdOf,
      agentResponseFailed: conversationIdOf,
      agentResponded: conversationIdOf,
      conversationArchived: conversationIdOf,
      conversationMetadataUpdated: conversationIdOf,
      conversationHandoffPending: conversationIdOf,
      conversationHandoffConsumed: conversationIdOf,
      conversationTitleGenerated: conversationIdOf,
    })

    .withCommand("createConversation", {
      input: langyConversationEvents.conversationStarted,
      handle: createConversation,
    })
    .withCommand("forkConversation", {
      input: langyConversationEvents.conversationForked,
      handle: forkConversation,
    })
    .withCommand("recordMessage", {
      input: langyConversationEvents.messageRecorded,
      handle: recordMessage,
    })
    .withCommand("importMessage", {
      input: langyConversationEvents.messageImported,
      handle: importMessage,
    })
    .withCommand("acceptAgentTurn", {
      input: acceptAgentTurnInputSchema,
      handle: acceptAgentTurn,
    })
    .withCommand("initiateToolCall", {
      input: langyConversationEvents.toolCallInitiated,
      handle: initiateToolCall,
    })
    .withCommand("succeedToolCall", {
      input: langyConversationEvents.toolCallSucceeded,
      handle: succeedToolCall,
    })
    .withCommand("failToolCall", {
      input: langyConversationEvents.toolCallFailed,
      handle: failToolCall,
    })
    .withCommand("updatePlan", {
      input: langyConversationEvents.planUpdated,
      handle: updatePlan,
    })
    .withCommand("failAgentResponse", {
      input: langyConversationEvents.agentResponseFailed,
      handle: failAgentResponse,
    })
    .withCommand("recordAgentResponse", {
      input: langyConversationEvents.agentResponded,
      handle: recordAgentResponse,
    })
    .withCommand("archiveConversation", {
      input: langyConversationEvents.conversationArchived,
      handle: archiveConversation,
    })
    .withCommand("updateConversationMetadata", {
      input: langyConversationEvents.conversationMetadataUpdated,
      handle: updateConversationMetadata,
    })
    .withCommand("recordTurnHandoff", {
      input: langyConversationEvents.conversationHandoffPending,
      handle: recordTurnHandoff,
    })
    .withCommand("consumeTurnHandoff", {
      input: langyConversationEvents.conversationHandoffConsumed,
      handle: consumeTurnHandoff,
    })
    .withCommand("generateConversationTitle", {
      input: langyConversationEvents.conversationTitleGenerated,
      handle: generateConversationTitle,
    })

    .withFold(LANGY_CONVERSATION_SPINE_PROJECTION, {
      state: langyConversationSpineStateSchema,
      init: initLangyConversationSpineState,
      pin: LANGY_CONVERSATION_SPINE_VERSION,
      on: applyLangyConversationSpineEvent,
      store: spineStore,
    })
    .withFold(LANGY_CONVERSATION_TURN_PROJECTION, {
      state: langyConversationTurnStateSchema,
      init: initLangyConversationTurnState_,
      pin: LANGY_CONVERSATION_TURN_VERSION,
      on: applyLangyConversationTurnEvent,
      store: turnStore,
    })

    .withMap("langyMessageOperational", {
      on: langyMessageRecords,
      store: messageStore,
    })
    .withMap("langyAnalyticsEvent", {
      on: langyAnalyticsEventRecords,
      store: analyticsStore,
    })

    .withProcessManager(LANGY_CONVERSATION_PROCESS_NAME, {
      state: langyConversationProcessStateSchema,
      init: initLangyConversationProcessState,
      intents: {
        workerDispatch: {
          payload: langyWorkerDispatchIntentSchema,
          messageKey: (payload) => `dispatch:${payload.turnId}`,
          deliver: (payload, ctx: HandlerContext) =>
            deps.effects.workerDispatch.dispatchTurn({
              ...payload,
              projectId: ctx.tenantId,
            }),
        },
        generateTitle: {
          payload: langyGenerateTitleIntentSchema,
          messageKey: (payload) => `title:${payload.turnId}`,
          deliver: (payload, ctx: HandlerContext) =>
            deps.effects.titleGeneration.generateTitle({
              ...payload,
              projectId: ctx.tenantId,
            }),
        },
      },
      on: {
        agentTurnAccepted: handleAgentTurnAccepted,
        agentResponded: handleAgentResponded,
        agentResponseFailed: handleAgentResponseFailed,
        conversationArchived: handleArchived,
        conversationMetadataUpdated: handleMetadataUpdated,
        conversationTitleGenerated: handleTitleGenerated,
        conversationHandoffPending: handleHandoffPending,
        conversationHandoffConsumed: handleHandoffConsumed,
      },
    })

    .build({ metrics: deps.metrics });
}
