/**
 * Serialized workflow agent adapter for scenario worker execution.
 *
 * Operates with pre-fetched workflow DSL and doesn't require database access.
 * Designed to run in isolated worker threads, mirroring the code-agent adapter
 * but executing the user's published workflow rather than a synthesized one.
 *
 * Input resolution uses the same fieldMappings contract as code and HTTP agents:
 * - With scenarioMappings: each declared agent input is resolved via
 *   `resolveFieldMappings` (source or static value), keyed by agent input id.
 * - Without scenarioMappings: legacy behavior — the first declared input gets
 *   the last user message, remaining inputs get "".
 *
 * Output extraction mirrors the code adapter:
 * - When scenarioOutputField is set: pull that specific key from the end-node
 *   result dict (throw if missing).
 * - When unset: use the first declared output identifier, then fall back to
 *   the first value, then to a stringified result.
 */

import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import { randomBytes } from "crypto";
import {
  resolveFloorFetchTimeoutMs,
  resolveMaxFetchTimeoutMs,
} from "../../../nlpgo/timeouts";
import type { RunParameterValues } from "../../parameters";
import { resolveFieldMappings } from "../resolve-field-mappings";
import type { WorkflowAgentData } from "../types";
import { SerializedAgentAdapter } from "./serialized-agent.adapter";

/**
 * How long to wait on the NLP service for one turn.
 *
 * This adapter has no per-agent `timeoutMs` budget to add headroom above
 * (unlike the code adapter's `CodeAgentData`, `WorkflowAgentData` carries
 * none) — so the deadline is simply the floor, bounded by the platform's
 * operator-configurable maximum. See `../../../nlpgo/timeouts.ts` for what
 * the floor derives from and why: it used to be this file's own hardcoded
 * `NLP_FETCH_TIMEOUT_MS = 120_000`, entirely independent of the code
 * adapter's copy and with no env override, which is exactly the drift that
 * caused a live production timeout when the engine's own ceiling was
 * raised and this one wasn't told.
 */
function fetchTimeoutMs(): number {
  return Math.min(resolveMaxFetchTimeoutMs(), resolveFloorFetchTimeoutMs());
}

/**
 * Serialized workflow agent adapter that uses pre-fetched workflow DSL.
 * Sends execute_flow events to the NLP service. No database access required.
 */
export class SerializedWorkflowAgentAdapter extends SerializedAgentAdapter {
  role = AgentRole.AGENT;

  private readonly config: WorkflowAgentData;
  private readonly nlpServiceUrl: string;
  /**
   * The LangWatch platform API key (project.apiKey), sent as
   * workflow.api_key. nlpgo forwards it verbatim as the X-Auth-Token header
   * on its callbacks into the platform (agentblock/workflow_runner.go,
   * evaluatorblock/executor.go, engine.go) — never an LLM provider
   * credential, so it must not be sourced from litellm params (issue #6634).
   */
  private readonly projectApiKey: string;
  /**
   * The run's resolved parameter values. They reach the workflow twice, and
   * both are needed: as entry inputs, which is how a published workflow wires
   * a value on to its downstream nodes, and on the workflow itself as
   * `params`, which is how a code node inside it reads `params.NAME` with the
   * value's native type intact.
   */
  private readonly parameters: RunParameterValues;

  constructor({
    config,
    nlpServiceUrl,
    projectApiKey,
    parameters,
  }: {
    config: WorkflowAgentData;
    nlpServiceUrl: string;
    projectApiKey: string;
    parameters?: RunParameterValues;
  }) {
    super();
    this.config = config;
    this.nlpServiceUrl = nlpServiceUrl;
    this.projectApiKey = projectApiKey;
    this.parameters = parameters ?? {};
    this.name = "SerializedWorkflowAgentAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    const inputRecord = this.resolveInputValues(input);
    const result = await this.executeOnNlpService(inputRecord);
    return this.extractOutput(result);
  }

  /**
   * Resolve input values from scenarioMappings (on the agent config) or fall
   * back to legacy behavior — identical to the code agent's resolver.
   *
   * With scenarioMappings: resolve each declared agent input from its mapping.
   *   Orphan mappings (for inputs that don't exist on the agent) are ignored.
   * Without scenarioMappings: first input gets the last user message, rest get "".
   */
  private resolveInputValues(agentInput: AgentInput): Record<string, string> {
    // A declared input wins over a parameter of the same name. Spread the other
    // way round and a parameter called `input` would quietly replace the
    // conversation turn the target is supposed to answer, and the run would
    // read as an agent that ignored the user.
    return {
      ...this.parametersAsEntryInputs(),
      ...this.resolveMappedInputValues(agentInput),
    };
  }

