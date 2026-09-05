/**
 * Serialized code agent adapter for scenario worker execution: operates on
 * pre-fetched config with no database access, so it can run in isolated
 * worker threads. Executes Python via a minimal entry->code->end DSL workflow sent to nlpgo's /go/studio/execute_sync as an execute_flow event.
 */

import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import { SpanKind } from "@opentelemetry/api";
import { randomBytes } from "crypto";
import { getLangWatchTracer } from "langwatch";
import { LATEST_SPEC_VERSION } from "@langwatch/workflow-contract";
import type { CodeAgentData, RunParameterValues } from "@langwatch/scenario-contract";
import { resolveFieldMappings, sourceFieldOf } from "@langwatch/scenario-contract";
import { type Response as UndiciResponse, fetch as undiciFetch } from "undici";
import {
  type FetchInitWithDispatcher,
  NLP_FETCH_HEADROOM_MS,
  NlpFetchAdapter,
  type NlpFetchTimeouts,
} from "./nlp-fetch.adapter";
import { SerializedAgentAdapter } from "./serialized-agent.adapter";

/** Categories for adapter failures, surfaced as the `error.kind` span attribute. */
type AdapterErrorKind = "timeout" | "fetch" | "http" | "nlp_error";

/**
 * Adapter-level error that always carries a structured `kind` so the parent
 * span/trace can distinguish a timeout from a network failure or a non-2xx
 * response from the NLP service. See lw#3438.
 */
export class SerializedCodeAgentAdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly httpStatus?: number;

  constructor(
    message: string,
    options: { kind: AdapterErrorKind; httpStatus?: number; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SerializedCodeAgentAdapterError";
    this.kind = options.kind;
    this.httpStatus = options.httpStatus;
  }
}

const tracer = getLangWatchTracer("langwatch.scenarios.code-agent-adapter");

/**
 * Serialized code agent adapter that uses pre-fetched configuration.
 * Sends code execution requests to the NLP service. No database access required.
 */
export class SerializedCodeAgentAdapter extends SerializedAgentAdapter {
  static create(options: {
    config: CodeAgentData;
    nlpServiceUrl: string;
    projectApiKey: string;
    parameters?: RunParameterValues;
    timeouts?: NlpFetchTimeouts;
  }): SerializedCodeAgentAdapter {
    return new SerializedCodeAgentAdapter(options);
  }

  role = AgentRole.AGENT;

  private static readonly ENTRY_NODE_ID = "entry";
  private static readonly CODE_NODE_ID = "code_agent";
  private static readonly END_NODE_ID = "end";

  private readonly config: CodeAgentData;
  private readonly nlpServiceUrl: string;
  /**
   * The LangWatch platform API key, sent as workflow.api_key; nlpgo forwards
   * it verbatim as X-Auth-Token on its platform callbacks. Never an LLM
   * provider credential, so it must not be sourced from litellm params (#6634).
   */
  private readonly projectApiKey: string;
  /**
   * The run's resolved parameter values, carried as `workflow.params` beside
   * `workflow.secrets`. The engine exposes them as `params.NAME`, keeping
   * native types (a boolean stays a boolean, a number stays a number).
   */
  private readonly parameters: RunParameterValues;
  /** The operator's deadlines, as the process that composed this read them. */
  private readonly timeouts: NlpFetchTimeouts;

  constructor({
    config,
    nlpServiceUrl,
    projectApiKey,
    parameters,
    timeouts,
  }: {
    config: CodeAgentData;
    nlpServiceUrl: string;
    projectApiKey: string;
    parameters?: RunParameterValues;
    timeouts?: NlpFetchTimeouts;
  }) {
    super();
    this.config = config;
    this.nlpServiceUrl = nlpServiceUrl;
    this.projectApiKey = projectApiKey;
    this.parameters = parameters ?? {};
    this.timeouts = timeouts ?? {};
    this.name = "SerializedCodeAgentAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    const inputRecord = this.resolveInputValues(input);
    const workflow = this.buildWorkflow(inputRecord, this.turnParameters());
    const { output, session } = await this.executeOnNlpService(workflow, inputRecord);
    this.storeSession({ threadId: input.threadId, session });
    return output;
  }

  /**
   * The `params` namespace for one turn: the run's resolved values plus this
   * turn's trace context, so tested code can forward `params.trace_id`/
   * `traceparent`. Captured per call (every turn opens its own trace); these two names are reserved and win over a same-named run parameter.
   */
  private turnParameters(): RunParameterValues {
    const { headers, traceId } = injectTraceContextHeaders({ headers: {} });
    const traceparent = headers.traceparent;
    return {
      ...this.parameters,
      ...(traceId !== undefined && { trace_id: traceId }),
      ...(traceparent !== undefined && { traceparent }),
    };
  }

