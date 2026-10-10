/**
 * What the dispatcher and the gateway write for each other in Redis, and the
 * messages they nudge each other with (ADR-128, "Transport").
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  CALL_ENVELOPE_KEYS,
  type CallEnvelope,
  callEnvelopeSchema,
  outputSchema,
  resultErrorSchema,
  sessionSchema,
} from "./connected-agent.protocol.ts";

/** The value under `agent_call:v1:<callId>`. */
const storedCallSchemaDefinition = z.object({
  projectId: z.string(),
  envelope: callEnvelopeSchema,
  /** The pod whose reply channel the result is nudged on. */
  replyTo: z.string(),
  /** The instance the call was written for; the gateway checks it. */
  instanceId: z.string(),
});
export interface StoredCallSchema extends Named<typeof storedCallSchemaDefinition> {}
export const storedCallSchema: StoredCallSchema = storedCallSchemaDefinition;
export type StoredCall = z.infer<typeof storedCallSchema>;

/** What the gateway measured when it refused a payload above its cap. */
const payloadViolationSchemaDefinition = z.object({
  what: z.enum(["envelope", "result", "session"]),
  sizeBytes: z.number(),
  limitBytes: z.number(),
});
export interface PayloadViolationSchema extends Named<typeof payloadViolationSchemaDefinition> {}
export const payloadViolationSchema: PayloadViolationSchema = payloadViolationSchemaDefinition;
export type PayloadViolation = z.infer<typeof payloadViolationSchema>;

/**
 * The error a stored result carries: what the instance sent, plus the fields the gateway
 * adds when the refusal is its own.
 */
const storedResultErrorSchemaDefinition = z.object({
  ...resultErrorSchema.shape,
  payload: payloadViolationSchema.optional(),
});
export interface StoredResultErrorSchema extends Named<typeof storedResultErrorSchemaDefinition> {}
export const storedResultErrorSchema: StoredResultErrorSchema = storedResultErrorSchemaDefinition;
export type StoredResultError = z.infer<typeof storedResultErrorSchema>;

/** The value under `agent_result:v1:<callId>`. */
const storedResultSchemaDefinition = z.object({
  instanceId: z.string(),
  output: outputSchema.optional(),
  session: sessionSchema,
  error: storedResultErrorSchema.optional(),
  /** Set by the gateway when the socket closed before the instance answered. */
  disconnected: z.boolean().optional(),
  /**
   * Set by the gateway when the call frame never left the platform: the
   * socket was gone before the write, or the instance does not serve that
   * agent. The function cannot have run, so the call is safe to retry.
   */
  undelivered: z.boolean().optional(),
});
export interface StoredResultSchema extends Named<typeof storedResultSchemaDefinition> {}
export const storedResultSchema: StoredResultSchema = storedResultSchemaDefinition;
export type StoredResult = z.infer<typeof storedResultSchema>;

/** What the dispatcher publishes on an instance channel. */
const instanceNudgeSchemaDefinition = z.union([
  z.object({ call: z.string() }),
  z.object({ cancel: z.string() }),
]);
export interface InstanceNudgeSchema extends Named<typeof instanceNudgeSchemaDefinition> {}
export const instanceNudgeSchema: InstanceNudgeSchema = instanceNudgeSchemaDefinition;
export type InstanceNudge = z.infer<typeof instanceNudgeSchema>;

/** What the gateway publishes on a pod's reply channel. */
const replyNudgeSchemaDefinition = z.object({
  callId: z.string(),
  kind: z.enum(["ack", "result"]),
});
export interface ReplyNudgeSchema extends Named<typeof replyNudgeSchemaDefinition> {}
export const replyNudgeSchema: ReplyNudgeSchema = replyNudgeSchemaDefinition;
export type ReplyNudge = z.infer<typeof replyNudgeSchema>;

/** What a gateway publishes when a socket is gone. */
const instanceGoneSchemaDefinition = z.object({
  instanceId: z.string(),
  projectId: z.string(),
});
export interface InstanceGoneSchema extends Named<typeof instanceGoneSchemaDefinition> {}
export const instanceGoneSchema: InstanceGoneSchema = instanceGoneSchemaDefinition;
export type InstanceGone = z.infer<typeof instanceGoneSchema>;

/**
 * The envelope for one turn, holding the contract fields and nothing else.
 */
export function buildCallEnvelope(fields: {
  callId: string;
  agentId: string;
  threadId: string;
  messages: CallEnvelope["messages"];
  newMessages: CallEnvelope["newMessages"];
  params: CallEnvelope["params"];
  session: unknown;
  traceparent: string | null;
  deadlineAt: number;
  run: CallEnvelope["run"];
}): CallEnvelope {
  const envelope: CallEnvelope = {
    callId: fields.callId,
    agentId: fields.agentId,
    threadId: fields.threadId,
    messages: fields.messages,
    newMessages: fields.newMessages,
    params: fields.params,
    // Null rather than absent: the first turn of a thread has no session,
    // and the SDK reads the field on every call.
    session: fields.session ?? null,
    traceparent: fields.traceparent,
    deadlineAt: fields.deadlineAt,
    run: fields.run,
  };
  for (const key of Object.keys(envelope)) {
    if (!(CALL_ENVELOPE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Call envelope carries a field outside the contract: ${key}`);
    }
  }

  return envelope;
}
