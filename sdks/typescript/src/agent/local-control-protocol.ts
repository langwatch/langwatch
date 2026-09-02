/**
 * The frames of the local control socket, as the CLI speaks them.
 *
 * `langwatch langy --share-control` opens this socket from the developer's
 * machine. Langy's local tools arrive as `call` frames the CLI runs in the
 * shared folder; the CLI answers with `result`. A call that needs the
 * developer's approval produces `permission_required`, the panel renders the
 * card, and the platform answers with `permission`.
 *
 * `platform/app/src/server/langy-local-control/protocol.ts` is the contract;
 * this file is the CLI's copy. The validators are small and hand-written for
 * the same reason `protocol.ts` next door has hand-written ones: no schema
 * library may cross into the published surface. A drift test in
 * `__tests__/local-control-protocol-drift.unit.test.ts` pins the two together.
 *
 * @see dev/docs/adr/129-langy-local-control.md
 */

export const LOCAL_CONTROL_PROTOCOL_VERSION = 1;

/** The tools Langy has on the developer's machine. */
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

// ---------------------------------------------------------------------------
// Budgets, copied from platform/app/src/server/langy-local-control/constants.ts
// ---------------------------------------------------------------------------

/** Command output returned to the model; the rest stays in the log file. */
export const BASH_OUTPUT_CAP_BYTES = 64 * 1024;

/** A command with no timeout of its own stops after this. */
export const BASH_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** The longest timeout a command may ask for. */
export const BASH_MAX_TIMEOUT_MS = 15 * 60 * 1000;

/** A CLI heartbeat refreshes presence at this interval. */
export const PRESENCE_HEARTBEAT_MS = 10_000;

/** Where the CLI keeps command logs inside the shared folder. */
export const LOCAL_LOG_DIR = ".langwatch/langy-logs";

// ---------------------------------------------------------------------------
// Tool parameters
// ---------------------------------------------------------------------------

export interface LocalReadParams {
  path: string;
  offset?: number;
  limit?: number;
}

export interface LocalWriteParams {
  path: string;
  content: string;
}

export interface LocalEditReplace {
  oldText: string;
  newText: string;
}

export interface LocalEditParams {
  path: string;
  edits: LocalEditReplace[];
}

export interface LocalBashParams {
  command: string;
  /** Seconds. Capped by the CLI at its maximum. */
  timeout?: number;
  /** Return at once with the process id and the log path. */
  background?: boolean;
}

export interface LocalGrepParams {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

export interface LocalFindParams {
  pattern: string;
  path?: string;
  limit?: number;
}

export interface LocalLsParams {
  path?: string;
  limit?: number;
}

export type LocalToolCall =
  | { tool: "local_read"; params: LocalReadParams }
  | { tool: "local_write"; params: LocalWriteParams }
  | { tool: "local_edit"; params: LocalEditParams }
  | { tool: "local_bash"; params: LocalBashParams }
  | { tool: "local_grep"; params: LocalGrepParams }
  | { tool: "local_find"; params: LocalFindParams }
  | { tool: "local_ls"; params: LocalLsParams };

// ---------------------------------------------------------------------------
// Frames the CLI sends
// ---------------------------------------------------------------------------

/**
 * What the CLI knows about the folder at register time, so the skill does not
 * spend a turn probing. Everything past `root` is best effort.
 */
export interface WorkspaceInfo {
  root: string;
  name: string;
  gitBranch?: string;
  gitRemote?: string;
  gitDirty?: boolean;
  os: string;
  nodeVersion?: string;
  pythonVersion?: string;
  ghAuthenticated?: boolean;
  packageManager?: string;
}

export interface LocalControlCli {
  name: string;
  version: string;
}

export interface LocalRegisterInstance {
  id: string;
  hostname: string;
  username: string;
  pid: number;
  startedAt: string;
  /** Calls the CLI was working on when the socket dropped. */
  inFlightCallIds: string[];
}

export interface LocalRegisterFrame {
  type: "register";
  protocol: typeof LOCAL_CONTROL_PROTOCOL_VERSION;
  cli: LocalControlCli;
  instance: LocalRegisterInstance;
  workspace: WorkspaceInfo;
}

export interface LocalAckFrame {
  type: "ack";
  protocol: typeof LOCAL_CONTROL_PROTOCOL_VERSION;
  callId: string;
}

/** Why the CLI did not run a call. The worker returns the message verbatim. */
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

export interface LocalCallError {
  code: LocalCallErrorCode;
  message: string;
}

/** The output of a command, capped by the CLI; the rest is in `logPath`. */
export interface BashOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  logPath?: string;
  /** Set for a background command: the process the CLI started. */
  pid?: number;
  durationMs: number;
}

export interface LocalResultFrame {
  type: "result";
  protocol: typeof LOCAL_CONTROL_PROTOCOL_VERSION;
  callId: string;
  ok: boolean;
  text?: string;
  output?: BashOutput;
  error?: LocalCallError;
}

