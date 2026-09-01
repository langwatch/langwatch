/**
 * What the dispatcher and the gateway write for each other in Redis, and the
 * messages they nudge each other with (ADR-128, "Transport").
 *
 * The dispatcher, on the pod that took the relay request, writes the envelope
 * and nudges the instance channel; the gateway, on the pod that holds the
 * socket, reads the envelope and sends the frame. The result travels back the
 * same way: a key the gateway writes, a nudge on the dispatcher pod's reply
 * channel, and a poll of the key as the fallback.
 */

import { z } from "zod";
import {
  CALL_ENVELOPE_KEYS,
  type CallEnvelope,
  type CallOutput,
  callEnvelopeSchema,
  outputSchema,
  resultErrorSchema,
  sessionSchema,
} from "./protocol";

/** The value under `agent_call:v1:<callId>`. */
export const storedCallSchema = z.object({
  projectId: z.string(),
  envelope: callEnvelopeSchema,
  /** The pod whose reply channel the result is nudged on. */
  replyTo: z.string(),
  /** The instance the call was written for; the gateway checks it. */
  instanceId: z.string(),
});
export type StoredCall = z.infer<typeof storedCallSchema>;

/** What the gateway measured when it refused a payload above its cap. */
export const payloadViolationSchema = z.object({
  what: z.enum(["envelope", "result", "session"]),
  sizeBytes: z.number(),
  limitBytes: z.number(),
});
export type PayloadViolation = z.infer<typeof payloadViolationSchema>;

/**
 * The error a stored result carries: what the instance sent, plus the fields
 * the gateway adds when the refusal is its own.
 *
 * The sizes travel as fields rather than inside the message, so the
 * dispatcher raises the same handled error without reading the copy, and an
 * instance cannot claim a platform refusal by sending its code.
 */
export const storedResultErrorSchema = resultErrorSchema.extend({
  payload: payloadViolationSchema.optional(),
});
export type StoredResultError = z.infer<typeof storedResultErrorSchema>;

/** The value under `agent_result:v1:<callId>`. */
export const storedResultSchema = z.object({
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
export type StoredResult = z.infer<typeof storedResultSchema>;

/** What the dispatcher publishes on an instance channel. */
export const instanceNudgeSchema = z.union([
  z.object({ call: z.string() }),
  z.object({ cancel: z.string() }),
]);
export type InstanceNudge = z.infer<typeof instanceNudgeSchema>;

/** What the gateway publishes on a pod's reply channel. */
export const replyNudgeSchema = z.object({
  callId: z.string(),
  kind: z.enum(["ack", "result"]),
});
export type ReplyNudge = z.infer<typeof replyNudgeSchema>;

/** What a gateway publishes when a socket is gone. */
export const instanceGoneSchema = z.object({
  instanceId: z.string(),
  projectId: z.string(),
});
export type InstanceGone = z.infer<typeof instanceGoneSchema>;

/**
 * The envelope for one turn, holding the contract fields and nothing else.
 *
 * Built from named fields rather than by spreading the request, so a field
 * the relay body carries beyond the contract (a judgment request, platform
 * metadata) can never reach an instance.
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
      throw new Error(
        `Call envelope carries a field outside the contract: ${key}`,
      );
    }
  }
  return envelope;
}

/** The size of a JSON value on the wire, in bytes. */
export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

/**
 * The cap a result breaks, or nothing when it fits.
 *
 * The session is checked on its own first: it is the small value the SDK
 * echoes on every later turn, so a session at the size of a result would
 * make every turn of the thread carry it.
 */
export function resultCapViolation({
  output,
  session,
  caps,
}: {
  output: unknown;
  session: unknown;
  caps: { resultBytes: number; sessionBytes: number };
}): {
  what: "result" | "session";
  sizeBytes: number;
  limitBytes: number;
} | null {
  const sessionBytes = session === undefined ? 0 : jsonByteLength(session);
  if (session !== undefined && sessionBytes > caps.sessionBytes) {
    return {
      what: "session",
      sizeBytes: sessionBytes,
      limitBytes: caps.sessionBytes,
    };
  }
  const resultBytes = jsonByteLength(output) + sessionBytes;
  if (resultBytes > caps.resultBytes) {
    return {
      what: "result",
      sizeBytes: resultBytes,
      limitBytes: caps.resultBytes,
    };
  }
  return null;
}

/** What the relay answers with. */
export interface CallOutcome {
  output: CallOutput;
  session?: unknown;
  instance: { instanceId: string; hostname: string; label: string | null };
  durationMs: number;
}
