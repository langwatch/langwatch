import type { Named } from "@langwatch/module";
import { z } from "zod";

/** Wire grammar is standalone for SDK parity; see ADR-128. */
const MAX_PARAMETER_NAME_LENGTH = 64;
const SCENARIO_PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const PROTOCOL_VERSION = 1;

const versioned = z.object({ protocol: z.literal(PROTOCOL_VERSION) });

/** One conversation message, OpenAI style. Content passes through untouched. */
const messageSchemaDefinition = z.object({ role: z.string().min(1) }).passthrough();
export interface MessageSchema extends Named<typeof messageSchemaDefinition> {}
export const messageSchema: MessageSchema = messageSchemaDefinition;
export type ProtocolMessage = z.infer<typeof messageSchema>;

/** A run parameter value: a JSON scalar. */
const paramValueSchemaDefinition = z.union([z.string(), z.number(), z.boolean()]);
export interface ParamValueSchema extends Named<typeof paramValueSchemaDefinition> {}
export const paramValueSchema: ParamValueSchema = paramValueSchemaDefinition;

const paramsSchemaDefinition = z.record(
  z.string().regex(SCENARIO_PARAMETER_NAME_PATTERN),
  paramValueSchema,
);
export interface ParamsSchema extends Named<typeof paramsSchemaDefinition> {}
export const paramsSchema: ParamsSchema = paramsSchemaDefinition;

/** The agent's own per-conversation memory: any JSON value, or nothing. */
export const sessionSchema = z.unknown().optional();

const sdkSchemaDefinition = z.object({
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(64),
  language: z.string().min(1).max(32),
});
export interface SdkSchema extends Named<typeof sdkSchemaDefinition> {}
export const sdkSchema: SdkSchema = sdkSchemaDefinition;

const registerInstanceSchemaDefinition = z.object({
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
export interface RegisterInstanceSchema extends Named<typeof registerInstanceSchemaDefinition> {}
export const registerInstanceSchema: RegisterInstanceSchema = registerInstanceSchemaDefinition;

const registerAgentSchemaDefinition = z.object({
  name: z.string().min(1).max(255),
  environment: z.string().min(1).max(64),
  /** A JSON Schema object the gateway normalizes into parameter definitions. */
  parameters: z.record(z.string(), z.unknown()).default({}),
  concurrency: z.number().int().positive().max(1000).optional(),
  timeoutMs: z.number().int().positive().optional(),
  sticky: z.boolean().optional(),
});
export interface RegisterAgentSchema extends Named<typeof registerAgentSchemaDefinition> {}
export const registerAgentSchema: RegisterAgentSchema = registerAgentSchemaDefinition;

const registerFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("register"),
  sdk: sdkSchema,
  instance: registerInstanceSchema,
  agents: z.array(registerAgentSchema).min(1).max(100),
});
export interface RegisterFrameSchema extends Named<typeof registerFrameSchemaDefinition> {}
export const registerFrameSchema: RegisterFrameSchema = registerFrameSchemaDefinition;
export type RegisterFrame = z.infer<typeof registerFrameSchema>;

/**
 * Who can target the agent, as the SDK prints it at startup. The owner's user
 * id stays off the wire: the process that registered already holds the key.
 */
const registeredScopeSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shared") }),
  z.object({ kind: z.literal("owner") }),
  z.object({ kind: z.literal("host"), hostLabel: z.string() }),
]);
export interface RegisteredScopeSchema extends Named<typeof registeredScopeSchemaDefinition> {}
export const registeredScopeSchema: RegisteredScopeSchema = registeredScopeSchemaDefinition;
export type RegisteredScope = z.infer<typeof registeredScopeSchema>;

const registeredFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("registered"),
  agents: z.array(
    z.object({
      name: z.string(),
      environment: z.string(),
      id: z.string(),
      url: z.string(),
      parameterNotes: z.array(z.string()),
      scope: registeredScopeSchema,
    }),
  ),
  heartbeatIntervalMs: z.number().int().positive(),
  instanceId: z.string(),
});
export interface RegisteredFrameSchema extends Named<typeof registeredFrameSchemaDefinition> {}
export const registeredFrameSchema: RegisteredFrameSchema = registeredFrameSchemaDefinition;
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

const refusedFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("refused"),
  code: z.enum(REFUSED_CODES),
  message: z.string(),
  /** Structured detail, for example the projects a key can reach. */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export interface RefusedFrameSchema extends Named<typeof refusedFrameSchemaDefinition> {}
