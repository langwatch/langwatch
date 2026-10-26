/**
 * Serialized connected agent adapter for scenario worker execution. The child process has no Redis
 * and no database, so it reaches a connected agent the way every other caller does: one POST per
 * turn to the relay route with the project key.
 */

import { busyRetryAfterMsFor, type CallKind } from "@langwatch/agent-contract";
import type { Logger } from "@langwatch/observability";
import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import type { ConnectedAgentData, RunParameterValues } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import { type ServedInstance, SerializedAgentChannel } from "../serialized-agent.channel.ts";

/** How long the adapter keeps retrying a busy agent before it gives up. */
export const BUSY_RETRY_BUDGET_MS = 60_000;

/** Slack over the agent's own budget before the HTTP request is abandoned. */
const REQUEST_SLACK_MS = 15_000;

/** The marker the failure classifier reads a connected call failure by. */
export const CONNECTED_CALL_FAILURE_PREFIX = "Connected agent call failed";

/**
 * A relay call that did not answer with an output. `code` is the handled
 * error code the relay named, so the run's failure envelope reads the same
 * code the REST caller would.
 */
export class ConnectedAgentCallError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor({
    code,
    message,
    httpStatus,
  }: {
    code: string;
    message: string;
    httpStatus: number;
  }) {
    super(`${CONNECTED_CALL_FAILURE_PREFIX} (${code}): ${message}`);
    this.name = "ConnectedAgentCallError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** The scenario run a call belongs to, sent with every call (ADR-180). */
export interface ConnectedCallRun {
  scenarioRunId?: string;
  scenarioName?: string;
  batchRunId?: string;
}

/** A scenario run's test data: what setup returned, or a turn's latest update. */
export type ConnectedRunState = Record<string, unknown>;

type RelayAnswer = {
  output: unknown;
  session?: unknown;
  state?: ConnectedRunState | null;
  instance: ServedInstance;
};

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect?: "error" | "follow" | "manual";
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: Pick<Headers, "get">;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export class HttpSerializedConnectedAgentChannel extends SerializedAgentChannel {
  role = AgentRole.AGENT;

  private readonly config: ConnectedAgentData;
  private readonly projectApiKey: string;
  private readonly parameters: RunParameterValues;
  private readonly logger: Logger;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly run: ConnectedCallRun;
  private served: ServedInstance | null = null;
  private state: ConnectedRunState | null = null;

  static create(options: {
    config: ConnectedAgentData;
    projectApiKey: string;
    parameters?: RunParameterValues;
    logger: Logger;
    fetchImpl?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
    run?: ConnectedCallRun;
  }): HttpSerializedConnectedAgentChannel {
    return new HttpSerializedConnectedAgentChannel(options);
  }

  constructor({
    config,
    projectApiKey,
    parameters,
    logger,
    fetchImpl,
    sleep,
    run,
  }: {
    config: ConnectedAgentData;
    /** The project key the relay route authenticates the child with. */
    projectApiKey: string;
    parameters?: RunParameterValues;
    logger: Logger;
    /** The fetch the adapter posts with, replaceable in tests. */
    fetchImpl?: FetchLike;
    /** The wait between busy retries, replaceable in tests. */
    sleep?: (ms: number) => Promise<void>;
    /** The scenario run the calls belong to; absent outside a scenario run. */
    run?: ConnectedCallRun;
  }) {
    super();
    this.name = "SerializedConnectedAgentAdapter";
    this.config = config;
    this.projectApiKey = projectApiKey;
    this.parameters = parameters ?? {};
    this.logger = logger;
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.run = run ?? {};
  }

  /** The instance that answered the last turn, or nothing yet. */
  override get servedInstance(): ServedInstance | null {
    return this.served;
  }

  /** The run's state as the next call sends it, or nothing before setup answered. */
  get runState(): ConnectedRunState | null {
    return this.state;
  }

  async call(input: AgentInput): Promise<string> {
    const payload = await this.send({
      kind: "turn",
      messages: input.messages,
      newMessages: input.newMessages,
      threadId: input.threadId,
      session: this.sessionOf(input.threadId),
    });
    this.storeSession({
      threadId: input.threadId,
      session: payload.session,
    });
    // A turn that says nothing about the state leaves it as it was.
    if (payload.state != null) this.state = payload.state;
    return payload.output as string;
  }

  /**
   * Calls the agent's setup or teardown once, with the run's state and parameters. Setup's state
   * becomes the run's state; teardown's answer is returned and not kept.
   * @throws ConnectedAgentCallError when the hook fails, times out or cannot be reached.
   */
  async callHook({
    kind,
    timeoutMs,
  }: {
    kind: Exclude<CallKind, "turn">;
    timeoutMs: number;
  }): Promise<{ state?: ConnectedRunState }> {
    const payload = await this.send({
      kind,
      messages: [],
      newMessages: [],
      hookBudgetMs: timeoutMs,
    });
    const state = payload.state ?? undefined;
    if (kind === "setup") this.state = state ?? null;
    return state === undefined ? {} : { state };
  }

  private async send({
    kind,
    messages,
    newMessages,
    threadId,
    session,
    hookBudgetMs,
  }: {
    kind: CallKind;
    messages: unknown[];
    newMessages: unknown[];
    threadId?: string;
    session?: unknown;
    /** A hook's budget, which the relay runs the call under; a turn runs under the agent's. */
    hookBudgetMs?: number;
  }): Promise<RelayAnswer> {
    const timeoutMs = (hookBudgetMs ?? this.config.timeoutMs) + REQUEST_SLACK_MS;
    const { headers: propagation } = injectTraceContextHeaders({ headers: {} });
    const traceparent = propagation.traceparent;
    const body = JSON.stringify({
      kind,
      messages,
      newMessages,
      threadId,
      params: this.parameters,
      session,
      state: this.state,
      run: this.run,
      ...(hookBudgetMs !== undefined ? { timeoutMs: hookBudgetMs } : {}),
      ...(traceparent ? { traceparent } : {}),
    });
    const url = `${this.config.endpoint.replace(/\/$/, "")}/api/v1/agents/${this.config.agentId}/call`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Auth-Token": this.projectApiKey,
      ...(traceparent ? { traceparent } : {}),
    };

    const startedAt = nowInstant().epochMilliseconds;
    const budgetEndsAt = startedAt + BUSY_RETRY_BUDGET_MS;
    let response = await this.post({ url, headers, body, timeoutMs });
    while (response.status === 429 && nowInstant().epochMilliseconds < budgetEndsAt) {
      const retryAfterMs = retryAfterMsOf(response.headers.get("retry-after"));
      // Jitter spreads the retries of a batch of scenarios that all hit a
      // full agent at the same moment.
      const waitMs = Math.min(
        retryAfterMs + Math.floor(Math.random() * retryAfterMs),
        budgetEndsAt - nowInstant().epochMilliseconds,
      );
      this.logger.info(
        { agentId: this.config.agentId, waitMs },
        "connected agent busy, waiting before the next try",
      );
      await this.sleep(Math.max(0, waitMs));
      response = await this.post({ url, headers, body, timeoutMs });
    }
    if (!response.ok) {
      throw await failureOf(response);
    }
    const payload = (await response.json()) as RelayAnswer;
    // A hook may be answered by another instance; the run records the one that served its turns.
    if (kind === "turn") this.served = payload.instance;
    this.logger.info(
      {
        agentId: this.config.agentId,
        kind,
        instance: payload.instance,
        durationMs: nowInstant().epochMilliseconds - startedAt,
      },
      "connected agent call ok",
    );
    return payload;
  }

  private async post({
    url,
    headers,
    body,
    timeoutMs,
  }: {
    url: string;
    headers: Record<string, string>;
    body: string;
    /** How long this request may take before it is abandoned. */
    timeoutMs: number;
  }) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: "POST",
        headers,
        body,
        signal,
        // The relay answers on the same origin. A redirect would carry
        // `X-Auth-Token` to wherever it points, because a custom header is
        // not one the runtime strips when the origin changes, so a redirect
        // fails the call instead.
        redirect: "error",
      });
    } catch (error) {
      if (signal.aborted) {
        throw new ConnectedAgentCallError({
          code: "agent_call_timeout",
          message: "The relay did not answer inside the call budget.",
          httpStatus: 504,
        });
      }
      throw new ConnectedAgentCallError({
        code: "agent_relay_unreachable",
        message: error instanceof Error ? error.message : String(error),
        httpStatus: 0,
      });
    }
  }
}

