/**
 * Serialized code agent adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 *
 * Executes Python code by building a minimal DSL workflow (entry -> code -> end)
 * and sending it to the nlpgo service's /go/studio/execute_sync endpoint
 * as an execute_flow event.
 */

import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import { SpanKind } from "@opentelemetry/api";
import { randomBytes } from "crypto";
import { getLangWatchTracer } from "langwatch";
import { LATEST_SPEC_VERSION } from "../../../../optimization_studio/types/dsl";
import type { RunParameterValues } from "../../parameters";
import { resolveFieldMappings, sourceFieldOf } from "../resolve-field-mappings";
import type { CodeAgentData } from "../types";
import { SerializedAgentAdapter } from "./serialized-agent.adapter";

/** Timeout for NLP service requests (2 minutes) */
const NLP_FETCH_TIMEOUT_MS = 120_000;

/**
 * Slack added to the fetch deadline when the agent asks for a code budget
 * longer than {@link NLP_FETCH_TIMEOUT_MS}, so this adapter never becomes a
 * second, lower ceiling that aborts the request while the engine is still
 * inside the budget it was given.
 */
const NLP_FETCH_HEADROOM_MS = 30_000;

/** Operator knob naming the platform's maximum for one scenario turn. */
const NLP_FETCH_MAX_TIMEOUT_ENV = "NLP_FETCH_MAX_TIMEOUT_MS";

/** Used when {@link NLP_FETCH_MAX_TIMEOUT_ENV} is unset or unusable (15 minutes). */
const NLP_FETCH_MAX_TIMEOUT_DEFAULT_MS = 900_000;

/**
 * The platform's own maximum for one scenario turn, from the environment.
 *
 * This is a bound on how long a scenario worker will hold a socket open, and
 * nothing else. The engine ceiling
 * (`NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`) bounds how long the agent's
 * *Python* may run; it does not bound this process. Without a maximum here, an
 * agent config carrying an absurd `timeoutMs` parks a worker on a socket for as
 * long as the number says — up to ~24.9 days, where `setTimeout` stops honoring
 * the delay at all.
 *
 * The default of 15 minutes sits above the engine's shipped 12-minute ceiling
 * family, so on default settings the engine gets to enforce and REPORT its
 * timeout before this deadline fires. That ordering is a consequence of the two
 * defaults, NOT an invariant this code enforces: an operator who raises
 * `NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS` above this value must raise this
 * one too, or the platform aborts the fetch first and the caller sees a generic
 * fetch-side `error.kind: "timeout"` instead of the engine's diagnosis.
 *
 * Clamp, never reject — the same contract the engine keeps for its own knobs.
 * Unset, empty, non-numeric, non-finite, zero and negative all read as "use the
 * default"; a nonsensical ceiling must not fail the scenario run.
 *
 * Read per call rather than at module load so a worker started before the
 * variable was set is not pinned to a stale value, and so tests can exercise
 * the real parse without reloading the module.
 *
 * The scenario child process is spawned with a fixed env allowlist
 * (`buildChildProcessEnv` in ../child-environment.ts), which is what carries
 * this variable from the operator's environment to here, and it runs under
 * `SKIP_ENV_VALIDATION`, which makes the validated `~/env.mjs` proxy return raw
 * strings with no defaults applied. Hence the direct read.
 *
 * @internal Exported for testing.
 */