export const refusedFrameSchema: RefusedFrameSchema = refusedFrameSchemaDefinition;
export type RefusedFrame = z.infer<typeof refusedFrameSchema>;

/** The run a call belongs to, for the SDK's own logs and spans. */
const callRunSchemaDefinition = z.object({
  scenarioRunId: z.string().optional(),
  scenarioName: z.string().optional(),
  batchRunId: z.string().optional(),
});
export interface CallRunSchema extends Named<typeof callRunSchemaDefinition> {}
export const callRunSchema: CallRunSchema = callRunSchemaDefinition;

/**
 * What an instance receives for one turn: the contract fields and nothing
 * else. `judgmentRequest` and platform metadata never travel here.
 */
const callEnvelopeSchemaDefinition = z.object({
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
export interface CallEnvelopeSchema extends Named<typeof callEnvelopeSchemaDefinition> {}
export const callEnvelopeSchema: CallEnvelopeSchema = callEnvelopeSchemaDefinition;
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

const callFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("call"),
  ...callEnvelopeSchema.shape,
});
export interface CallFrameSchema extends Named<typeof callFrameSchemaDefinition> {}
export const callFrameSchema: CallFrameSchema = callFrameSchemaDefinition;
export type CallFrame = z.infer<typeof callFrameSchema>;

const ackFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("ack"),
  callId: z.string().min(1),
});
export interface AckFrameSchema extends Named<typeof ackFrameSchemaDefinition> {}
export const ackFrameSchema: AckFrameSchema = ackFrameSchemaDefinition;
export type AckFrame = z.infer<typeof ackFrameSchema>;

/** What a function may answer with: text, one message, or a list. */
const outputSchemaDefinition = z.union([z.string(), messageSchema, z.array(messageSchema)]);
export interface OutputSchema extends Named<typeof outputSchemaDefinition> {}
export const outputSchema: OutputSchema = outputSchemaDefinition;
export type CallOutput = z.infer<typeof outputSchema>;

const resultErrorSchemaDefinition = z.object({
  code: z.string().min(1).max(64),
  message: z.string().max(4000),
});
export interface ResultErrorSchema extends Named<typeof resultErrorSchemaDefinition> {}
export const resultErrorSchema: ResultErrorSchema = resultErrorSchemaDefinition;

const resultFrameSchemaDefinition = z
  .object({
    ...versioned.shape,
    type: z.literal("result"),
    callId: z.string().min(1),
    output: outputSchema.optional(),
    session: sessionSchema,
    error: resultErrorSchema.optional(),
  })
  .refine((frame) => (frame.output !== void 0) !== (frame.error !== void 0), {
    message: "A result carries an output or an error, and never both",
  });
export interface ResultFrameSchema extends Named<typeof resultFrameSchemaDefinition> {}
export const resultFrameSchema: ResultFrameSchema = resultFrameSchemaDefinition;
export type ResultFrame = z.infer<typeof resultFrameSchema>;

const cancelFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("cancel"),
  callId: z.string().min(1),
});
export interface CancelFrameSchema extends Named<typeof cancelFrameSchemaDefinition> {}
export const cancelFrameSchema: CancelFrameSchema = cancelFrameSchemaDefinition;
export type CancelFrame = z.infer<typeof cancelFrameSchema>;

const deregisterFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("deregister"),
});
export interface DeregisterFrameSchema extends Named<typeof deregisterFrameSchemaDefinition> {}
export const deregisterFrameSchema: DeregisterFrameSchema = deregisterFrameSchemaDefinition;
export type DeregisterFrame = z.infer<typeof deregisterFrameSchema>;

/** Every frame the SDK sends the platform. */
const sdkFrameSchemaDefinition = z.union([
  registerFrameSchema,
  ackFrameSchema,
  resultFrameSchema,
  deregisterFrameSchema,
]);
export interface SdkFrameSchema extends Named<typeof sdkFrameSchemaDefinition> {}
export const sdkFrameSchema: SdkFrameSchema = sdkFrameSchemaDefinition;
export type SdkFrame = z.infer<typeof sdkFrameSchema>;

/** Every frame the platform sends the SDK. */
export type PlatformFrame = RegisteredFrame | RefusedFrame | CallFrame | CancelFrame;

/** A parameter name the grammar accepts; the same rule scenarios follow. */
export const parameterNameSchema = z
  .string()
  .min(1)
  .max(MAX_PARAMETER_NAME_LENGTH)
  .regex(SCENARIO_PARAMETER_NAME_PATTERN);