/**
 * The handled code the relay named, from whichever field of its body carries it. The REST boundary
 * writes `code` and repeats it under `error` on the routes that answer the older envelope, where
 * `error` is the status text instead (`Service Unavailable`).
 */
function codeOf({
  parsed,
  status,
}: {
  parsed: { error?: unknown; code?: unknown };
  status: number;
}): string {
  if (typeof parsed.code === "string" && parsed.code.length > 0) {
    return parsed.code;
  }
  const nested = parsed.error;
  if (typeof nested === "object" && nested !== null) {
    const inner = (nested as { code?: unknown }).code;
    if (typeof inner === "string" && inner.length > 0) return inner;
  }
  if (typeof nested === "string" && nested.length > 0) return nested;
  return `http_${status}`;
}

/** The relay's own error body as a typed error. */
async function failureOf(response: {
  status: number;
  text(): Promise<string>;
}): Promise<ConnectedAgentCallError> {
  const raw = await response.text().catch(() => "");
  let parsed: {
    error?: unknown;
    code?: unknown;
    message?: unknown;
    meta?: unknown;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON: the status alone names the failure.
    parsed = {};
  }
  const code = codeOf({ parsed, status: response.status });
  const meta =
    typeof parsed.meta === "object" && parsed.meta !== null
      ? (parsed.meta as Record<string, unknown>)
      : {};
  // The function's own words ride on `meta.message` for agent_call_failed.
  let message = raw.slice(0, 500);
  if (typeof parsed.message === "string") {
    message = parsed.message;
  }
  if (typeof meta.message === "string" && meta.message.length > 0) {
    message = meta.message;
  }
  return new ConnectedAgentCallError({
    code,
    message,
    httpStatus: response.status,
  });
}

function retryAfterMsOf(header: string | null): number {
  const seconds = Number(header);
  return busyRetryAfterMsFor({
    declared: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
  });
}