export function resolveMaxFetchTimeoutMs(): number {
  const raw = process.env[NLP_FETCH_MAX_TIMEOUT_ENV];
  if (raw === undefined || raw.trim() === "") {
    return NLP_FETCH_MAX_TIMEOUT_DEFAULT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return NLP_FETCH_MAX_TIMEOUT_DEFAULT_MS;
  }
  return parsed;
}

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
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
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
  role = AgentRole.AGENT;

  private static readonly ENTRY_NODE_ID = "entry";
  private static readonly CODE_NODE_ID = "code_agent";
  private static readonly END_NODE_ID = "end";

  private readonly config: CodeAgentData;
  private readonly nlpServiceUrl: string;
  /**
   * The LangWatch platform API key (project.apiKey), sent as workflow.api_key
   * on the synthesized entry->code->end workflow. nlpgo forwards it verbatim
   * as the X-Auth-Token header on its callbacks into the platform
   * (agentblock/workflow_runner.go, evaluatorblock/executor.go, engine.go),
   * never an LLM provider credential, so it must not be sourced from litellm
   * params (issue #6634).
   */
  private readonly projectApiKey: string;
  /**
   * The run's resolved parameter values, carried on the DSL as
   * `workflow.params` beside `workflow.secrets`. The engine exposes them to
   * the Python under test as `params.NAME`, keeping their native types: a
   * boolean stays a boolean, a number stays a number.
   */
  private readonly parameters: RunParameterValues;

  constructor({
    config,
    nlpServiceUrl,
    projectApiKey,
    parameters,
  }: {
    config: CodeAgentData;
    nlpServiceUrl: string;
    projectApiKey: string;
    parameters?: RunParameterValues;
  }) {
    super();
    this.config = config;
    this.nlpServiceUrl = nlpServiceUrl;
    this.projectApiKey = projectApiKey;
    this.parameters = parameters ?? {};
    this.name = "SerializedCodeAgentAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    const inputRecord = this.resolveInputValues(input);
    const workflow = this.buildWorkflow(inputRecord, this.turnParameters());
    const { output, session } = await this.executeOnNlpService(
      workflow,
      inputRecord,
    );
    this.storeSession({ threadId: input.threadId, session });
    return output;
  }

  /**
   * The `params` namespace for one turn: the run's resolved values plus this
   * turn's trace context, so the code under test can forward
   * `params.trace_id` or `params.traceparent` to whatever it calls. Captured
   * per call, because every turn opens its own trace. `trace_id` and
   * `traceparent` are reserved names: they win over a run parameter with the
   * same name.
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
   * Build a minimal DSL workflow with entry -> code -> end nodes for execution.
   *
   * The /studio/execute_sync endpoint returns result.get("end"), so we need
   * an end node to capture the code node's outputs.
   */
  private buildWorkflow(
    resolvedValues: Record<string, unknown>,
    params: RunParameterValues,
  ) {
    const { ENTRY_NODE_ID, CODE_NODE_ID, END_NODE_ID } =
      SerializedCodeAgentAdapter;

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
      ...(this.config.sandboxApiKey
        ? { sandbox_api_key: this.config.sandboxApiKey }
        : {}),
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
  private buildEntryNode(
    inputs: { identifier: string; type: string; value: unknown }[],
  ) {
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
   * Build the code node that executes the agent's Python code.
   *
   * A configured `timeoutMs` travels as the node's `timeout_ms` parameter —
   * the identifier and units the engine reads (`nodeTimeout` in
   * services/nlpgo/app/engine/engine.go). It is a request for a SHORTER
   * budget only: the code executor clamps it to the operator's ceiling
   * (`NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`, 60s when unset), so a larger
   * value buys the agent nothing. Omitted when unset, which leaves the engine
   * on that operator default.
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
   * How long to wait on the NLP service for one turn.
   *
   * Always at least {@link NLP_FETCH_TIMEOUT_MS}, and above the agent's own
   * code budget when that budget is longer, so the engine gets to enforce (and
   * report) the timeout rather than the request being aborted from here —
   * bounded by {@link resolveMaxFetchTimeoutMs}, this platform's operator-
   * configurable maximum for one turn.
   *
   * An over-large `timeoutMs` is clamped rather than rejected. The schemas
   * that carry it (`CodeAgentDataSchema`, `RawCodeAgentConfigSchema`) stay
   * `.positive()` with no `.max()` on purpose: they mirror what is already
   * stored on the agent, and the engine's contract for the same number is
   * "clamp to the operator's ceiling", not "fail the call". Adding a `.max()`
   * would make a stored value that the engine handles fine fail the whole
   * scenario run at prefetch time instead — and there is no constant to put in
   * a `.max()` any more, since the ceiling is now read from the environment.
   *
   * The ceiling bounds the deadline whether or not the agent named a budget:
   * an operator who sets it below {@link NLP_FETCH_TIMEOUT_MS} has asked for a
   * shorter socket hold than the default floor, and gets it.
   */
  private fetchTimeoutMs(): number {
    const { timeoutMs } = this.config;
    const maxTimeoutMs = resolveMaxFetchTimeoutMs();
    if (timeoutMs === undefined) {
      return Math.min(maxTimeoutMs, NLP_FETCH_TIMEOUT_MS);
    }
    return Math.min(
      maxTimeoutMs,
      Math.max(NLP_FETCH_TIMEOUT_MS, timeoutMs + NLP_FETCH_HEADROOM_MS),
    );
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
   * Execute the workflow via the NLP service's /go/studio/execute_sync endpoint.
   *
   * Uses execute_flow (not execute_component) because /execute_sync only
   * monitors ExecutionStateChange events, which are emitted by execute_flow.
   *
   * The whole call is wrapped in an OTel span so that timeouts and fetch
   * failures always leave a footprint in the trace (lw#3438). The span's
   * `setStatus(ERROR)` + `recordException` are handled by `withActiveSpan`,
   * and we annotate `error.kind` + `http.status_code` so the failure mode
   * is greppable without reading the message string.
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
          let response: Response;
          try {
            response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(event),
              signal: controller.signal,
            });
          } catch (fetchError) {
            if (timedOut) {
              span.setAttribute(
                "error.kind",
                "timeout" satisfies AdapterErrorKind,
              );
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
            nodes?: Record<
              string,
              { outputs?: Record<string, unknown> | null } | null
            >;
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
   * Resolve input values from scenarioMappings (on the agent config) or fall
   * back to legacy behavior.
   *
   * With scenarioMappings: resolve each declared agent input from its mapping.
   *   Orphan mappings (for inputs that don't exist on the agent) are ignored.
   * Without scenarioMappings: first input gets the last user message, rest get "".
   */
  private resolveInputValues(agentInput: AgentInput): Record<string, unknown> {
    const declaredInputs =
      this.config.inputs.length > 0
        ? this.config.inputs
        : [{ identifier: "input", type: "str" }];

    const mappings = this.config.scenarioMappings;
    if (mappings && Object.keys(mappings).length > 0) {
      return this.resolveMappedInputValues({
        declaredInputs,
        mappings,
        agentInput,
      });
    }

    // Legacy behavior: first input = last user message, rest = ""
    const lastUserMessage = agentInput.messages.findLast(
      (m) => m.role === "user",
    );
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
   * Extract the output string from the NLP service response.
   *
   * The /studio/execute_sync endpoint returns:
   * { trace_id, status: "success", result: <end node outputs> }
   *
   * The result is the output from the "end" node, which is a dict
   * of output identifier -> value.
   *
   * When scenarioOutputField is set: extract that specific field (throw if missing).
   * When unset: use first configured output (legacy behavior).
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
   * One value per declared input, from its mapping. Orphan mappings, for
   * inputs the agent does not declare, are ignored.
   *
   * An input mapped to the scenario session receives the JSON value the code
   * returned, not text: the engine passes a non-string entry input through
   * untouched, so the code reads back exactly what it returned, and None on
   * the first turn of a thread.
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
      const isSession =
        mapping !== undefined && sourceFieldOf(mapping) === "session";
      record[inp.identifier] = isSession
        ? (session ?? null)
        : (resolved[inp.identifier] ?? "");
    }
    return record;
  }

  /**
   * The `session` the code returned beside its outputs, read from the code
   * node's own state rather than the end node: the runner keeps every key the
   * code returns, declared or not, so the session needs no declared output
   * and no edge, and a code that returns none leaves the held value as it is.
   */
  private extractSession(
    nodes:
      | Record<string, { outputs?: Record<string, unknown> | null } | null>
      | undefined,
  ): unknown {
    const outputs = nodes?.[SerializedCodeAgentAdapter.CODE_NODE_ID]?.outputs;
    if (!outputs || typeof outputs !== "object") return undefined;
    return "session" in outputs ? outputs.session : undefined;
  }

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
