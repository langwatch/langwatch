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

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { randomBytes } from "crypto";
import { getLangWatchTracer } from "langwatch";
import { resolveFieldMappings } from "../resolve-field-mappings";
import type { WorkflowAgentData } from "../types";
import {
  SerializedAdapterError,
  classifyHttpFailure,
} from "./format-execution-error";

/** Timeout for NLP service requests (2 minutes) — matches code adapter. */
const NLP_FETCH_TIMEOUT_MS = 120_000;

const tracer = getLangWatchTracer(
  "langwatch.scenarios.serialized-workflow-adapter",
);

/**
 * Serialized workflow agent adapter that uses pre-fetched workflow DSL.
 * Sends execute_flow events to the NLP service. No database access required.
 */
export class SerializedWorkflowAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  constructor(
    private readonly config: WorkflowAgentData,
    private readonly nlpServiceUrl: string,
    private readonly apiKey: string,
  ) {
    super();
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
   * Execute the pre-fetched workflow DSL via /studio/execute_sync.
   *
   * The DSL is passed through unchanged (unlike the code adapter which
   * synthesizes a minimal entry→code→end workflow). The NLP service injects
   * the inputs dict into the entry node when evaluating the graph.
   *
   * Wrapped in an OTEL span so timeouts and exceptions always leave a
   * footprint in the trace (#3438). Errors are classified by source so the
   * surfaced message tells the user where the failure actually happened
   * (#3439).
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
      api_key: this.apiKey,
      secrets: { ...existingSecrets, ...this.config.secrets },
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

    const endpoint = `${this.nlpServiceUrl}/studio/execute_sync`;
    return tracer.withActiveSpan(
      "SerializedWorkflowAgentAdapter.execute_nlp_request",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "http.method": "POST",
          "http.url": endpoint,
          "nlp.timeout_ms": NLP_FETCH_TIMEOUT_MS,
        },
      },
      async (span) => {
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, NLP_FETCH_TIMEOUT_MS);

        try {
          let response: Response;
          try {
            response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(event),
              signal: controller.signal,
            });
          } catch (fetchError) {
            const source: "network" | "timeout" = timedOut
              ? "timeout"
              : "network";
            const cause =
              fetchError instanceof Error && "cause" in fetchError
                ? String((fetchError as Error & { cause?: unknown }).cause)
                : "";
            const message = timedOut
              ? `Workflow execution request timed out after ${NLP_FETCH_TIMEOUT_MS}ms`
              : `Workflow execution request failed before reaching ${endpoint}`;
            const detail = [
              fetchError instanceof Error
                ? fetchError.message
                : String(fetchError),
              cause ? `cause: ${cause}` : "",
            ]
              .filter(Boolean)
              .join("\n");
            span.setAttribute("error.kind", source);
            const err = new SerializedAdapterError({
              adapter: this.name,
              source,
              message,
              rawDetail: detail,
              endpoint,
            });
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message });
            throw err;
          }

          span.setAttribute("http.status_code", response.status);

          if (!response.ok) {
            let detail: string | undefined;
            try {
              const bodyStr = await response.text();
              try {
                const parsed = JSON.parse(bodyStr) as { detail?: string };
                detail = parsed.detail ?? bodyStr;
              } catch {
                detail = bodyStr;
              }
            } catch {
              detail = undefined;
            }
            const source = classifyHttpFailure(response.status, detail);
            span.setAttribute("error.kind", source);
            const err = new SerializedAdapterError({
              adapter: this.name,
              source,
              message: `Workflow execution failed: HTTP ${response.status}`,
              rawDetail: detail,
              endpoint,
              httpStatusCode: response.status,
            });
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            throw err;
          }

          const result = (await response.json()) as {
            trace_id: string;
            status: string;
            result: Record<string, unknown> | null;
          };
          span.setStatus({ code: SpanStatusCode.OK });
          return result.result;
        } finally {
          clearTimeout(timeout);
        }
      },
    );
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
