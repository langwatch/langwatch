import { z } from "zod";
import type { Command, CommandHandler } from "../../commands/command";
import { defineCommand } from "../../commands/defineCommand";
import { defineCommandSchema } from "../../commands/commandSchema";
import {
  stripEnvelope,
  withCommandEnvelope,
} from "../../commands/commandEnvelope";
import { EventUtils } from "../../utils/event.utils";
import {
  LANGY_CONVERSATION_COMMAND_TYPES,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "./schemas/constants";
import {
  langyAgentResponseFailedEventDataSchema,
  langyAgentRespondedEventDataSchema,
  langyAgentTurnAcceptedEventDataSchema,
  langyConversationArchivedEventDataSchema,
  langyMessageRecordedEventDataSchema,
  langyConversationForkedEventDataSchema,
  langyConversationStartedEventDataSchema,
  langyConversationHandoffConsumedEventDataSchema,
  langyConversationHandoffPendingEventDataSchema,
  langyConversationMetadataUpdatedEventDataSchema,
  langyConversationTitleGeneratedEventDataSchema,
  langyMessageImportedEventDataSchema,
  langyPlanUpdatedEventDataSchema,
  langyToolCallFailedEventDataSchema,
  langyToolCallInitiatedEventDataSchema,
  langyToolCallSucceededEventDataSchema,
  type LangyConversationProcessingEvent,
} from "./schemas/events";

/**
 * Langy conversation commands. Most are pure 1:1 command → event mappings via
 * defineCommand; AcceptAgentTurn deliberately emits one ordered boundary batch.
 * Aggregate = `langy_conversation`, aggregateId = conversationId, TenantId =
 * projectId.
 */

/** CreateConversation → conversation_started (explicit creation). */
export const CreateConversationCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.CREATE_CONVERSATION,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED,
  aggregateType: "langy_conversation",
  schema: langyConversationStartedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) => `${d.tenantId}:${d.conversationId}:created`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
  }),
});

/** ForkConversation → conversation_forked (new aggregate with source lineage). */
export const ForkConversationCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.FORK_CONVERSATION,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_FORKED,
  aggregateType: "langy_conversation",
  schema: langyConversationForkedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) => `${d.tenantId}:${d.conversationId}:forked`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.conversation.source_id": d.sourceConversationId,
  }),
});

/** RecordMessage → message_recorded. */
export const RecordMessageCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.RECORD_MESSAGE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED,
  aggregateType: "langy_conversation",
  schema: langyMessageRecordedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:message:${d.messageId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.message.id": d.messageId,
    "payload.role": d.role,
  }),
});

/** ImportMessage → message_imported (history copy, never a live turn). */
export const ImportMessageCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.IMPORT_MESSAGE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_IMPORTED,
  aggregateType: "langy_conversation",
  schema: langyMessageImportedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:import:${d.sourceMessageId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.conversation.source_id": d.sourceConversationId,
    "payload.message.id": d.messageId,
    "payload.message.source_id": d.sourceMessageId,
  }),
});

/**
 * AcceptAgentTurn atomically stores the accepted turn and, when resuming, the
 * prior handoff consumption. The token itself stays out of the event log; only
 * the producing turn id is recorded. One command/store batch means a crash can
 * never commit the new turn while losing the durable consume.
 */
const acceptAgentTurnDataSchema = langyAgentTurnAcceptedEventDataSchema.extend({
  conversationStart: langyConversationStartedEventDataSchema
    .omit({ conversationId: true })
    .optional(),
  userMessage: langyMessageRecordedEventDataSchema
    .omit({ conversationId: true })
    .optional(),
  consumeHandoffTurnId: z.string().optional(),
});
const acceptAgentTurnCommandSchema = withCommandEnvelope(
  acceptAgentTurnDataSchema,
);
export type LangyAcceptAgentTurnCommandData = z.infer<
  typeof acceptAgentTurnCommandSchema
>;

