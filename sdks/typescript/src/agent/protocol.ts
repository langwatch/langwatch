/**
 * Frames exchanged over the agent socket; shapes match ADR-128.
 * @see dev/docs/adr/128-connected-agents.md
 */

export const PROTOCOL_VERSION = 1;

/** One conversation message, OpenAI style. Extra keys are carried as is. */
export interface AgentMessage {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

/** The value of one run parameter as the platform sends it. */
export type AgentParameterValue = string | number | boolean;

/** A JSON Schema object as the SDK sends it in `register`. */
export type JsonSchemaObject = Record<string, unknown>;

export interface RegisterSdk {
  name: string;
  version: string;
  language: string;
}

export interface RegisterInstance {
  id: string;
  hostname: string;
  username: string;
  pid: number;
  startedAt: string;
  label?: string;
  inFlightCallIds: string[];
}

export interface RegisterAgent {
  name: string;
  environment: string;
  parameters: JsonSchemaObject;
  concurrency?: number;
  timeoutMs?: number;
  sticky?: boolean;
}

export interface RegisterFrame {
  type: "register";
  protocol: typeof PROTOCOL_VERSION;
  sdk: RegisterSdk;
  instance: RegisterInstance;
  agents: RegisterAgent[];
}

export interface AckFrame {
  type: "ack";
  protocol: typeof PROTOCOL_VERSION;
  callId: string;
}

export interface CallError {
  code: string;
  message: string;
}

export type ResultFrame =
  | {
      type: "result";
      protocol: typeof PROTOCOL_VERSION;
      callId: string;
      output: unknown;
      session?: unknown;
    }
  | {
      type: "result";
      protocol: typeof PROTOCOL_VERSION;
      callId: string;
      error: CallError;
    };

export interface DeregisterFrame {
  type: "deregister";
  protocol: typeof PROTOCOL_VERSION;
}

/** Everything the SDK sends. */
export type ClientFrame = RegisterFrame | AckFrame | ResultFrame | DeregisterFrame;

/**
 * Who can target the agent: everyone, the owner of the registering key, or
 * the project through this machine.
 */
export type RegisteredAgentScope =
  | { kind: "shared" }
  | { kind: "owner" }
  | { kind: "host"; hostLabel: string };

export interface RegisteredAgent {
  name: string;
  environment: string;
  id: string;
  url: string;
  parameterNotes: string[];
  scope: RegisteredAgentScope;
}

export interface RegisteredFrame {
  type: "registered";
  protocol: number;
  agents: RegisteredAgent[];
  heartbeatIntervalMs: number;
  instanceId: string;
}

export interface RefusedFrame {
  type: "refused";
  protocol: number;
  code: string;
  message: string;
  /** Extra data for one code, for example the projects a key reaches under `project_required`. */
  meta?: Record<string, unknown>;
}

export interface CallRun {
  scenarioRunId?: string;
  scenarioName?: string;
  batchRunId?: string;
}

export interface CallFrame {
  type: "call";
  protocol: number;
  callId: string;
  agentId: string;
  threadId: string;
  messages: AgentMessage[];
  newMessages: AgentMessage[];
  params: Record<string, AgentParameterValue>;
  session: unknown;
  traceparent: string | null;
  /** Epoch milliseconds, null when the platform sent none. */
  deadlineAt: number | null;
  run: CallRun;
}

export interface CancelFrame {
  type: "cancel";
  protocol: number;
  callId: string;
}

/** Everything the platform sends. */
export type ServerFrame = RegisteredFrame | RefusedFrame | CallFrame | CancelFrame;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const isMessageList = (value: unknown): value is AgentMessage[] =>
  Array.isArray(value) && value.every((item) => isRecord(item) && isString(item.role));

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

/** A platform that predates the scope field registers everything as shared. */
const readScope = (value: unknown): RegisteredAgentScope => {
  if (!isRecord(value)) return { kind: "shared" };
  if (value.kind === "owner") return { kind: "owner" };
  if (value.kind === "host" && isString(value.hostLabel))
    return { kind: "host", hostLabel: value.hostLabel };
  return { kind: "shared" };
};

/** One agent of a registered frame, or null when the entry is malformed. */
const readRegisteredAgent = (entry: unknown): RegisteredAgent | null => {
  if (!isRecord(entry)) return null;
  if (!isString(entry.name)) return null;
  let id: string | null = null;
  if (isString(entry.id)) {
    id = entry.id;
  } else if (isString(entry.agentId)) {
    id = entry.agentId;
  }
  if (id === null) return null;
  return {
    name: entry.name,
    environment: isString(entry.environment) ? entry.environment : "",
    id,
    url: isString(entry.url) ? entry.url : "",
    parameterNotes: isStringList(entry.parameterNotes) ? entry.parameterNotes : [],
    scope: readScope(entry.scope),
  };
};

const readRegistered = (frame: Record<string, unknown>): RegisteredFrame | null => {
  if (!Array.isArray(frame.agents)) return null;
  if (!isString(frame.instanceId)) return null;
  const agents: RegisteredAgent[] = [];
  for (const entry of frame.agents) {
    const agent = readRegisteredAgent(entry);
    if (agent === null) return null;
    agents.push(agent);
  }
  return {
    type: "registered",
    protocol: typeof frame.protocol === "number" ? frame.protocol : PROTOCOL_VERSION,
    agents,
    heartbeatIntervalMs:
      typeof frame.heartbeatIntervalMs === "number" ? frame.heartbeatIntervalMs : 10_000,
    instanceId: frame.instanceId,
  };
};

const readRefused = (frame: Record<string, unknown>): RefusedFrame => ({
  type: "refused",
  protocol: typeof frame.protocol === "number" ? frame.protocol : PROTOCOL_VERSION,
  code: isString(frame.code) ? frame.code : "agent_register_refused",
  message: isString(frame.message) ? frame.message : "The platform refused the registration.",
  ...(isRecord(frame.meta) ? { meta: frame.meta } : {}),
});

const readParams = (value: unknown): Record<string, AgentParameterValue> => {
  if (!isRecord(value)) return {};
  const params: Record<string, AgentParameterValue> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      params[name] = item;
    }
  }
  return params;
};

