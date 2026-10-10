import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { AgentCallSignal } from "./connected-agent.connection.ts";
import {
  callRunSchema,
  messageSchema,
  outputSchema,
  paramsSchema,
} from "./connected-agent.protocol.ts";

const relayCallBodySchemaDefinition = z.object({
  messages: z.array(messageSchema).describe("The whole conversation so far, OpenAI style."),
  newMessages: z
    .array(messageSchema)
    .optional()
    .describe("The messages added since the agent's last turn. Defaults to the last message."),
  threadId: z
    .string()
    .max(255)
    .optional()
    .describe(
      "The conversation id. Turns of one conversation share it; a new id starts a new one.",
    ),
  params: paramsSchema.optional().describe("Run parameter values by name, as JSON scalars."),
  session: z
    .unknown()
    .optional()
    .describe(
      "The session the agent returned on its previous turn of this conversation, echoed back as is.",
    ),
  traceparent: z
    .string()
    .max(255)
    .optional()
    .describe("The W3C trace context the agent adopts, so its spans join this turn's trace."),
  run: callRunSchema.optional().describe("The simulation run this turn belongs to, if any."),
});
export interface RelayCallBodySchema extends Named<typeof relayCallBodySchemaDefinition> {}
export const relayCallBodySchema: RelayCallBodySchema = relayCallBodySchemaDefinition;

const relayCallResponseSchemaDefinition = z.object({
  output: outputSchema.describe(
    "What the function answered: text, one message, or a list of messages.",
  ),
  session: z
    .unknown()
    .optional()
    .describe("The agent's per-conversation memory, to send on the next turn."),
  instance: z.object({
    hostname: z.string(),
    label: z.string().nullable(),
  }),
  durationMs: z.number(),
});
export interface RelayCallResponseSchema extends Named<typeof relayCallResponseSchemaDefinition> {}
export const relayCallResponseSchema: RelayCallResponseSchema = relayCallResponseSchemaDefinition;

export type AgentCallInput = z.infer<typeof relayCallBodySchema> & {
  id: string;
  projectId: string;
};
export type AgentCallResult = z.infer<typeof relayCallResponseSchema>;
export type AgentCallContext = {
  viewerUserId: string | null;
  traceparent: string | null;
  signal?: AgentCallSignal;
};