  /**
   * The `params` namespace for one turn: the run's resolved values plus this
   * turn's trace context, so a code node inside the workflow can forward
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
   * The run's parameters as entry inputs. Entry inputs are strings on the
   * wire, so a number or a boolean is coerced here; a code node that wants the
   * native value reads it from `params.NAME` instead.
   */
  private parametersAsEntryInputs(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.parameters).map(([name, value]) => [
        name,
        String(value),
      ]),
    );
  }

  private resolveMappedInputValues(
    agentInput: AgentInput,
  ): Record<string, string> {
    const declaredInputs =
      this.config.inputs.length > 0
        ? this.config.inputs
        : [{ identifier: "input", type: "str" }];

    if (
      this.config.scenarioMappings &&
      Object.keys(this.config.scenarioMappings).length > 0
    ) {
      const resolved = resolveFieldMappings({
        fieldMappings: this.config.scenarioMappings,
        agentInput,
      });
      const record: Record<string, string> = {};
      for (const inp of declaredInputs) {
        record[inp.identifier] = resolved[inp.identifier] ?? "";
      }
      return record;
    }

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
   * Execute the pre-fetched workflow DSL via /go/studio/execute_sync.
   *
   * The DSL is passed through unchanged (unlike the code adapter which
   * synthesizes a minimal entry→code→end workflow). The NLP service injects
   * the inputs dict into the entry node when evaluating the graph.
   */
  private async executeOnNlpService(
    inputRecord: Record<string, string>,
  ): Promise<Record<string, unknown> | null> {
    // Merge pre-fetched project secrets into the DSL so `secrets.NAME` works
    // inside code nodes of the published workflow. Any secrets already embedded
    // in the DSL (there shouldn't be any — they're stripped on save) are
    // overwritten by the fresh values to avoid leaking stale/decrypted data.
    const existingSecrets =
      (this.config.workflow.secrets as Record<string, string> | undefined) ??
      {};
    const workflow = {
      ...this.config.workflow,
      api_key: this.projectApiKey,
      secrets: { ...existingSecrets, ...this.config.secrets },
      params: this.turnParameters(),
    };

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs());

    try {
      let response: Response;
      try {
        response = await fetch(`${this.nlpServiceUrl}/go/studio/execute_sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
          signal: controller.signal,
        });
      } catch (fetchError) {
        const cause =
          fetchError instanceof Error && "cause" in fetchError
            ? ` (cause: ${String(
                (fetchError as Error & { cause?: unknown }).cause,
              )})`
            : "";
        throw new Error(
          `Workflow execution failed: fetch to ${this.nlpServiceUrl}/go/studio/execute_sync failed - ${
            fetchError instanceof Error
              ? fetchError.message
              : String(fetchError)
          }${cause}`,
        );
      }

      if (!response.ok) {
        let errorMessage = "";
        try {
          const bodyStr = await response.text();
          try {
            const errorBody = JSON.parse(bodyStr) as { detail?: string };
            errorMessage = errorBody.detail ?? bodyStr;
          } catch {
            errorMessage = bodyStr;
          }
        } catch {
          errorMessage = "";
        }
        throw new Error(
          `Workflow execution failed: HTTP ${response.status}${
            errorMessage ? ` - ${errorMessage}` : ""
          }`,
        );
      }

      const result = (await response.json()) as {
        trace_id: string;
        status: string;
        result: Record<string, unknown> | null;
      };
      return result.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Extract the output string from the NLP service response.
   *
   * When scenarioOutputField is set: extract that specific field (throw if missing).
   * When unset: use first declared output, then first available value,
   * then stringify the entire result.
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

    const firstOutputId = this.config.outputs[0]?.identifier ?? "output";
    const value = result[firstOutputId];
    if (value !== undefined) return this.stringify(value);

    const firstValue = Object.values(result)[0];
    if (firstValue !== undefined) return this.stringify(firstValue);

    return this.stringify(result);
  }

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