/** A deadline as epoch milliseconds, from a number or an ISO string. */
const readDeadline = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isString(value)) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const readCall = (frame: Record<string, unknown>): CallFrame | null => {
  if (!isString(frame.callId)) return null;
  if (!isString(frame.agentId)) return null;
  const messages = isMessageList(frame.messages) ? frame.messages : [];
  const run = isRecord(frame.run) ? frame.run : {};
  return {
    type: "call",
    protocol: typeof frame.protocol === "number" ? frame.protocol : PROTOCOL_VERSION,
    callId: frame.callId,
    agentId: frame.agentId,
    threadId: isString(frame.threadId) ? frame.threadId : "",
    messages,
    newMessages: isMessageList(frame.newMessages) ? frame.newMessages : messages,
    params: readParams(frame.params),
    session: frame.session === undefined ? null : frame.session,
    traceparent: isString(frame.traceparent) ? frame.traceparent : null,
    deadlineAt: readDeadline(frame.deadlineAt),
    run: {
      ...(isString(run.scenarioRunId) ? { scenarioRunId: run.scenarioRunId } : {}),
      ...(isString(run.scenarioName) ? { scenarioName: run.scenarioName } : {}),
      ...(isString(run.batchRunId) ? { batchRunId: run.batchRunId } : {}),
    },
  };
};

/**
 * Reads one text message into a typed frame, or null when this protocol
 * version doesn't know it. Unknown/malformed frames are dropped, not thrown,
 * so a newer platform never crashes an older SDK.
 */
export function parseServerFrame(raw: string): ServerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!isString(parsed.type)) return null;
  switch (parsed.type) {
    case "registered":
      return readRegistered(parsed);
    case "refused":
      return readRefused(parsed);
    case "call":
      return readCall(parsed);
    case "cancel":
      return isString(parsed.callId)
        ? {
            type: "cancel",
            protocol: typeof parsed.protocol === "number" ? parsed.protocol : PROTOCOL_VERSION,
            callId: parsed.callId,
          }
        : null;
    default:
      return null;
  }
}

/** One frame as the text the socket carries. */
export function serializeFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}

/** The trace id of a W3C traceparent header, or null when it does not parse. */
export function traceIdFromTraceparent(traceparent: string | null | undefined): string | null {
  if (!traceparent) return null;
  const parts = traceparent.trim().split("-");
  const traceId = parts[1];
  if (parts.length < 4 || !traceId || !/^[0-9a-f]{32}$/i.test(traceId)) return null;
  return traceId.toLowerCase();
}
