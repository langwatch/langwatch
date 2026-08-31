/**
 * `connectAgent`: the function that runs an agent becomes a simulation target.
 *
 * The wrapper resolves the environment and the parameter schema at definition,
 * registers the agent with the process-wide client, and returns a function
 * that is directly callable (for unit tests and local runs) and exposes
 * `disconnect()`.
 *
 * @see specs/typescript-sdk/agent-wrapper.feature
 */

import { ConsoleLogger, type Logger } from "../logger";
import { getSharedClient, warnOnce, type AgentRuntime } from "./client";
import {
  resolveEnabled,
  resolveEnvironment,
  resolveInstanceLabel,
  DEFAULT_ENVIRONMENT,
} from "./identity";
import type { AgentMessage, AgentParameterValue, JsonSchemaObject } from "./protocol";
import type { AgentTransport } from "./transport";
import {
  AgentParameterError,
  createParameterReader,
  parameterSpecsFromSchema,
  toParameterSchema,
  type InferStandardOutput,
  type ParameterDefinition,
  type ParameterDefinitions,
  type ParameterInput,
  type StandardJsonSchema,
} from "./schema";

/** The default call timeout, and the cap the platform enforces. */
export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 300_000;

/** What a handler may return: a string, one message, a list of messages, or an output with a session. */
export type AgentOutput = string | AgentMessage | AgentMessage[];

/** The output of one turn plus the session the agent keeps for the next turn of the same thread. */
export interface AgentResult {
  output: AgentOutput;
  session?: unknown;
}

export type AgentReply = AgentOutput | AgentResult;

/** The one object a handler receives on every turn. */
export interface AgentCall<P = Record<string, AgentParameterValue>> {
  /** The full conversation, OpenAI style. */
  messages: AgentMessage[];
  /** The messages added since the last turn of this thread. */
  newMessages: AgentMessage[];
  /** The platform's conversation id. */
  threadId: string;
  /** The value the handler returned as `session` on the previous turn of this thread, null on the first. */
  session: unknown;
  /** The run parameters, validated and with defaults filled. */
  params: P;
  /** The trace id of the turn, so the agent's own spans join it. Empty when the call carries none. */
  traceId: string;
}

export type AgentHandler<P> = (call: AgentCall<P>) => AgentReply | Promise<AgentReply>;

/** What a direct call of the wrapped function takes: messages, and anything else is optional. */
export interface DirectAgentCall<P> {
  messages: AgentMessage[];
  newMessages?: AgentMessage[];
  threadId?: string;
  session?: unknown;
  params?: Partial<P>;
  traceId?: string;
}

export interface ConnectAgentOptions<P extends ParameterInput = ParameterDefinitions> {
  /** The agent name. One row per name and environment on the platform. */
  name: string;
  /** Resolved from LANGWATCH_AGENT_ENVIRONMENT, APP_ENV, ENVIRONMENT, NODE_ENV, else development. */
  environment?: string;
  /** A definition map, a Standard JSON Schema object, or a JSON Schema object. */
  parameters?: P;
  /**
   * Whether this process connects. Takes any boolean, so one expression can
   * gate the deployments that connect: `process.env.APP_ENV !== "production"`.
   * Default true, except when CI is truthy. LANGWATCH_AGENT_CONNECT=0 always disables.
   */
  enabled?: boolean;
  /** Names this instance in the platform. Also LANGWATCH_AGENT_INSTANCE_LABEL. */
  instanceLabel?: string;
  /** Per call, default 120000, at most 300000. */
  timeoutMs?: number;
  /** Calls in flight per instance, default 1 in development and 4 elsewhere. */
  concurrency?: number;
  /** Keep every turn of a thread on the instance that answered the first one. */
  sticky?: boolean;
  apiKey?: string;
  endpoint?: string;
  projectId?: string;
  /** `websocket` (default, falls back to HTTP when the upgrade is refused) or `http`. Also LANGWATCH_AGENT_TRANSPORT. */
  transport?: AgentTransport;
  logger?: Logger;
}

/** The wrapped function: callable, and connected until `disconnect()`. */
export interface ConnectedAgent<P> {
  (call: DirectAgentCall<P>): Promise<AgentResult>;
  readonly name: string;
  readonly environment: string;
  /** The parameter schema as registered. */
  readonly parameters: JsonSchemaObject;
  /** Send deregister and close the socket when this was the last agent of the process. */
  disconnect: () => Promise<void>;
}

type Widen<V> = V extends string ? string : V extends number ? number : V extends boolean ? boolean : V;

type ParameterValueOf<D extends ParameterDefinition> = D extends {
  options: readonly (infer O extends string)[];
}
  ? O
  : D extends { type: "number" }
    ? number
    : D extends { type: "boolean" }
      ? boolean
      : D extends { type: "string" }
        ? string
        : D extends { default: infer V }
          ? Widen<V>
          : string;

/** The `params` type a definition map gives the handler. */
export type InferParameters<P extends ParameterDefinitions> = {
  [K in keyof P]: ParameterValueOf<P[K]>;
};

const isMessage = (value: unknown): value is AgentMessage =>
  typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as AgentMessage).role === "string";