export interface LocalPermissionRequiredFrame {
  type: "permission_required";
  protocol: typeof LOCAL_CONTROL_PROTOCOL_VERSION;
  callId: string;
  /** What the card shows as the thing to allow. */
  summary: string;
  /** The pattern "allow for this session" would grant. */
  pattern: string;
  /** Why the call is not read-only, one short reason. */
  reason: string;
  /** True when the model may be offered the skip toggle on this card. */
  skipOffered: boolean;
}

export interface LocalDeregisterFrame {
  type: "deregister";
  protocol: typeof LOCAL_CONTROL_PROTOCOL_VERSION;
}

/** Everything the CLI sends. */
export type LocalCliFrame =
  | LocalRegisterFrame
  | LocalAckFrame
  | LocalResultFrame
  | LocalPermissionRequiredFrame
  | LocalDeregisterFrame;

// ---------------------------------------------------------------------------
// Frames the platform sends
// ---------------------------------------------------------------------------

export interface LocalControlConversation {
  id: string;
  title: string;
  url: string;
}

export interface LocalRegisteredFrame {
  type: "registered";
  protocol: number;
  instanceId: string;
  heartbeatIntervalMs: number;
  conversation: LocalControlConversation;
  /** The policy at connect time, so a reconnect keeps a skip the user chose. */
  policy: { skipPermissions: boolean };
}

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

export interface LocalRefusedFrame {
  type: "refused";
  protocol: number;
  code: string;
  message: string;
}

export interface LocalCallEnvelope {
  callId: string;
  conversationId: string;
  turnId: string;
  deadlineAt: number;
}

export type LocalCall = LocalCallEnvelope & LocalToolCall;

export interface LocalCallFrame {
  type: "call";
  protocol: number;
  call: LocalCall;
}

export interface LocalCancelFrame {
  type: "cancel";
  protocol: number;
  callId: string;
}

export const PERMISSION_DECISIONS = [
  "allow_once",
  "allow_pattern",
  "deny",
  "expired",
] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

export interface LocalPermissionFrame {
  type: "permission";
  protocol: number;
  callId: string;
  decision: PermissionDecision;
}

/** The user turned permission checks on or off for this session. */
export interface LocalPolicyFrame {
  type: "policy";
  protocol: number;
  skipPermissions: boolean;
}

/** The platform closed the folder from the panel; the CLI exits. */
export interface LocalDisconnectFrame {
  type: "disconnect";
  protocol: number;
  reason: string;
}

/** Everything the platform sends. */
export type LocalPlatformFrame =
  | LocalRegisteredFrame
  | LocalRefusedFrame
  | LocalCallFrame
  | LocalCancelFrame
  | LocalPermissionFrame
  | LocalPolicyFrame
  | LocalDisconnectFrame;

// ---------------------------------------------------------------------------
// Reading and writing frames
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const protocolOf = (frame: Record<string, unknown>): number =>
  isNumber(frame.protocol) ? frame.protocol : LOCAL_CONTROL_PROTOCOL_VERSION;

const readString = (value: unknown, fallback: string): string =>
  isString(value) ? value : fallback;

const readRegistered = (
  frame: Record<string, unknown>,
): LocalRegisteredFrame | null => {
  if (!isString(frame.instanceId)) return null;
  const conversation = isRecord(frame.conversation) ? frame.conversation : {};
  const policy = isRecord(frame.policy) ? frame.policy : {};
  return {
    type: "registered",
    protocol: protocolOf(frame),
    instanceId: frame.instanceId,
    heartbeatIntervalMs: isNumber(frame.heartbeatIntervalMs)
      ? frame.heartbeatIntervalMs
      : PRESENCE_HEARTBEAT_MS,
    conversation: {
      id: readString(conversation.id, ""),
      title: readString(conversation.title, ""),
      url: readString(conversation.url, ""),
    },
    policy: { skipPermissions: policy.skipPermissions === true },
  };
};