export class AcceptAgentTurnCommand
  implements
    CommandHandler<
      Command<LangyAcceptAgentTurnCommandData>,
      LangyConversationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    LANGY_CONVERSATION_COMMAND_TYPES.ACCEPT_AGENT_TURN,
    acceptAgentTurnCommandSchema,
  );

  static getAggregateId(data: LangyAcceptAgentTurnCommandData): string {
    return data.conversationId;
  }

  static getSpanAttributes(data: LangyAcceptAgentTurnCommandData) {
    return {
      "payload.conversation.id": data.conversationId,
      "payload.turn.id": data.turnId,
    };
  }

  handle(
    command: Command<LangyAcceptAgentTurnCommandData>,
  ): LangyConversationProcessingEvent[] {
    const data = stripEnvelope(command.data);
    const {
      conversationStart,
      userMessage,
      consumeHandoffTurnId,
      ...acceptedData
    } = data;
    const events: LangyConversationProcessingEvent[] = [];

    if (conversationStart) {
      events.push(
        EventUtils.createEvent({
          aggregateType: "langy_conversation",
          aggregateId: data.conversationId,
          tenantId: command.tenantId,
          type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
          version: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED,
          data: { conversationId: data.conversationId, ...conversationStart },
          occurredAt: command.data.occurredAt,
          idempotencyKey: `${command.data.tenantId}:${data.conversationId}:created`,
        }) as LangyConversationProcessingEvent,
      );
    }

    if (userMessage) {
      events.push(
        EventUtils.createEvent({
          aggregateType: "langy_conversation",
          aggregateId: data.conversationId,
          tenantId: command.tenantId,
          type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
          version: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED,
          data: { conversationId: data.conversationId, ...userMessage },
          occurredAt: command.data.occurredAt + events.length,
          idempotencyKey: `${command.data.tenantId}:${data.conversationId}:message:${userMessage.messageId}`,
        }) as LangyConversationProcessingEvent,
      );
    }

    const accepted = EventUtils.createEvent({
      aggregateType: "langy_conversation",
      aggregateId: data.conversationId,
      tenantId: command.tenantId,
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
      data: acceptedData,
      occurredAt: command.data.occurredAt + events.length,
      idempotencyKey: `${command.data.tenantId}:${data.conversationId}:turn-accepted:${data.turnId}`,
    }) as LangyConversationProcessingEvent;

    events.push(accepted);
    if (!consumeHandoffTurnId) return events;
    const consumed = EventUtils.createEvent({
      aggregateType: "langy_conversation",
      aggregateId: data.conversationId,
      tenantId: command.tenantId,
      type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_CONSUMED,
      data: {
        conversationId: data.conversationId,
        turnId: consumeHandoffTurnId,
      },
      occurredAt: command.data.occurredAt + events.length,
      idempotencyKey: `${command.data.tenantId}:${data.conversationId}:handoff-consumed:${consumeHandoffTurnId}`,
    }) as LangyConversationProcessingEvent;
    events.push(consumed);
    return events;
  }
}

// NOTE: status_reported / progress_reported are EPHEMERAL signals, not durable
// commands — they are published to the Redis buffer via LangyEphemeralPublisher
// (see ../ephemeral.ts), never dispatched through this pipeline (ADR-046).
//
// The commands below ARE durable: a meaningful result the agent produces during
// a response (a tool call it ran, an intermediate answer, a hard failure) is
// worth persisting on the event log, unlike a transient "42% through" tick.

/** InitiateToolCall → tool_call_initiated (a durable response milestone). */
export const InitiateToolCallCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.INITIATE_TOOL_CALL,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED,
  aggregateType: "langy_conversation",
  schema: langyToolCallInitiatedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-start:${d.toolCallId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.tool.name": d.toolName,
  }),
});

/** SucceedToolCall → tool_call_succeeded (a durable response milestone). */
export const SucceedToolCallCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.SUCCEED_TOOL_CALL,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
  aggregateType: "langy_conversation",
  schema: langyToolCallSucceededEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-done:${d.toolCallId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.tool.name": d.toolName,
  }),
});

/**
 * FailToolCall → tool_call_failed (a durable response milestone). The failing
 * terminal of a tool call; a call reaches exactly one of succeed/fail, so the
 * idempotency key matches SucceedToolCall's `tool-done` slot — the first
 * terminal for a toolCallId wins and a contradictory second is collapsed.
 */
export const FailToolCallCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.FAIL_TOOL_CALL,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_FAILED,
  aggregateType: "langy_conversation",
  schema: langyToolCallFailedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-done:${d.toolCallId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.tool.name": d.toolName,
  }),
});

