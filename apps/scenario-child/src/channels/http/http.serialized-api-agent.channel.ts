/**
 * API agent adapter: the customer's turn, setup and teardown slots, run in nlpgo's code sandbox
 * through /go/studio/execute_sync. Setup's object is the run's state; turns and teardown see it.
 */

import { randomBytes } from "crypto";

import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import type { ApiAgentData, RunParameterValues } from "@langwatch/scenario-contract";
import { LATEST_SPEC_VERSION } from "@langwatch/workflow-contract";

import {
  type ApiCallKind,
  apiAgentSecrets,
  apiAgentWorkflow,
  apiHookAnswer,
} from "../../rules/api-agent.rules.ts";
import {
  formatEngineError,
  formatFetchError,
  formatHttpError,
  type NlpEngineResult,
  scrubKnownSecrets,
} from "../../rules/execution-error.rules.ts";
import {
  HttpHookError,
  hookTimeoutMessage,
  type HttpHookKind,
  type HttpHookObject,
} from "../../rules/http-hook.rules.ts";
import * as ScenarioSecretReferenceAdapter from "../../rules/scenario-secret-reference.rules.ts";
import type { ExecuteSyncTransport } from "../execute-sync.channel.ts";
import { NLP_FETCH_HEADROOM_MS, type NlpFetchTimeouts } from "../nlp-fetch.channel.ts";
import { SerializedAgentChannel } from "../serialized-agent.channel.ts";
import { HttpNlpFetchChannel } from "./http.nlp-fetch.channel.ts";

/** A slot that did not answer: the code raised, the sandbox failed or the engine was down. */
export class ApiAgentSlotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiAgentSlotError";
  }
}

export class HttpSerializedApiAgentChannel extends SerializedAgentChannel {
  static create(options: {
    config: ApiAgentData;
    projectApiKey: string;
    transport: ExecuteSyncTransport;
    parameters?: RunParameterValues;
    timeouts?: NlpFetchTimeouts;
  }): HttpSerializedApiAgentChannel {
    return new HttpSerializedApiAgentChannel(options);
  }

  role = AgentRole.AGENT;

  /** What setup returned; a turn never changes it. */
  private state: HttpHookObject | null = null;

  private constructor(
    private readonly options: {
      config: ApiAgentData;
      projectApiKey: string;
      transport: ExecuteSyncTransport;
      parameters?: RunParameterValues;
      timeouts?: NlpFetchTimeouts;
    },
  ) {
    super();
    this.name = "ApiAgentAdapter";
  }

  /** The run's state as turns and teardown see it, or nothing before setup answered. */
  get runState(): HttpHookObject | null {
    return this.state;
  }

  async call(input: AgentInput): Promise<string> {
    const history = input.messages.map(({ role, content }) => ({ role, content }));
    const last = [...history].reverse().find((message) => message.role === "user");
    const message =
      typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
    return this.run({
      kind: "turn",
      payload: { message, history, state: this.state },
      timeoutMs: this.turnTimeoutMs(),
    });
  }

  /**
   * Runs the setup or teardown slot. Setup's object becomes the run's state; teardown's is
   * returned and not kept. @throws HttpHookError when the slot fails or answers with no object.
   */
  async callHook({
    kind,
    timeoutMs,
  }: {
    kind: HttpHookKind;
    timeoutMs: number;
  }): Promise<{ state?: HttpHookObject }> {
    const params = { ...this.options.parameters };
    const output = await this.run({
      kind,
      payload: kind === "setup" ? { params } : { state: this.state, params },
      timeoutMs,
      asHook: true,
    });
    const answer = apiHookAnswer({ kind, output });
    if (kind === "setup") this.state = answer ?? null;
    return answer ? { state: answer } : {};
  }

  /** Floor of the engine's own ceiling plus headroom, or the agent's budget when it is larger. */
  private turnTimeoutMs(): number {
    const { timeoutMs } = this.options.config;
    const transport = HttpNlpFetchChannel.create({ timeouts: this.options.timeouts ?? {} });
    const floor = transport.floorTimeoutMs();
    return Math.min(
      transport.maxTimeoutMs(),
      timeoutMs === undefined ? floor : Math.max(floor, timeoutMs + NLP_FETCH_HEADROOM_MS),
    );
  }

  private get resolvedKey(): string | undefined {
    const { apiKey, secrets } = this.options.config;
    if (!apiKey) return undefined;
    return ScenarioSecretReferenceAdapter.resolve({ value: apiKey, secrets });
  }

  private async run({
    kind,
    payload,
    timeoutMs,
    asHook = false,
  }: {
    kind: ApiCallKind;
    payload: Record<string, unknown>;
    timeoutMs: number;
    asHook?: boolean;
  }): Promise<string> {
    const { config, projectApiKey, transport } = this.options;
    const secrets = apiAgentSecrets({ data: config, apiKey: this.resolvedKey });
    const known = [projectApiKey, ...Object.values(secrets)];
    const scrub = (text: string) => scrubKnownSecrets(text, known);
    const { workflow, inputs } = apiAgentWorkflow({
      data: config,
      specVersion: LATEST_SPEC_VERSION,
      projectApiKey,
      secrets,
      kind,
      payload,
    });
    const event = {
      type: "execute_flow" as const,
      payload: {
        trace_id: randomBytes(16).toString("hex"),
        workflow,
        inputs,
        manual_execution_mode: false,
        do_not_trace: true,
        run_evaluations: false,
      },
    };
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await transport.post({ event, signal, timeoutMs });
      const rawBody = await response.text();
      if (!response.ok) {
        throw new ApiAgentSlotError(formatHttpError({ status: response.status, rawBody }).message);
      }
      const result = JSON.parse(rawBody) as NlpEngineResult;
      if (result.status === "error") {
        throw new ApiAgentSlotError(formatEngineError({ engineError: result.error }).message);
      }
      const output = result.result?.output;
      return typeof output === "string" ? output : JSON.stringify(output ?? "");
    } catch (error) {
      throw this.failure({ error, signal, timeoutMs, asHook, scrub });
    }
  }

  /** A timeout keeps the hook code the hook service reads; any message is scrubbed of secrets. */
  private failure({
    error,
    signal,
    timeoutMs,
    asHook,
    scrub,
  }: {
    error: unknown;
    signal: AbortSignal;
    timeoutMs: number;
    asHook: boolean;
    scrub: (text: string) => string;
  }): Error {
    if (signal.aborted) {
      const message = hookTimeoutMessage(timeoutMs);
      return asHook
        ? new HttpHookError({ message, isTimeout: true })
        : new ApiAgentSlotError(message);
    }
    const text = error instanceof Error ? error.message : String(error);
    const message = scrub(
      error instanceof ApiAgentSlotError ? text : formatFetchError({ cause: error }),
    );
    return asHook ? new HttpHookError({ message }) : new ApiAgentSlotError(message);
  }
}
