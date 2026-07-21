/**
 * The Langy message MAP — one durable message-bearing event to one message
 * row, shared by the server's Postgres map projection and (ADR-059 Phase 4,
 * client half) the browser's local message list.
 */
import { LANGY_CONVERSATION_EVENT_TYPES } from "./constants";
import type {
  LangyAgentRespondedEventData,
  LangyMessageImportedEventData,
  LangyMessageRecordedEventData,
} from "./events";
import type { LangyMessagePart, LangyMessageRole } from "./shared";

export interface LangyMessageProjectionRecord {
  ConversationId: string;
  MessageId: string;
  Role: LangyMessageRole;
  Parts: LangyMessagePart[];
  SourceEventId: string;
  OccurredAt: number;
  AcceptedAt: number;
  CreatedAt: number;
  UpdatedAt: number;
}

/** The portable shape of one message-bearing event. */
interface MessageMapEvent<Type extends string, Data> {
  id: string;
  createdAt: number;
  occurredAt: number;
  type: Type;
  data: Data;
}

export type LangyMessageEvent =
  | MessageMapEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
      LangyMessageRecordedEventData
    >
  | MessageMapEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      LangyAgentRespondedEventData
    >
  | MessageMapEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
      LangyMessageImportedEventData
    >;

/** The `type` strings that carry a message row. */
export const LANGY_MESSAGE_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
] as const;

/** Map ONE message-bearing event onto its message row. Pure and total. */
export function mapLangyMessageEvent(
  event: LangyMessageEvent,
): LangyMessageProjectionRecord {
  return {
    ConversationId: event.data.conversationId,
    MessageId: event.data.messageId,
    Role: event.data.role,
    Parts: event.data.parts,
    SourceEventId: event.id,
    OccurredAt: event.occurredAt,
    AcceptedAt: event.createdAt,
    CreatedAt: event.occurredAt,
    UpdatedAt: event.occurredAt,
  };
}
