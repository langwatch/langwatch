/**
 * The frames of the local control socket (ADR-129). CLI keeps a copy in
 * `sdks/typescript/src/agent/local-control-protocol.ts`, pinned to this file
 * by a drift test. Browser-safe: zod only.
 */

import type { Named } from "@langwatch/module";
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
  "local_langwatch_env",
] as const;
export type LocalToolName = (typeof LOCAL_TOOL_NAMES)[number];

/**
 * Tool parameters mirror the pi built-ins they stand in for, name for name,
 * so the model carries one habit across both. Paths are relative to the
 * shared folder or absolute inside it; the CLI refuses anything else.
 */
const localReadParamsSchemaDefinition = z.object({
  path: z.string().min(1).max(4096),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});
export interface LocalReadParamsSchema extends Named<typeof localReadParamsSchemaDefinition> {}
export const localReadParamsSchema: LocalReadParamsSchema = localReadParamsSchemaDefinition;

const localWriteParamsSchemaDefinition = z.object({
  path: z.string().min(1).max(4096),
  content: z.string(),
});
export interface LocalWriteParamsSchema extends Named<typeof localWriteParamsSchemaDefinition> {}
export const localWriteParamsSchema: LocalWriteParamsSchema = localWriteParamsSchemaDefinition;

/**
 * One edit: either a replacement of text the file already holds, or text
 * appended at the end of the file, which is how a line is added without an
 * anchor (an empty `oldText` is refused).
 */
const localEditReplaceSchemaDefinition = z.union([
  z.object({
    oldText: z.string().min(1),
    newText: z.string(),
  }),
  z.object({
    append: z.string().min(1),
  }),
]);
export interface LocalEditReplaceSchema extends Named<typeof localEditReplaceSchemaDefinition> {}
export const localEditReplaceSchema: LocalEditReplaceSchema = localEditReplaceSchemaDefinition;

const localEditParamsSchemaDefinition = z.object({
  path: z.string().min(1).max(4096),
  edits: z.array(localEditReplaceSchema).min(1).max(200),
});
export interface LocalEditParamsSchema extends Named<typeof localEditParamsSchemaDefinition> {}
export const localEditParamsSchema: LocalEditParamsSchema = localEditParamsSchemaDefinition;

const localBashParamsSchemaDefinition = z.object({
  command: z.string().min(1).max(20_000),
  /** Seconds. Capped by the CLI at its maximum. */
  timeout: z.number().int().positive().optional(),
  /** Return at once with the process id and the log path. */
  background: z.boolean().optional(),
});
export interface LocalBashParamsSchema extends Named<typeof localBashParamsSchemaDefinition> {}
export const localBashParamsSchema: LocalBashParamsSchema = localBashParamsSchemaDefinition;

const localGrepParamsSchemaDefinition = z.object({
  pattern: z.string().min(1).max(2000),
  path: z.string().max(4096).optional(),
  glob: z.string().max(500).optional(),
  ignoreCase: z.boolean().optional(),
  literal: z.boolean().optional(),
  context: z.number().int().nonnegative().max(50).optional(),
  limit: z.number().int().positive().max(5000).optional(),
});
export interface LocalGrepParamsSchema extends Named<typeof localGrepParamsSchemaDefinition> {}
export const localGrepParamsSchema: LocalGrepParamsSchema = localGrepParamsSchemaDefinition;

const localFindParamsSchemaDefinition = z.object({
  pattern: z.string().min(1).max(500),
  path: z.string().max(4096).optional(),
  limit: z.number().int().positive().max(20_000).optional(),
});
export interface LocalFindParamsSchema extends Named<typeof localFindParamsSchemaDefinition> {}
export const localFindParamsSchema: LocalFindParamsSchema = localFindParamsSchemaDefinition;

const localLsParamsSchemaDefinition = z.object({
  path: z.string().max(4096).optional(),
  limit: z.number().int().positive().max(20_000).optional(),
});
export interface LocalLsParamsSchema extends Named<typeof localLsParamsSchemaDefinition> {}
export const localLsParamsSchema: LocalLsParamsSchema = localLsParamsSchemaDefinition;

/**
 * The CLI fetches the project's ingest key with the developer's own login and writes
 * LANGWATCH_API_KEY and LANGWATCH_ENDPOINT into the env file the app loads. The key stays on the
 * machine: it never appears in the call, the result or the transcript.
 */
