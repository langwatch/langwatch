/**
 * The frames of the local control socket (ADR-129).
 *
 * `langwatch langy --share-control` opens this socket from the developer's
 * machine. Langy's local tools become `call` frames the CLI executes in the
 * shared folder; the CLI answers with `result`. When a call needs the
 * developer's approval the CLI says so with `permission_required`, the panel
 * renders the card, and the platform answers with `permission`.
 *
 * Every frame is JSON text with a `type` and the protocol version. The CLI
 * keeps a copy of these shapes in `sdks/typescript/src/agent/local-control-protocol.ts`;
 * a drift test on its side pins them to this file. Browser-safe: zod and
 * nothing else.
 */

import { z } from "zod";

export const LOCAL_CONTROL_PROTOCOL_VERSION = 1;

const versioned = z.object({
  protocol: z.literal(LOCAL_CONTROL_PROTOCOL_VERSION),
});

/** The tools Langy has on the developer's machine, in the order the worker lists them. */
export const LOCAL_TOOL_NAMES = [
  "local_read",
  "local_write",
  "local_edit",
  "local_bash",
  "local_grep",
  "local_find",
  "local_ls",
] as const;
export type LocalToolName = (typeof LOCAL_TOOL_NAMES)[number];

/**
 * Tool parameters mirror the pi built-ins they stand in for, name for name,
 * so the model carries one habit across both. Paths are relative to the
 * shared folder or absolute inside it; the CLI refuses anything else.
 */
export const localReadParamsSchema = z.object({
  path: z.string().min(1).max(4096),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});

export const localWriteParamsSchema = z.object({
  path: z.string().min(1).max(4096),
  content: z.string(),
});

export const localEditReplaceSchema = z.object({
  oldText: z.string().min(1),
  newText: z.string(),
});

export const localEditParamsSchema = z.object({
  path: z.string().min(1).max(4096),
  edits: z.array(localEditReplaceSchema).min(1).max(200),
});

export const localBashParamsSchema = z.object({
  command: z.string().min(1).max(20_000),
  /** Seconds. Capped by the CLI at its maximum. */
  timeout: z.number().int().positive().optional(),
  /** Return at once with the process id and the log path. */
  background: z.boolean().optional(),
});

export const localGrepParamsSchema = z.object({
  pattern: z.string().min(1).max(2000),
  path: z.string().max(4096).optional(),
  glob: z.string().max(500).optional(),
  ignoreCase: z.boolean().optional(),
  literal: z.boolean().optional(),
  context: z.number().int().nonnegative().max(50).optional(),
  limit: z.number().int().positive().max(5000).optional(),
});

export const localFindParamsSchema = z.object({
  pattern: z.string().min(1).max(500),
  path: z.string().max(4096).optional(),
  limit: z.number().int().positive().max(20_000).optional(),
});

export const localLsParamsSchema = z.object({
  path: z.string().max(4096).optional(),
  limit: z.number().int().positive().max(20_000).optional(),
});

export const localToolCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("local_read"), params: localReadParamsSchema }),
  z.object({ tool: z.literal("local_write"), params: localWriteParamsSchema }),
  z.object({ tool: z.literal("local_edit"), params: localEditParamsSchema }),
  z.object({ tool: z.literal("local_bash"), params: localBashParamsSchema }),
  z.object({ tool: z.literal("local_grep"), params: localGrepParamsSchema }),
  z.object({ tool: z.literal("local_find"), params: localFindParamsSchema }),
  z.object({ tool: z.literal("local_ls"), params: localLsParamsSchema }),
]);
export type LocalToolCall = z.infer<typeof localToolCallSchema>;

/**
 * What the CLI knows about the folder at register time, so the skill does
 * not spend a turn probing. Everything past `root` is best effort.
 */
export const workspaceInfoSchema = z.object({
  /** The resolved real path of the shared folder. */
  root: z.string().min(1).max(4096),
  /** The last path segment, what the chip shows. */
  name: z.string().min(1).max(255),
  gitBranch: z.string().max(255).optional(),
  gitRemote: z.string().max(2048).optional(),
  gitDirty: z.boolean().optional(),
  os: z.string().max(64),
  nodeVersion: z.string().max(64).optional(),
  pythonVersion: z.string().max(64).optional(),
  ghAuthenticated: z.boolean().optional(),
  packageManager: z.string().max(32).optional(),
});
export type WorkspaceInfo = z.infer<typeof workspaceInfoSchema>;

export const cliSchema = z.object({
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(64),
});

export const registerInstanceSchema = z.object({
  id: z.string().min(1).max(128),
  hostname: z.string().max(255),
  username: z.string().max(255),
  pid: z.number().int().nonnegative(),
  startedAt: z.string().max(64),
  /** Calls the CLI was working on when the socket dropped. */
  inFlightCallIds: z.array(z.string().max(128)).max(1000).default([]),
});

export const registerFrameSchema = versioned.extend({
  type: z.literal("register"),
  cli: cliSchema,
  instance: registerInstanceSchema,
  workspace: workspaceInfoSchema,
});
export type RegisterFrame = z.infer<typeof registerFrameSchema>;