/**
 * UpdatePlan → plan_updated (a durable snapshot of the agent's todo list).
 *
 * Snapshot-typed, last-write-wins on the turn fold. The idempotency key is
 * turn-scoped AND per-dispatch (occurredAt), mirroring UpdateConversationMetadata's
 * `metadata:<occurredAt>` slot: a mutable, legitimately-repeated event where each
 * distinct snapshot is its own event and the fold applies them in occurredAt
 * order (the latest wins). A REDELIVERED frame is already dropped upstream by the
 * relay's frameNonce dedup before this command is ever dispatched, so the key is
 * a store-level backstop, not the primary dedup.
 */
export const UpdatePlanCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.UPDATE_PLAN,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED,
  aggregateType: "langy_conversation",
  schema: langyPlanUpdatedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:plan:${d.turnId}:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.plan.items": d.items.length,
  }),
});

/**
 * FailAgentResponse → agent_response_failed. The terminal a stalled/orphaned
 * response reaches when there is no answer to carry (the liveness sweep drains
 * it). Distinct from RecordAgentResponse/agent_responded, which carries the
 * completed answer.
 *
 * A turn reaches exactly ONE terminal (answer or failure), so the idempotency
 * key shares the `turn-terminal` slot with RecordAgentResponse — mirroring the
 * tool-call commands' shared `tool-done` slot. The first terminal for a turnId
 * wins; a contradictory second (a stale liveness failure racing the real
 * answer, or vice versa) collapses instead of double-terminating the turn.
 */
export const FailAgentResponseCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.FAIL_AGENT_RESPONSE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_FAILED,
  aggregateType: "langy_conversation",
  schema: langyAgentResponseFailedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:turn-terminal:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
});

/**
 * RecordAgentResponse → agent_responded (the whole final answer, source of
 * truth). Shares the `turn-terminal` idempotency slot with FailAgentResponse —
 * see that command's doc.
 */
export const RecordAgentResponseCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.RECORD_AGENT_RESPONSE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
  aggregateType: "langy_conversation",
  schema: langyAgentRespondedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:turn-terminal:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.outcome": d.outcome,
  }),
});

/** ArchiveConversation → conversation_archived (soft-delete). */
export const ArchiveConversationCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.ARCHIVE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.ARCHIVED,
  aggregateType: "langy_conversation",
  schema: langyConversationArchivedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) => `${d.tenantId}:${d.conversationId}:archive`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
  }),
});

/**
 * GenerateConversationTitle → conversation_title_generated (auto title).
 * Dispatched after a successful agent-response boundary while the title is
 * still derived. Idempotency is scoped to the triggering turn, so duplicate
 * delivery cannot record a second automatic title.
 */
export const GenerateConversationTitleCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.GENERATE_TITLE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TITLE_GENERATED,
  aggregateType: "langy_conversation",
  schema: langyConversationTitleGeneratedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  // The process-outbox effect supplies turnId. occurredAt is retained only for
  // trusted command callers that do not originate from an agent response.
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:title:${d.turnId ?? d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.title.source": d.source,
    "payload.model": d.model,
  }),
});

/**
 * UpdateConversationMetadata → conversation_metadata_updated (rename/share).
 * Beyond the prescribed vocabulary — see ADR-046 open question 1.
 */
export const UpdateConversationMetadataCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.UPDATE_METADATA,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED,
  aggregateType: "langy_conversation",
  schema: langyConversationMetadataUpdatedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:metadata:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
  }),
});

/**
 * RecordTurnHandoff → conversation_handoff_pending (ADR-048). Persists the
 * opaque, worker-authored resume token for a turn that checkpointed on pod
 * termination. Idempotency keyed on the turn so a retried handoff writes one
 * event.
 */
export const RecordTurnHandoffCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.RECORD_TURN_HANDOFF,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_PENDING,
  aggregateType: "langy_conversation",
  schema: langyConversationHandoffPendingEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:handoff:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
});

/**
 * ConsumeTurnHandoff → conversation_handoff_consumed (ADR-048). Clears the
 * pending token once the next turn has threaded it to a fresh worker.
 * Idempotency keyed on the turn so a double-consume collapses to one event.
 */
export const ConsumeTurnHandoffCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.CONSUME_TURN_HANDOFF,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_CONSUMED,
  aggregateType: "langy_conversation",
  schema: langyConversationHandoffConsumedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:handoff-consumed:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
});