const localLangwatchEnvParamsSchemaDefinition = z.object({
  /** Relative to the shared folder; the app's `.env` when omitted. */
  path: z.string().min(1).max(4096).optional(),
});
export interface LocalLangwatchEnvParamsSchema extends Named<
  typeof localLangwatchEnvParamsSchemaDefinition
> {}
export const localLangwatchEnvParamsSchema: LocalLangwatchEnvParamsSchema =
  localLangwatchEnvParamsSchemaDefinition;

const localToolCallSchemaDefinition = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("local_read"), params: localReadParamsSchema }),
  z.object({ tool: z.literal("local_write"), params: localWriteParamsSchema }),
  z.object({ tool: z.literal("local_edit"), params: localEditParamsSchema }),
  z.object({ tool: z.literal("local_bash"), params: localBashParamsSchema }),
  z.object({ tool: z.literal("local_grep"), params: localGrepParamsSchema }),
  z.object({ tool: z.literal("local_find"), params: localFindParamsSchema }),
  z.object({ tool: z.literal("local_ls"), params: localLsParamsSchema }),
  z.object({
    tool: z.literal("local_langwatch_env"),
    params: localLangwatchEnvParamsSchema,
  }),
]);
export interface LocalToolCallSchema extends Named<typeof localToolCallSchemaDefinition> {}
export const localToolCallSchema: LocalToolCallSchema = localToolCallSchemaDefinition;
export type LocalToolCall = z.infer<typeof localToolCallSchema>;

/**
 * What the CLI knows about the folder at register time, so the skill does
 * not spend a turn probing. Everything past `root` is best effort.
 */
const workspaceInfoSchemaDefinition = z.object({
  /** The resolved real path of the shared folder. */
  root: z.string().min(1).max(4096),
  /** The last path segment, what the chip shows. */
  name: z.string().min(1).max(255),
  /**
   * False when the folder is not a git repository, so the branch, remote and
   * dirty facts do not apply; absent when git itself could not be run.
   */
  gitRepository: z.boolean().optional(),
  gitBranch: z.string().max(255).optional(),
  gitRemote: z.string().max(2048).optional(),
  gitDirty: z.boolean().optional(),
  os: z.string().max(64),
  nodeVersion: z.string().max(64).optional(),
  pythonVersion: z.string().max(64).optional(),
  ghAuthenticated: z.boolean().optional(),
  packageManager: z.string().max(32).optional(),
});
export interface WorkspaceInfoSchema extends Named<typeof workspaceInfoSchemaDefinition> {}
export const workspaceInfoSchema: WorkspaceInfoSchema = workspaceInfoSchemaDefinition;
export type WorkspaceInfo = z.infer<typeof workspaceInfoSchema>;

const cliSchemaDefinition = z.object({
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(64),
});
export interface CliSchema extends Named<typeof cliSchemaDefinition> {}
export const cliSchema: CliSchema = cliSchemaDefinition;

const registerInstanceSchemaDefinition = z.object({
  id: z.string().min(1).max(128),
  hostname: z.string().max(255),
  username: z.string().max(255),
  pid: z.number().int().nonnegative(),
  startedAt: z.string().max(64),
  /** Calls the CLI was working on when the socket dropped. */
  inFlightCallIds: z.array(z.string().max(128)).max(1000).default([]),
});
export interface RegisterInstanceSchema extends Named<typeof registerInstanceSchemaDefinition> {}
export const registerInstanceSchema: RegisterInstanceSchema = registerInstanceSchemaDefinition;

const registerFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("register"),
  cli: cliSchema,
  instance: registerInstanceSchema,
  workspace: workspaceInfoSchema,
});
export interface RegisterFrameSchema extends Named<typeof registerFrameSchemaDefinition> {}
export const registerFrameSchema: RegisterFrameSchema = registerFrameSchemaDefinition;
export type RegisterFrame = z.infer<typeof registerFrameSchema>;

const registeredFrameSchemaDefinition = z.object({
  ...versioned.shape,
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
export interface RegisteredFrameSchema extends Named<typeof registeredFrameSchemaDefinition> {}
export const registeredFrameSchema: RegisteredFrameSchema = registeredFrameSchemaDefinition;
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
export type LocalControlRefusedCode = (typeof LOCAL_CONTROL_REFUSED_CODES)[number];

const refusedFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("refused"),
  code: z.enum(LOCAL_CONTROL_REFUSED_CODES),
  message: z.string(),
});
export interface RefusedFrameSchema extends Named<typeof refusedFrameSchemaDefinition> {}
export const refusedFrameSchema: RefusedFrameSchema = refusedFrameSchemaDefinition;
export type RefusedFrame = z.infer<typeof refusedFrameSchema>;

