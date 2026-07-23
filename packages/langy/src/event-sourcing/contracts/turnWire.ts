/**
 * The WIRE contract of one turn event, as the tail read serves it (ADR-059 §3):
 * the event's identity, its cursor coordinates (`createdAt` is the log-accept
 * time — the same clock as `LangyEventCursor.acceptedAt` — `id` the KSUID
 * tie-break), the fold clock (`occurredAt`), and the typed payload. No tenant,
 * aggregate, or server-only fields ever ride it.
 *
 * A parsed wire event satisfies the fold's portable event shape structurally,
 * so `foldLangyConversationTurn` consumes it directly — the schema lives here,
 * with the other cross-runtime contracts, while the fold stays a pure reducer.
 */
import { z } from "zod";

import { LANGY_CONVERSATION_EVENT_TYPES } from "../../constants";
import {
  langyAgentResponseFailedEventDataSchema,
  langyAgentRespondedEventDataSchema,
  langyAgentTurnAcceptedEventDataSchema,
  langyPlanUpdatedEventDataSchema,
  langyToolCallFailedEventDataSchema,
  langyToolCallInitiatedEventDataSchema,
  langyToolCallSucceededEventDataSchema,
} from "./events";

/** The `type` strings the turn fold consumes (routing/subscription filters). */
export const LANGY_CONVERSATION_TURN_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
] as const;

const turnWireEnvelope = {
  id: z.string(),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
} as const;

export const langyConversationTurnEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED),
    data: langyAgentTurnAcceptedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED),
    data: langyToolCallInitiatedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED),
    data: langyToolCallSucceededEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED),
    data: langyToolCallFailedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED),
    data: langyPlanUpdatedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED),
    data: langyAgentResponseFailedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED),
    data: langyAgentRespondedEventDataSchema,
  }),
]);
export type LangyConversationTurnWireEvent = z.infer<
  typeof langyConversationTurnEventSchema
>;