  /**
   * Builds a minimal entry->code->end DSL workflow: /studio/execute_sync
   * returns result.get("end"), so an end node is needed to capture the code
   * node's outputs.
   */
  private buildWorkflow(resolvedValues: Record<string, unknown>, params: RunParameterValues) {
    const { ENTRY_NODE_ID, CODE_NODE_ID, END_NODE_ID } = SerializedCodeAgentAdapter;

    const inputs =
      this.config.inputs.length > 0
        ? this.config.inputs.map((inp) => ({
            identifier: inp.identifier,
            type: inp.type,
            value: resolvedValues[inp.identifier] ?? "",
          }))
        : [
            {
              identifier: "input",
              type: "str",
              value: resolvedValues.input ?? "",
            },
          ];

    const outputs =
      this.config.outputs.length > 0
        ? this.config.outputs
        : [{ identifier: "output", type: "str" }];

    return {
      api_key: this.projectApiKey,
      workflow_id: `scenario-code-${this.config.agentId}`,
      spec_version: LATEST_SPEC_VERSION,
      name: "Scenario Code Execution",
      icon: "🔧",
      description: "Minimal workflow for scenario code agent execution",
      version: "1.0",
      template_adapter: "default" as const,
      secrets: this.config.secrets,
      params,
      // The run's own credential, when the platform minted one. The engine
      // injects it into the sandbox next to its LangWatch endpoint, so the
      // code under test reaches the project's agent cache with no wiring of
      // its own. An absent field injects nothing.
      ...(this.config.sandboxApiKey ? { sandbox_api_key: this.config.sandboxApiKey } : {}),
      nodes: [
        this.buildEntryNode(inputs),
        this.buildCodeNode(inputs, outputs),
        this.buildEndNode(outputs),
      ],
      edges: [
        // entry -> code_agent edges (one per input)
        // Handle format is "outputs.field" / "inputs.field" (no node ID prefix)
        ...inputs.map((inp) => ({
          id: `${ENTRY_NODE_ID}-${CODE_NODE_ID}-${inp.identifier}`,
          source: ENTRY_NODE_ID,
          sourceHandle: `outputs.${inp.identifier}`,
          target: CODE_NODE_ID,
          targetHandle: `inputs.${inp.identifier}`,
          type: "default",
        })),
        // code_agent -> end edges (one per output)
        ...outputs.map((out) => ({
          id: `${CODE_NODE_ID}-${END_NODE_ID}-${out.identifier}`,
          source: CODE_NODE_ID,
          sourceHandle: `outputs.${out.identifier}`,
          target: END_NODE_ID,
          targetHandle: `inputs.${out.identifier}`,
          type: "default",
        })),
      ],
      state: { execution: { status: "idle" } },
    };
  }

  /** Build the entry node that provides input fields to the workflow. */
  private buildEntryNode(inputs: { identifier: string; type: string; value: unknown }[]) {
    return {
      id: SerializedCodeAgentAdapter.ENTRY_NODE_ID,
      type: "entry",
      position: { x: 0, y: 0 },
      data: {
        name: "Entry",
        outputs: inputs.map((inp) => ({
          identifier: inp.identifier,
          type: inp.type,
        })),
        entry_selection: "first",
        train_size: 1,
        test_size: 1,
        seed: 42,
        dataset: {
          id: "scenario-input",
          name: "Scenario Input",
          inline: null,
        },
      },
    };
  }

  /**
   * Builds the code node that executes the agent's Python code. A configured
   * `timeoutMs` travels as `timeout_ms` (`nodeTimeout` in engine.go) but is a
   * request for a SHORTER budget only — the executor clamps to the operator's ceiling (`NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`), so a larger value buys nothing.
   */
  private buildCodeNode(
    inputs: { identifier: string; type: string; value: unknown }[],
    outputs: { identifier: string; type: string }[],
  ) {
    const { timeoutMs } = this.config;
    return {
      id: SerializedCodeAgentAdapter.CODE_NODE_ID,
      type: "code",
      position: { x: 200, y: 0 },
      data: {
        name: "CodeAgent",
        inputs,
        outputs,
        parameters: [
          {
            identifier: "code",
            type: "code",
            value: this.config.code,
          },
          ...(timeoutMs === undefined
            ? []
            : [
                {
                  identifier: "timeout_ms",
                  type: "int",
                  value: timeoutMs,
                },
              ]),
        ],
        cls: "Code",
      },
    };
  }