/** One of the four reply shapes as the `{ output, session }` the result frame carries. */
export function normalizeReply(reply: unknown): AgentResult {
  if (typeof reply === "string") return { output: reply };
  if (Array.isArray(reply) && reply.every(isMessage)) return { output: reply };
  if (isMessage(reply)) return { output: reply };
  if (typeof reply === "object" && reply !== null && "output" in reply) {
    const { output, session } = reply as { output: unknown; session?: unknown };
    const normalized = normalizeReply(output);
    return session === undefined ? normalized : { output: normalized.output, session };
  }
  throw new Error(
    "the agent handler must return a string, a message, a list of messages, or { output, session }",
  );
}

const clampTimeout = ({ timeoutMs, logger, name }: { timeoutMs: number | undefined; logger: Logger; name: string }): number => {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_TIMEOUT_MS;
  if (timeoutMs > MAX_TIMEOUT_MS) {
    logger.warn(`agent "${name}": timeoutMs ${timeoutMs} is above the ${MAX_TIMEOUT_MS} cap, using the cap`);
    return MAX_TIMEOUT_MS;
  }
  return Math.floor(timeoutMs);
};

const readApiKey = (explicit: string | undefined): string | undefined => {
  const candidate = explicit ?? process.env.LANGWATCH_API_KEY;
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate.trim() : undefined;
};

const readProjectId = (explicit: string | undefined): string | undefined => {
  const candidate = explicit ?? process.env.LANGWATCH_PROJECT_ID;
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate.trim() : undefined;
};

/**
 * A schema library object (zod 4, valibot, arktype: anything with Standard
 * Schema and Standard JSON Schema) types `params` as its parsed output and
 * validates every call's values before the handler runs.
 */
export function connectAgent<const S extends StandardJsonSchema>(
  options: ConnectAgentOptions<S> & { parameters: S },
  handler: AgentHandler<InferStandardOutput<S>>,
): ConnectedAgent<InferStandardOutput<S>>;
export function connectAgent<const P extends ParameterDefinitions = Record<string, never>>(
  options: ConnectAgentOptions<P>,
  handler: AgentHandler<InferParameters<P>>,
): ConnectedAgent<InferParameters<P>>;
export function connectAgent(
  options: ConnectAgentOptions<JsonSchemaObject>,
  handler: AgentHandler<Record<string, AgentParameterValue>>,
): ConnectedAgent<Record<string, AgentParameterValue>>;
export function connectAgent(
  options: ConnectAgentOptions<ParameterInput>,
  handler: AgentHandler<Record<string, AgentParameterValue>>,
): ConnectedAgent<Record<string, AgentParameterValue>> {
  const logger = options.logger ?? new ConsoleLogger({ level: "info", prefix: "LangWatch" });
  const name = options.name?.trim();
  if (!name) throw new Error("connectAgent needs a name");

  const environment = resolveEnvironment({ explicit: options.environment });
  const parameters = toParameterSchema(options.parameters);
  const specs = parameterSpecsFromSchema(parameters);
  const timeoutMs = clampTimeout({ timeoutMs: options.timeoutMs, logger, name });
  const concurrency = Math.max(
    1,
    Math.floor(options.concurrency ?? (environment === DEFAULT_ENVIRONMENT ? 1 : 4)),
  );

  const runHandler = async (call: AgentCall<Record<string, AgentParameterValue>>): Promise<AgentResult> =>
    normalizeReply(await handler(call));

  const readParams = createParameterReader({ input: options.parameters, specs });

  const invoke = async (call: DirectAgentCall<Record<string, AgentParameterValue>>): Promise<AgentResult> => {
    const params = await readParams(call.params as Record<string, AgentParameterValue> | undefined);
    return runHandler({
      messages: call.messages,
      newMessages: call.newMessages ?? call.messages,
      threadId: call.threadId ?? `local_${Date.now().toString(36)}`,
      session: call.session ?? null,
      params,
      traceId: call.traceId ?? "",
    });
  };

  const runtime: AgentRuntime = {
    name,
    environment,
    register: {
      name,
      environment,
      parameters,
      concurrency,
      timeoutMs,
      ...(options.sticky ? { sticky: true } : {}),
    },
    readParams,
    concurrency,
    timeoutMs,
    run: runHandler,
  };

  let detach: (() => Promise<void>) | undefined;

  if (!resolveEnabled({ explicit: options.enabled })) {
    logger.debug(`agent "${name}" not connected to LangWatch: the connection is disabled`);
  } else {
    const apiKey = readApiKey(options.apiKey);
    if (!apiKey) {
      warnOnce({
        logger,
        key: "no-api-key",
        message: `agent "${name}" not connected to LangWatch: no API key. Set LANGWATCH_API_KEY to run simulations against it.`,
      });
    } else {
      const client = getSharedClient({
        apiKey,
        endpoint: options.endpoint,
        projectId: readProjectId(options.projectId),
        instanceLabel: resolveInstanceLabel({ explicit: options.instanceLabel }),
        transport: options.transport,
        logger,
      });
      client.addAgent(runtime);
      detach = () => client.removeAgent(runtime);
    }
  }

  const connected = Object.assign(invoke, {
    environment,
    parameters,
    disconnect: async (): Promise<void> => {
      if (!detach) return;
      const release = detach;
      detach = undefined;
      await release();
    },
  });
  // A function's own `name` is read-only but configurable, so it is defined rather than assigned.
  Object.defineProperty(connected, "name", { value: name, configurable: true });

  return connected as ConnectedAgent<Record<string, AgentParameterValue>>;
}

export { AgentParameterError };
