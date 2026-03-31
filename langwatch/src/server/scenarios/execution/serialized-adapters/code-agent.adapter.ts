/**
 * Serialized code agent adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 *
 * Executes Python code by building a minimal DSL workflow (entry -> code -> end)
 * and sending it to the langwatch_nlp service's /studio/execute_sync endpoint
 * as an execute_flow event.
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { randomBytes } from "crypto";
import { resolveFieldMappings } from "../resolve-field-mappings";
import type { CodeAgentData } from "../types";

/** Timeout for NLP service requests (2 minutes) */
const NLP_FETCH_TIMEOUT_MS = 120_000;

/**
 * Serialized code agent adapter that uses pre-fetched configuration.
 * Sends code execution requests to the NLP service. No database access required.
 */
export class SerializedCodeAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  private static readonly ENTRY_NODE_ID = "entry";
  private static readonly CODE_NODE_ID = "code_agent";
  private static readonly END_NODE_ID = "end";

  constructor(
    private readonly config: CodeAgentData,
    private readonly nlpServiceUrl: string,
    private readonly apiKey: string,
  ) {
    super();
    this.name = "SerializedCodeAgentAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    const inputRecord = this.resolveInputValues(input);
    const workflow = this.buildWorkflow(inputRecord);
    const result = await this.executeOnNlpService(workflow, inputRecord);
    return result;
  }

  /**
   * Build a minimal DSL workflow with entry -> code -> end nodes for execution.
   *
   * The /studio/execute_sync endpoint returns result.get("end"), so we need
   * an end node to capture the code node's outputs.
   */
  private buildWorkflow(resolvedValues: Record<string, string>) {
    const { ENTRY_NODE_ID, CODE_NODE_ID, END_NODE_ID } =
      SerializedCodeAgentAdapter;

    const inputs =
      this.config.inputs.length > 0
        ? this.config.inputs.map((inp) => ({
            identifier: inp.identifier,
            type: inp.type,
            value: resolvedValues[inp.identifier] ?? "",
          }))
        : [{ identifier: "input", type: "str", value: resolvedValues["input"] ?? "" }];

    const outputs =
      this.config.outputs.length > 0
        ? this.config.outputs
        : [{ identifier: "output", type: "str" }];

    return {
      api_key: this.apiKey,
      workflow_id: `scenario-code-${this.config.agentId}`,
      spec_version: "1.4",
      name: "Scenario Code Execution",
      icon: "🔧",
      description: "Minimal workflow for scenario code agent execution",
      version: "1.0",
      template_adapter: "default" as const,
      default_llm: null,
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
    inputs: { identifier: string; type: string; value: string }[],
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

  /** Build the code node that executes the agent's Python code. */
  private buildCodeNode(
    inputs: { identifier: string; type: string; value: string }[],
    outputs: { identifier: string; type: string }[],
  ) {
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
        ],
        cls: "Code",
      },
    };
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
   * Execute the workflow via the NLP service's /studio/execute_sync endpoint.
   *
   * Uses execute_flow (not execute_component) because /execute_sync only
   * monitors ExecutionStateChange events, which are emitted by execute_flow.
   */
  private async executeOnNlpService(
    workflow: ReturnType<typeof this.buildWorkflow>,
    inputRecord: Record<string, string>,
  ): Promise<string> {
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
    const timeout = setTimeout(
      () => controller.abort(),
      NLP_FETCH_TIMEOUT_MS,
    );

    try {
      let response: Response;
      try {
        response = await fetch(
          `${this.nlpServiceUrl}/studio/execute_sync`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
            signal: controller.signal,
          },
        );
      } catch (fetchError) {
        const cause = fetchError instanceof Error && "cause" in fetchError
          ? ` (cause: ${String((fetchError as Error & { cause?: unknown }).cause)})`
          : "";
        throw new Error(
          `Code execution failed: fetch to ${this.nlpServiceUrl}/studio/execute_sync failed - ${fetchError instanceof Error ? fetchError.message : String(fetchError)}${cause}`,
        );
      }

      if (!response.ok) {
        let errorMessage = "";
        try {
          const errorBody = (await response.json()) as { detail?: string };
          errorMessage = errorBody.detail ?? JSON.stringify(errorBody);
        } catch {
          errorMessage = await response.text().catch(() => "");
        }
        throw new Error(
          `Code execution failed: HTTP ${response.status}${errorMessage ? ` - ${errorMessage}` : ""}`,
        );
      }

      const result = (await response.json()) as {
        trace_id: string;
        status: string;
        result: Record<string, unknown> | null;
      };
      return this.extractOutput(result.result);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Resolve input values from scenarioMappings (on the agent config) or fall
   * back to legacy behavior.
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

    if (this.config.scenarioMappings) {
      const resolved = resolveFieldMappings({
        fieldMappings: this.config.scenarioMappings,
        agentInput,
      });
      // Only include values for inputs that exist on the agent
      const record: Record<string, string> = {};
      for (const inp of declaredInputs) {
        record[inp.identifier] = resolved[inp.identifier] ?? "";
      }
      return record;
    }

    // Legacy behavior: first input = last user message, rest = ""
    const lastUserMessage = agentInput.messages.findLast((m) => m.role === "user");
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

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