/** One tool call for the CLI to run in the folder. */
const callEnvelopeSchemaDefinition = z
  .object({
    callId: z.string(),
    conversationId: z.string(),
    turnId: z.string(),
    deadlineAt: z.number().int(),
  })
  .and(localToolCallSchema);
export interface CallEnvelopeSchema extends Named<typeof callEnvelopeSchemaDefinition> {}
export const callEnvelopeSchema: CallEnvelopeSchema = callEnvelopeSchemaDefinition;
export type CallEnvelope = z.infer<typeof callEnvelopeSchema>;

const callFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("call"),
  call: callEnvelopeSchema,
});
export interface CallFrameSchema extends Named<typeof callFrameSchemaDefinition> {}
export const callFrameSchema: CallFrameSchema = callFrameSchemaDefinition;
export type CallFrame = z.infer<typeof callFrameSchema>;

const cancelFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("cancel"),
  callId: z.string(),
});
export interface CancelFrameSchema extends Named<typeof cancelFrameSchemaDefinition> {}
export const cancelFrameSchema: CancelFrameSchema = cancelFrameSchemaDefinition;
export type CancelFrame = z.infer<typeof cancelFrameSchema>;

const ackFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("ack"),
  callId: z.string(),
});
export interface AckFrameSchema extends Named<typeof ackFrameSchemaDefinition> {}
export const ackFrameSchema: AckFrameSchema = ackFrameSchemaDefinition;
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
  "key_refused",
] as const;
export type LocalCallErrorCode = (typeof LOCAL_CALL_ERROR_CODES)[number];

const localCallErrorSchemaDefinition = z.object({
  code: z.enum(LOCAL_CALL_ERROR_CODES),
  message: z.string().max(4000),
});
export interface LocalCallErrorSchema extends Named<typeof localCallErrorSchemaDefinition> {}
export const localCallErrorSchema: LocalCallErrorSchema = localCallErrorSchemaDefinition;

/** The output of a command, capped by the CLI; the rest is in `logPath`. */
const bashOutputSchemaDefinition = z.object({
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
  logPath: z.string().optional(),
  /** Set for a background command: the process the CLI started. */
  pid: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative(),
});
export interface BashOutputSchema extends Named<typeof bashOutputSchemaDefinition> {}
export const bashOutputSchema: BashOutputSchema = bashOutputSchemaDefinition;

const resultFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("result"),
  callId: z.string(),
  /** Tool output as text for the model; `bash` also carries `output`. */
  ok: z.boolean(),
  text: z.string().optional(),
  output: bashOutputSchema.optional(),
  error: localCallErrorSchema.optional(),
});
export interface ResultFrameSchema extends Named<typeof resultFrameSchemaDefinition> {}
export const resultFrameSchema: ResultFrameSchema = resultFrameSchemaDefinition;
export type ResultFrame = z.infer<typeof resultFrameSchema>;

/**
 * One segment of a shell command chain, as the card lists it. Segments
 * travel with the ask so "allow this pattern" covers exactly the
 * non-read-only ones.
 */
const commandSegmentSchemaDefinition = z.object({
  /** The segment as the developer wrote it. */
  command: z.string().max(4000),
  /** The pattern a session grant for this segment would carry. */
  pattern: z.string().max(500),
  /** True when the segment runs on its own, so the answer is not about it. */
  readOnly: z.boolean(),
});
export interface CommandSegmentSchema extends Named<typeof commandSegmentSchemaDefinition> {}
export const commandSegmentSchema: CommandSegmentSchema = commandSegmentSchemaDefinition;
export type CommandSegment = z.infer<typeof commandSegmentSchema>;

/**
 * The CLI needs the developer's answer before it runs the call. The panel
 * renders a card with these fields; the platform answers with `permission`.
 */
const permissionRequiredFrameSchemaDefinition = z.object({
  ...versioned.shape,
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
  /** Set for a command: every segment of the chain, in the order it runs. */
  segments: z.array(commandSegmentSchema).max(50).optional(),
  /**
   * The seconds after which the command is stopped, so the card can name the
   * limit before the reader allows it. Absent for a call that runs under none,
   * and absent from a command line that predates the field.
   */
  timeoutSeconds: z.number().int().positive().max(3600).optional(),
});
export interface PermissionRequiredFrameSchema extends Named<
  typeof permissionRequiredFrameSchemaDefinition