export const registeredFrameSchema = versioned.extend({
  type: z.literal("registered"),
  instanceId: z.string(),
  heartbeatIntervalMs: z.number().int().positive(),
  conversation: z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
  }),
  /** The policy at connect time, so a reconnect keeps a skip the user chose. */
  policy: z.object({ skipPermissions: z.boolean() }),
});
export type RegisteredFrame = z.infer<typeof registeredFrameSchema>;

/** Why a connection was refused; the CLI prints these and exits. */
export const LOCAL_CONTROL_REFUSED_CODES = [
  "api_key_invalid",
  "key_type_not_allowed",
  "conversation_mismatch",
  "workspace_already_connected",
  "replica_count_unsupported",
  "protocol_invalid",
] as const;
export type LocalControlRefusedCode =
  (typeof LOCAL_CONTROL_REFUSED_CODES)[number];

export const refusedFrameSchema = versioned.extend({
  type: z.literal("refused"),
  code: z.enum(LOCAL_CONTROL_REFUSED_CODES),
  message: z.string(),
});
export type RefusedFrame = z.infer<typeof refusedFrameSchema>;

/** One tool call for the CLI to run in the folder. */
export const callEnvelopeSchema = z
  .object({
    callId: z.string(),
    conversationId: z.string(),
    turnId: z.string(),
    deadlineAt: z.number().int(),
  })
  .and(localToolCallSchema);
export type CallEnvelope = z.infer<typeof callEnvelopeSchema>;

export const callFrameSchema = versioned.extend({
  type: z.literal("call"),
  call: callEnvelopeSchema,
});
export type CallFrame = z.infer<typeof callFrameSchema>;

export const cancelFrameSchema = versioned.extend({
  type: z.literal("cancel"),
  callId: z.string(),
});
export type CancelFrame = z.infer<typeof cancelFrameSchema>;

export const ackFrameSchema = versioned.extend({
  type: z.literal("ack"),
  callId: z.string(),
});
export type AckFrame = z.infer<typeof ackFrameSchema>;

/**
 * Why the CLI did not run a call. The worker returns the message verbatim as
 * the tool result, so the model can act on it.
 */
export const LOCAL_CALL_ERROR_CODES = [
  "path_refused",
  "command_refused",
  "permission_denied",
  "permission_expired",
  "cancelled",
  "timeout",
  "exec_failed",
  "not_found",
] as const;
export type LocalCallErrorCode = (typeof LOCAL_CALL_ERROR_CODES)[number];

export const localCallErrorSchema = z.object({
  code: z.enum(LOCAL_CALL_ERROR_CODES),
  message: z.string().max(4000),
});

/** The output of a command, capped by the CLI; the rest is in `logPath`. */
export const bashOutputSchema = z.object({
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
  logPath: z.string().optional(),
  /** Set for a background command: the process the CLI started. */
  pid: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative(),
});

export const resultFrameSchema = versioned.extend({
  type: z.literal("result"),
  callId: z.string(),
  /** Tool output as text for the model; `bash` also carries `output`. */
  ok: z.boolean(),
  text: z.string().optional(),
  output: bashOutputSchema.optional(),
  error: localCallErrorSchema.optional(),
});
export type ResultFrame = z.infer<typeof resultFrameSchema>;

/**
 * The CLI needs the developer's answer before it runs the call. The panel
 * renders a card with these fields; the platform answers with `permission`.
 */
export const permissionRequiredFrameSchema = versioned.extend({
  type: z.literal("permission_required"),
  callId: z.string(),
  /** What the card shows as the thing to allow. */
  summary: z.string().max(4000),
  /** The pattern "allow for this session" would grant. */
  pattern: z.string().max(500),
  /** Why the call is not read-only, one short reason. */
  reason: z.string().max(500),
  /** True when the model may be offered the skip toggle on this card. */
  skipOffered: z.boolean(),
});
export type PermissionRequiredFrame = z.infer<
  typeof permissionRequiredFrameSchema
>;

export const PERMISSION_DECISIONS = [
  "allow_once",
  "allow_pattern",
  "deny",
  "expired",
] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

export const permissionFrameSchema = versioned.extend({
  type: z.literal("permission"),
  callId: z.string(),
  decision: z.enum(PERMISSION_DECISIONS),
});
export type PermissionFrame = z.infer<typeof permissionFrameSchema>;

/** The user turned permission checks on or off for this session. */
export const policyFrameSchema = versioned.extend({
  type: z.literal("policy"),
  skipPermissions: z.boolean(),
});
export type PolicyFrame = z.infer<typeof policyFrameSchema>;

export const deregisterFrameSchema = versioned.extend({
  type: z.literal("deregister"),
});

/** The platform closed the folder from the panel; the CLI exits. */
export const disconnectFrameSchema = versioned.extend({
  type: z.literal("disconnect"),
  reason: z.string().max(500),
});

export const cliFrameSchema = z.discriminatedUnion("type", [
  registerFrameSchema,
  ackFrameSchema,
  resultFrameSchema,
  permissionRequiredFrameSchema,
  deregisterFrameSchema,
]);
export type CliFrame = z.infer<typeof cliFrameSchema>;

export const platformFrameSchema = z.discriminatedUnion("type", [
  registeredFrameSchema,
  refusedFrameSchema,
  callFrameSchema,
  cancelFrameSchema,
  permissionFrameSchema,
  policyFrameSchema,
  disconnectFrameSchema,
]);
export type PlatformFrame = z.infer<typeof platformFrameSchema>;