  /**
   * How long to wait on the NLP service for one turn: at least
   * {@link NlpFetchAdapter.floorTimeoutMs} (the engine's ceiling plus
   * headroom), above the agent's own budget when longer (so the engine enforces the timeout), bounded by {@link NlpFetchAdapter.maxTimeoutMs}. An over-large `timeoutMs` is clamped, not rejected — the schemas stay unbounded since the engine's own contract is to clamp, not fail.
   */
  private fetchTimeoutMs(): number {
    const { timeoutMs } = this.config;
    const transport = NlpFetchAdapter.create({ timeouts: this.timeouts });
    const floorTimeoutMs = transport.floorTimeoutMs();
    const maxTimeoutMs = transport.maxTimeoutMs();
    if (timeoutMs === undefined) {
      return Math.min(maxTimeoutMs, floorTimeoutMs);
    }
    return Math.min(maxTimeoutMs, Math.max(floorTimeoutMs, timeoutMs + NLP_FETCH_HEADROOM_MS));
  }

  /** Build the end node that captures code node outputs for the response. */
  private buildEndNode(outputs: { identifier: string; type: string }[]) {
    return {
      id: SerializedCodeAgentAdapter.END_NODE_ID,
      type: "end",
      position: { x: 400, y: 0 },
      data: {
        name: "End",
        inputs: outputs.map((out) => ({
          identifier: out.identifier,
          type: out.type,
        })),
      },
    };
  }

  /**
   * Executes the workflow via /go/studio/execute_sync, using execute_flow
   * (not execute_component) since /execute_sync only monitors
   * ExecutionStateChange events. Wrapped in an OTel span (lw#3438, via `withActiveSpan`) annotated with `error.kind`/`http.status_code` so failures are greppable without reading the message string.
   */
  private async executeOnNlpService(
    workflow: ReturnType<typeof this.buildWorkflow>,
    inputRecord: Record<string, unknown>,
  ): Promise<{ output: string; session: unknown }> {
    const event = {
      type: "execute_flow" as const,
      payload: {
        trace_id: randomBytes(16).toString("hex"),
        workflow,
        inputs: [inputRecord],
        manual_execution_mode: false,
        do_not_trace: true,
        run_evaluations: false,
      },
    };

    const url = `${this.nlpServiceUrl}/go/studio/execute_sync`;
    const fetchTimeoutMs = this.fetchTimeoutMs();

    return tracer.withActiveSpan(
      "SerializedCodeAgentAdapter.execute_nlp_request",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "scenario.agent.id": this.config.agentId,
          "http.url": url,
          "http.method": "POST",
          "nlp.timeout_ms": fetchTimeoutMs,
        },
      },
      async (span) => {
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, fetchTimeoutMs);