> {}
export const permissionRequiredFrameSchema: PermissionRequiredFrameSchema =
  permissionRequiredFrameSchemaDefinition;
export type PermissionRequiredFrame = z.infer<typeof permissionRequiredFrameSchema>;

/**
 * The developer answered a permission ask in the terminal. The platform settles
 * the wait from it unless the card answered first, in which case it is ignored:
 * the `permission` frame for that answer is already on its way.
 */
const permissionAnsweredFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("permission_answered"),
  callId: z.string(),
  decision: z.enum(["allow_once", "allow_pattern", "deny"]),
  /** The patterns the session grant covers, when the decision is allow_pattern. */
  patterns: z.array(z.string().max(500)).max(50).optional(),
});
export interface PermissionAnsweredFrameSchema extends Named<
  typeof permissionAnsweredFrameSchemaDefinition
> {}
export const permissionAnsweredFrameSchema: PermissionAnsweredFrameSchema =
  permissionAnsweredFrameSchemaDefinition;
export type PermissionAnsweredFrame = z.infer<typeof permissionAnsweredFrameSchema>;

export const PERMISSION_DECISIONS = ["allow_once", "allow_pattern", "deny", "expired"] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

const permissionFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("permission"),
  callId: z.string(),
  decision: z.enum(PERMISSION_DECISIONS),
});
export interface PermissionFrameSchema extends Named<typeof permissionFrameSchemaDefinition> {}
export const permissionFrameSchema: PermissionFrameSchema = permissionFrameSchemaDefinition;
export type PermissionFrame = z.infer<typeof permissionFrameSchema>;

/** The user turned permission checks on or off for this session. */
const policyFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("policy"),
  skipPermissions: z.boolean(),
});
export interface PolicyFrameSchema extends Named<typeof policyFrameSchemaDefinition> {}
export const policyFrameSchema: PolicyFrameSchema = policyFrameSchemaDefinition;
export type PolicyFrame = z.infer<typeof policyFrameSchema>;

const deregisterFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("deregister"),
});
export interface DeregisterFrameSchema extends Named<typeof deregisterFrameSchemaDefinition> {}
export const deregisterFrameSchema: DeregisterFrameSchema = deregisterFrameSchemaDefinition;

/** The platform closed the folder from the panel; the CLI exits. */
const disconnectFrameSchemaDefinition = z.object({
  ...versioned.shape,
  type: z.literal("disconnect"),
  reason: z.string().max(500),
});
export interface DisconnectFrameSchema extends Named<typeof disconnectFrameSchemaDefinition> {}
export const disconnectFrameSchema: DisconnectFrameSchema = disconnectFrameSchemaDefinition;

const cliFrameSchemaDefinition = z.discriminatedUnion("type", [
  registerFrameSchema,
  ackFrameSchema,
  resultFrameSchema,
  permissionRequiredFrameSchema,
  permissionAnsweredFrameSchema,
  deregisterFrameSchema,
]);
export interface CliFrameSchema extends Named<typeof cliFrameSchemaDefinition> {}
export const cliFrameSchema: CliFrameSchema = cliFrameSchemaDefinition;
export type CliFrame = z.infer<typeof cliFrameSchema>;

const platformFrameSchemaDefinition = z.discriminatedUnion("type", [
  registeredFrameSchema,
  refusedFrameSchema,
  callFrameSchema,
  cancelFrameSchema,
  permissionFrameSchema,
  policyFrameSchema,
  disconnectFrameSchema,
]);
export interface PlatformFrameSchema extends Named<typeof platformFrameSchemaDefinition> {}
export const platformFrameSchema: PlatformFrameSchema = platformFrameSchemaDefinition;
export type PlatformFrame = z.infer<typeof platformFrameSchema>;

/** What langy's session key door resolves for a minted key: its owner and its conversation. */
const localControlCredentialSchemaDefinition = z.object({
  apiKeyId: z.string(),
  projectId: z.string(),
  /** The project's own address segment, so the follow along link names it. */
  projectSlug: z.string(),
  userId: z.string(),
  conversationId: z.string(),
  requestId: z.string(),
});
export interface LocalControlCredentialSchema extends Named<
  typeof localControlCredentialSchemaDefinition
> {}
export const localControlCredentialSchema: LocalControlCredentialSchema =
  localControlCredentialSchemaDefinition;
export type LocalControlCredential = z.infer<typeof localControlCredentialSchema>;
