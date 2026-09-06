/**
 * The WIRE contract of one turn event (ADR-059 §3): identity, cursor
 * coordinates, fold clock, typed payload — no tenant/aggregate/server-only
 * fields. Satisfies the fold's shape structurally, consumed directly.
 */
import { z } from "zod";

import { LANGY_CONVERSATION_EVENT_TYPES } from "../../constants.ts";
import {
  langyAgentResponseFailedEventDataSchema,
  langyAgentRespondedEventDataSchema,
  langyAgentTurnAcceptedEventDataSchema,
  langyPlanUpdatedEventDataSchema,
  langyToolCallFailedEventDataSchema,
  langyToolCallInitiatedEventDataSchema,
  langyToolCallSucceededEventDataSchema,
  langyUserWaitEndedEventDataSchema,
  langyUserWaitStartedEventDataSchema,
} from "./langy.events.ts";

/** The `type` strings the turn fold consumes (routing/subscription filters). */
export const LANGY_CONVERSATION_TURN_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED,
  LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED,
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
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED),
    data: langyUserWaitStartedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED),
    data: langyUserWaitEndedEventDataSchema,
  }),
]);
export type LangyConversationTurnWireEvent = z.infer<typeof langyConversationTurnEventSchema>;