        try {
          let response: UndiciResponse;
          try {
            const fetchInit: FetchInitWithDispatcher = {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(event),
              signal: controller.signal,
              dispatcher: NlpFetchAdapter.create().dispatcher({
                timeoutMs: fetchTimeoutMs,
              }),
            };
            // undici's own fetch, not the global one: Node's global fetch is
            // bound to the undici bundled with Node, which rejects a
            // dispatcher built by this package with "invalid onRequestStart
            // method" (see mailer/providers/resend.ts for the same fix).
            response = await undiciFetch(url, fetchInit);
          } catch (fetchError) {
            if (timedOut) {
              span.setAttribute("error.kind", "timeout" satisfies AdapterErrorKind);
              throw new SerializedCodeAgentAdapterError(
                `Code execution failed: NLP service ${url} did not respond within ${fetchTimeoutMs}ms (request aborted).`,
                { kind: "timeout", cause: fetchError },
              );
            }
            span.setAttribute("error.kind", "fetch" satisfies AdapterErrorKind);
            const cause =
              fetchError instanceof Error && "cause" in fetchError
                ? ` (cause: ${String((fetchError as Error & { cause?: unknown }).cause)})`
                : "";
            throw new SerializedCodeAgentAdapterError(
              `Code execution failed: fetch to ${url} failed - ${fetchError instanceof Error ? fetchError.message : String(fetchError)}${cause}`,
              { kind: "fetch", cause: fetchError },
            );
          }

          span.setAttribute("http.status_code", response.status);

          if (!response.ok) {
            let errorMessage = "";
            try {
              const errorBody = (await response.json()) as { detail?: string };
              errorMessage = errorBody.detail ?? JSON.stringify(errorBody);
            } catch {
              errorMessage = await response.text().catch(() => "");
            }
            span.setAttribute("error.kind", "http" satisfies AdapterErrorKind);
            throw new SerializedCodeAgentAdapterError(
              `Code execution failed: HTTP ${response.status}${errorMessage ? ` - ${errorMessage}` : ""}`,
              { kind: "http", httpStatus: response.status },
            );
          }

          const result = (await response.json()) as {
            trace_id: string;
            status: string;
            result: Record<string, unknown> | null;
            nodes?: Record<string, { outputs?: Record<string, unknown> | null } | null>;
          };
          span.setAttribute("nlp.status", result.status);
          if (result.trace_id) {
            span.setAttribute("nlp.trace_id", result.trace_id);
          }
          return {
            output: this.extractOutput(result.result),
            session: this.extractSession(result.nodes),
          };
        } finally {
          clearTimeout(timeout);
        }
      },
    );
  }

  /**
   * Resolves input values from scenarioMappings when set (each declared
   * agent input from its mapping, orphan mappings ignored), else legacy
   * behavior: first input gets the last user message, rest get "".
   */
  private resolveInputValues(agentInput: AgentInput): Record<string, unknown> {
    const declaredInputs =
      this.config.inputs.length > 0 ? this.config.inputs : [{ identifier: "input", type: "str" }];

    const mappings = this.config.scenarioMappings;
    if (mappings && Object.keys(mappings).length > 0) {
      return this.resolveMappedInputValues({
        declaredInputs,
        mappings,
        agentInput,
      });
    }

    // Legacy behavior: first input = last user message, rest = ""
    let lastUserMessage: (typeof agentInput.messages)[number] | undefined;
    for (let index = agentInput.messages.length - 1; index >= 0; index -= 1) {
      const message = agentInput.messages[index];
      if (message?.role === "user") {
        lastUserMessage = message;
        break;
      }
    }
    const inputValue =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content ?? "");

    const record: Record<string, string> = {};
    for (let i = 0; i < declaredInputs.length; i++) {
      record[declaredInputs[i]!.identifier] = i === 0 ? inputValue : "";
    }
    return record;
  }

  /**
   * Extracts the output string from the response (`{ trace_id, status,
   * result }` where `result` is the end node's identifier->value dict): the
   * named `scenarioOutputField` when set (throws if missing), else the first configured output.
   */
  private extractOutput(result: Record<string, unknown> | null): string {
    if (!result) return "";
    if (typeof result === "string") return result;

    const { scenarioOutputField } = this.config;

    if (scenarioOutputField) {
      if (scenarioOutputField in result) {
        return this.stringify(result[scenarioOutputField]);
      }
      throw new Error(
        `Scenario output field "${scenarioOutputField}" not found in agent output. Available fields: ${Object.keys(result).join(", ")}`,
      );
    }

    // Legacy/default: use first configured output identifier
    const firstOutputId = this.config.outputs[0]?.identifier ?? "output";
    const value = result[firstOutputId];
    if (value !== undefined) return this.stringify(value);

    // Fallback: return first available value
    const firstValue = Object.values(result)[0];
    if (firstValue !== undefined) return this.stringify(firstValue);

    // Last resort: stringify the whole result
    return this.stringify(result);
  }

  /**
   * One value per declared input, from its mapping (orphan mappings, for
   * undeclared inputs, are ignored). An input mapped to the scenario session
   * receives the code's JSON value untouched (not text), and None on a thread's first turn.
   */
  private resolveMappedInputValues({
    declaredInputs,
    mappings,
    agentInput,
  }: {
    declaredInputs: { identifier: string; type: string }[];
    mappings: NonNullable<CodeAgentData["scenarioMappings"]>;
    agentInput: AgentInput;
  }): Record<string, unknown> {
    const session = this.sessionOf(agentInput.threadId);
    const resolved = resolveFieldMappings({
      fieldMappings: mappings,
      agentInput,
      session,
    });
    const record: Record<string, unknown> = {};
    for (const inp of declaredInputs) {
      const mapping = mappings[inp.identifier];
      const isSession = mapping !== undefined && sourceFieldOf(mapping) === "session";
      record[inp.identifier] = isSession ? (session ?? null) : (resolved[inp.identifier] ?? "");
    }
    return record;
  }

  /**
   * The `session` the code returned beside its outputs, read from the code
   * node's own state (not the end node): the runner keeps every key the code
   * returns, declared or not, so returning none leaves the held value as-is.
   */
  private extractSession(
    nodes: Record<string, { outputs?: Record<string, unknown> | null } | null> | undefined,
  ): unknown {
    const outputs = nodes?.[SerializedCodeAgentAdapter.CODE_NODE_ID]?.outputs;
    if (!outputs || typeof outputs !== "object") return undefined;
    return "session" in outputs ? outputs.session : undefined;
  }

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