/** The tool call inside a `call` frame, or null when the tool is unknown. */
const readToolCall = (value: Record<string, unknown>): LocalToolCall | null => {
  const params = isRecord(value.params) ? value.params : null;
  if (!params) return null;
  switch (value.tool) {
    case "local_read":
      if (!isString(params.path)) return null;
      return {
        tool: "local_read",
        params: {
          path: params.path,
          ...(isNumber(params.offset) ? { offset: params.offset } : {}),
          ...(isNumber(params.limit) ? { limit: params.limit } : {}),
        },
      };
    case "local_write":
      if (!isString(params.path) || !isString(params.content)) return null;
      return {
        tool: "local_write",
        params: { path: params.path, content: params.content },
      };
    case "local_edit": {
      if (!isString(params.path) || !Array.isArray(params.edits)) return null;
      const edits: LocalEditReplace[] = [];
      for (const entry of params.edits) {
        if (!isRecord(entry) || !isString(entry.oldText)) return null;
        edits.push({
          oldText: entry.oldText,
          newText: readString(entry.newText, ""),
        });
      }
      return { tool: "local_edit", params: { path: params.path, edits } };
    }
    case "local_bash":
      if (!isString(params.command)) return null;
      return {
        tool: "local_bash",
        params: {
          command: params.command,
          ...(isNumber(params.timeout) ? { timeout: params.timeout } : {}),
          ...(params.background === true ? { background: true } : {}),
        },
      };
    case "local_grep":
      if (!isString(params.pattern)) return null;
      return {
        tool: "local_grep",
        params: {
          pattern: params.pattern,
          ...(isString(params.path) ? { path: params.path } : {}),
          ...(isString(params.glob) ? { glob: params.glob } : {}),
          ...(params.ignoreCase === true ? { ignoreCase: true } : {}),
          ...(params.literal === true ? { literal: true } : {}),
          ...(isNumber(params.context) ? { context: params.context } : {}),
          ...(isNumber(params.limit) ? { limit: params.limit } : {}),
        },
      };
    case "local_find":
      if (!isString(params.pattern)) return null;
      return {
        tool: "local_find",
        params: {
          pattern: params.pattern,
          ...(isString(params.path) ? { path: params.path } : {}),
          ...(isNumber(params.limit) ? { limit: params.limit } : {}),
        },
      };
    case "local_ls":
      return {
        tool: "local_ls",
        params: {
          ...(isString(params.path) ? { path: params.path } : {}),
          ...(isNumber(params.limit) ? { limit: params.limit } : {}),
        },
      };
    default:
      return null;
  }
};

const readCall = (frame: Record<string, unknown>): LocalCallFrame | null => {
  const call = isRecord(frame.call) ? frame.call : null;
  if (!call || !isString(call.callId)) return null;
  const tool = readToolCall(call);
  if (!tool) return null;
  return {
    type: "call",
    protocol: protocolOf(frame),
    call: {
      callId: call.callId,
      conversationId: readString(call.conversationId, ""),
      turnId: readString(call.turnId, ""),
      deadlineAt: isNumber(call.deadlineAt) ? call.deadlineAt : 0,
      ...tool,
    },
  };
};

const isDecision = (value: unknown): value is PermissionDecision =>
  isString(value) &&
  (PERMISSION_DECISIONS as readonly string[]).includes(value);

/**
 * Reads one text message from the platform into a typed frame, or null when
 * the message is not a frame this protocol version knows. Unknown types and
 * malformed frames are dropped rather than thrown, so a newer platform never
 * crashes an older CLI.
 */
export function parsePlatformFrame(raw: string): LocalPlatformFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isString(parsed.type)) return null;
  switch (parsed.type) {
    case "registered":
      return readRegistered(parsed);
    case "refused":
      return {
        type: "refused",
        protocol: protocolOf(parsed),
        code: readString(parsed.code, "protocol_invalid"),
        message: readString(
          parsed.message,
          "LangWatch refused the connection.",
        ),
      };
    case "call":
      return readCall(parsed);
    case "cancel":
      return isString(parsed.callId)
        ? { type: "cancel", protocol: protocolOf(parsed), callId: parsed.callId }
        : null;
    case "permission":
      return isString(parsed.callId) && isDecision(parsed.decision)
        ? {
            type: "permission",
            protocol: protocolOf(parsed),
            callId: parsed.callId,
            decision: parsed.decision,
          }
        : null;
    case "policy":
      return {
        type: "policy",
        protocol: protocolOf(parsed),
        skipPermissions: parsed.skipPermissions === true,
      };
    case "disconnect":
      return {
        type: "disconnect",
        protocol: protocolOf(parsed),
        reason: readString(parsed.reason, "LangWatch closed the folder."),
      };
    default:
      return null;
  }
}

/** One frame as the text the socket carries. */
export function serializeLocalFrame(frame: LocalCliFrame): string {
  return JSON.stringify(frame);
}

/** The one line a refusal produces: what went wrong and what fixes it. */
export function localRefusalAdvice(frame: LocalRefusedFrame): string {
  switch (frame.code) {
    case "api_key_invalid":
      return "the session key is not valid any more. Run the command again and approve a fresh request.";
    case "key_type_not_allowed":
      return "this key cannot share a folder. Approve the request in the terminal so the CLI gets a Langy session key.";
    case "conversation_mismatch":
      return "the session key belongs to another conversation. Approve the request the conversation shows.";
    case "workspace_already_connected":
      return `${frame.message} Disconnect the other folder from the panel first.`;
    case "replica_count_unsupported":
      return `${frame.message} Sharing a folder on a LangWatch deployment without Redis needs one app replica.`;
    case "protocol_invalid":
      return `${frame.message} Update the langwatch package to a version that speaks local control protocol ${LOCAL_CONTROL_PROTOCOL_VERSION} or later.`;
    default:
      return `${frame.message} (${frame.code})`;
  }
}
