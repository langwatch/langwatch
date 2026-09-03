/**
 * The frames of the connected agent socket (ADR-128, "Contract").
 *
 * Every frame is JSON text with a `type` and the protocol version. The SDK
 * keeps a copy of these shapes; a drift test on its side pins them to this
 * file. Browser-safe: zod and nothing else.
 */

import { z } from "zod";

/**
 * The parameter-name grammar and cap, restated here rather than imported from
 * the scenario contract: this module is the wire contract the SDK keeps its
 * own copy of, and it must stay free of every dependency but zod.
 *
 * @see `SCENARIO_PARAMETER_NAME_PATTERN` and `MAX_PARAMETER_NAME_LENGTH` in
 *   `@langwatch/scenario-contract`, which these two mirror.
 */
const MAX_PARAMETER_NAME_LENGTH = 64;
const SCENARIO_PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const PROTOCOL_VERSION = 1;

const versioned = z.object({ protocol: z.literal(PROTOCOL_VERSION) });

/** One conversation message, OpenAI style. Content passes through untouched. */
export const messageSchema = z.object({ role: z.string().min(1) }).passthrough();
export type ProtocolMessage = z.infer<typeof messageSchema>;

/** A run parameter value: a JSON scalar. */
export const paramValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const paramsSchema = z.record(
  z.string().regex(SCENARIO_PARAMETER_NAME_PATTERN),
  paramValueSchema,
);

/** The agent's own per-conversation memory: any JSON value, or nothing. */
export const sessionSchema = z.unknown().optional();

export const sdkSchema = z.object({
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(64),
  language: z.string().min(1).max(32),
});

export const registerInstanceSchema = z.object({
  id: z.string().min(1).max(128),
  hostname: z.string().max(255),
  username: z.string().max(255),
  pid: z.number().int().nonnegative(),
  startedAt: z.string().max(64),
  label: z.string().max(128).optional(),
  /** Calls the SDK was working on when the socket dropped. */
  inFlightCallIds: z.array(z.string().max(128)).max(1000).default([]),
  /** Calls this instance takes at once; the platform default applies when absent. */
  maxConcurrency: z.number().int().positive().max(1000).optional(),
});

export const registerAgentSchema = z.object({
  name: z.string().min(1).max(255),
  environment: z.string().min(1).max(64),
  /** A JSON Schema object the gateway normalizes into parameter definitions. */
  parameters: z.record(z.string(), z.unknown()).default({}),
  concurrency: z.number().int().positive().max(1000).optional(),
  timeoutMs: z.number().int().positive().optional(),
  sticky: z.boolean().optional(),
});

export const registerFrameSchema = versioned.extend({
  type: z.literal("register"),
  sdk: sdkSchema,
  instance: registerInstanceSchema,
  agents: z.array(registerAgentSchema).min(1).max(100),
});
export type RegisterFrame = z.infer<typeof registerFrameSchema>;

export const registeredFrameSchema = versioned.extend({
  type: z.literal("registered"),
  agents: z.array(
    z.object({
      name: z.string(),
      environment: z.string(),
      id: z.string(),
      url: z.string(),
      parameterNotes: z.array(z.string()),
    }),
  ),
  heartbeatIntervalMs: z.number().int().positive(),
  instanceId: z.string(),
});
export type RegisteredFrame = z.infer<typeof registeredFrameSchema>;

/** Why a connection was refused; the SDK prints these at startup. */
export const REFUSED_CODES = [
  "api_key_invalid",
  "project_required",
  "permission_denied",
  "key_type_not_allowed",
  "replica_count_unsupported",
  "parameters_invalid",
  "environment_invalid",
  "protocol_invalid",
] as const;
export type RefusedCode = (typeof REFUSED_CODES)[number];

export const refusedFrameSchema = versioned.extend({
  type: z.literal("refused"),
  code: z.enum(REFUSED_CODES),
  message: z.string(),
  /** Structured detail, for example the projects a key can reach. */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type RefusedFrame = z.infer<typeof refusedFrameSchema>;

/** The run a call belongs to, for the SDK's own logs and spans. */
export const callRunSchema = z.object({
  scenarioRunId: z.string().optional(),
  scenarioName: z.string().optional(),
  batchRunId: z.string().optional(),
});

/**
 * What an instance receives for one turn: the contract fields and nothing
 * else. `judgmentRequest` and platform metadata never travel here.
 */
export const callEnvelopeSchema = z.object({
  callId: z.string(),
  agentId: z.string(),
  threadId: z.string(),
  messages: z.array(messageSchema),
  newMessages: z.array(messageSchema),
  params: paramsSchema,
  session: sessionSchema,
  traceparent: z.string().nullable(),
  deadlineAt: z.number().int(),
  run: callRunSchema,
});
export type CallEnvelope = z.infer<typeof callEnvelopeSchema>;

/** The ten keys of an envelope, the exact set a test pins. */
export const CALL_ENVELOPE_KEYS = [
  "callId",
  "agentId",
  "threadId",
  "messages",
  "newMessages",
  "params",
  "session",
  "traceparent",
  "deadlineAt",
  "run",
] as const;

export const callFrameSchema = versioned
  .extend({ type: z.literal("call") })
  .merge(callEnvelopeSchema);
export type CallFrame = z.infer<typeof callFrameSchema>;

export const ackFrameSchema = versioned.extend({
  type: z.literal("ack"),
  callId: z.string().min(1),
});
export type AckFrame = z.infer<typeof ackFrameSchema>;

/** What a function may answer with: text, one message, or a list. */
export const outputSchema = z.union([z.string(), messageSchema, z.array(messageSchema)]);
export type CallOutput = z.infer<typeof outputSchema>;

export const resultErrorSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().max(4000),
});

export const resultFrameSchema = versioned
  .extend({
    type: z.literal("result"),
    callId: z.string().min(1),
    output: outputSchema.optional(),
    session: sessionSchema,
    error: resultErrorSchema.optional(),
  })
  .refine((frame) => (frame.output !== undefined) !== (frame.error !== undefined), {
    message: "A result carries an output or an error, and never both",
  });
export type ResultFrame = z.infer<typeof resultFrameSchema>;

export const cancelFrameSchema = versioned.extend({
  type: z.literal("cancel"),
  callId: z.string().min(1),
});
export type CancelFrame = z.infer<typeof cancelFrameSchema>;

export const deregisterFrameSchema = versioned.extend({
  type: z.literal("deregister"),
});
export type DeregisterFrame = z.infer<typeof deregisterFrameSchema>;

/** Every frame the SDK sends the platform. */
export const sdkFrameSchema = z.union([
  registerFrameSchema,
  ackFrameSchema,
  resultFrameSchema,
  deregisterFrameSchema,
]);
export type SdkFrame = z.infer<typeof sdkFrameSchema>;

/** Every frame the platform sends the SDK. */
export type PlatformFrame = RegisteredFrame | RefusedFrame | CallFrame | CancelFrame;

/** A parameter name the grammar accepts; the same rule scenarios follow. */
export const parameterNameSchema = z
  .string()
  .min(1)
  .max(MAX_PARAMETER_NAME_LENGTH)
  .regex(SCENARIO_PARAMETER_NAME_PATTERN);
