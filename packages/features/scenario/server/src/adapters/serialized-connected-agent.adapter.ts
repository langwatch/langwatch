/**
 * Serialized connected agent adapter for scenario worker execution.
 *
 * The child process has no Redis and no database, so it reaches a connected
 * agent the way every other caller does: one POST per turn to the relay
 * route with the project key. The adapter sends the thread's held `session`
 * on every turn and keeps what the agent returned, adopts the turn's trace
 * context so the judge can read the agent's own spans, and turns the relay's
 * handled errors into typed errors the failure classifier names.
 */

import type { Logger } from "@langwatch/observability";
import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import { BUSY_RETRY_AFTER_MS } from "@langwatch/agent-contract";
import type { ConnectedAgentData, RunParameterValues } from "@langwatch/scenario-contract";
import { createChildProcessLogger } from "./child-logger.adapter";
import { SerializedAgentAdapter } from "./serialized-agent.adapter";

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
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** The instance that answered the last turn, for the run's record. */
export interface ServedInstance {
  hostname: string;
  label: string | null;
}

export class SerializedConnectedAgentAdapter extends SerializedAgentAdapter {
  role = AgentRole.AGENT;

  private readonly config: ConnectedAgentData;
  private readonly projectApiKey: string;
  private readonly parameters: RunParameterValues;
  private readonly logger: Logger;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private served: ServedInstance | null = null;

  static create(options: {
    config: ConnectedAgentData;
    projectApiKey: string;
    parameters?: RunParameterValues;
    logger?: Logger;
    fetchImpl?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
  }): SerializedConnectedAgentAdapter {
    return new SerializedConnectedAgentAdapter(options);
  }

  constructor({
    config,
    projectApiKey,
    parameters,
    logger,
    fetchImpl,
    sleep,
  }: {
    config: ConnectedAgentData;
    /** The project key the relay route authenticates the child with. */
    projectApiKey: string;
    parameters?: RunParameterValues;
    logger?: Logger;
    /** The fetch the adapter posts with, replaceable in tests. */
    fetchImpl?: FetchLike;
    /** The wait between busy retries, replaceable in tests. */
    sleep?: (ms: number) => Promise<void>;
  }) {
    super();
    this.name = "SerializedConnectedAgentAdapter";
    this.config = config;
    this.projectApiKey = projectApiKey;
    this.parameters = parameters ?? {};
    this.logger =
      logger ?? createChildProcessLogger("langwatch:scenarios:connected-adapter", process.env);
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** The instance that answered the last turn, or nothing yet. */
  get servedInstance(): ServedInstance | null {
    return this.served;
  }

  async call(input: AgentInput) {
    const { headers: propagation } = injectTraceContextHeaders({ headers: {} });
    const traceparent = propagation.traceparent ?? null;
    const body = JSON.stringify({
      messages: input.messages,
      newMessages: input.newMessages,
      threadId: input.threadId,
      params: this.parameters,
      session: this.sessionOf(input.threadId),
      traceparent,
    });
    const url = `${this.config.endpoint.replace(/\/$/, "")}/api/v1/agents/${this.config.agentId}/call`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Auth-Token": this.projectApiKey,
      ...(traceparent ? { traceparent } : {}),
    };

    const startedAt = Date.now();
    const budgetEndsAt = startedAt + BUSY_RETRY_BUDGET_MS;
    for (;;) {
      const response = await this.post({ url, headers, body });
      if (response.status === 429 && Date.now() < budgetEndsAt) {
        const retryAfterMs = retryAfterMsOf(response.headers.get("retry-after"));
        // Jitter spreads the retries of a batch of scenarios that all hit a
        // full agent at the same moment.
        const waitMs = Math.min(
          retryAfterMs + Math.floor(Math.random() * retryAfterMs),
          budgetEndsAt - Date.now(),
        );
        this.logger.info(
          { agentId: this.config.agentId, waitMs },
          "connected agent busy, waiting before the next try",
        );
        await this.sleep(Math.max(0, waitMs));
        continue;
      }
      if (!response.ok) {
        throw await failureOf(response);
      }
      const payload = (await response.json()) as {
        output: unknown;
        session?: unknown;
        instance: ServedInstance;
      };
      this.storeSession({
        threadId: input.threadId,
        session: payload.session,
      });
      this.served = payload.instance;
      this.logger.info(
        {
          agentId: this.config.agentId,
          instance: payload.instance,
          durationMs: Date.now() - startedAt,
        },
        "connected agent call ok",
      );
      return payload.output as string;
    }
  }

  private async post({
    url,
    headers,
    body,
  }: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }) {
    const signal = AbortSignal.timeout(this.config.timeoutMs + REQUEST_SLACK_MS);
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
 * The handled code the relay named, from whichever field of its body carries
 * it.
 *
 * The REST boundary writes `code` and repeats it under `error` on the routes
 * that answer the older envelope, where `error` is the status text instead
 * (`Service Unavailable`). A refusal from the authentication chain nests the
 * whole thing under `error`. The code is what the failure classifier names
 * the run by, so reading the status text as the code loses the name.
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
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON: the status alone names the failure.
  }
  const code = codeOf({ parsed, status: response.status });
  const meta =
    typeof parsed.meta === "object" && parsed.meta !== null
      ? (parsed.meta as Record<string, unknown>)
      : {};
  // The function's own words ride on `meta.message` for agent_call_failed.
  const message =
    typeof meta.message === "string" && meta.message.length > 0
      ? meta.message
      : typeof parsed.message === "string"
        ? parsed.message
        : raw.slice(0, 500);
  return new ConnectedAgentCallError({
    code,
    message,
    httpStatus: response.status,
  });
}

function retryAfterMsOf(header: string | null): number {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : BUSY_RETRY_AFTER_MS;
}
