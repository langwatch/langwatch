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
import type { CodeAgentData } from "../types";

/** Timeout for NLP service requests (2 minutes) */
const NLP_FETCH_TIMEOUT_MS = 120_000;

/**
 * Serialized code agent adapter that uses pre-fetched configuration.
 * Sends code execution requests to the NLP service. No database access required.
 */
export class SerializedCodeAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  constructor(
    private readonly config: CodeAgentData,
    private readonly nlpServiceUrl: string,
    private readonly apiKey: string,
  ) {
    super();
    this.name = "SerializedCodeAgentAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    const lastUserMessage = input.messages.findLast((m) => m.role === "user");
    const inputValue =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content ?? "");

    const inputRecord = this.buildInputRecord(inputValue);
    const workflow = this.buildWorkflow(inputValue);
    const result = await this.executeOnNlpService(workflow, inputRecord);
    return result;
  }

  /**
   * Build a minimal DSL workflow with entry -> code -> end nodes for execution.
   *
   * The /studio/execute_sync endpoint returns result.get("end"), so we need
   * an end node to capture the code node's outputs.
   */
  private buildWorkflow(inputValue: string) {
    const entryNodeId = "entry";
    const codeNodeId = "code_agent";
    const endNodeId = "end";

    // Build input fields - only the first input receives the scenario message,
    // remaining inputs get empty strings (code agents with multiple inputs
    // should use the first input for the primary message).
    const inputs =
      this.config.inputs.length > 0
        ? this.config.inputs.map((inp, index) => ({
            identifier: inp.identifier,
            type: inp.type,
            value: index === 0 ? inputValue : "",
          }))
        : [{ identifier: "input", type: "str", value: inputValue }];

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
        {
          id: entryNodeId,
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
        },
        {
          id: codeNodeId,
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
        },
        {
          id: endNodeId,
          type: "end",
          position: { x: 400, y: 0 },
          data: {
            name: "End",
            inputs: outputs.map((out) => ({
              identifier: out.identifier,
              type: out.type,
            })),
          },
        },
      ],
      edges: [
        // entry -> code_agent edges (one per input)
        // Handle format is "outputs.field" / "inputs.field" (no node ID prefix)
        ...inputs.map((inp) => ({
          id: `${entryNodeId}-${codeNodeId}-${inp.identifier}`,
          source: entryNodeId,
          sourceHandle: `outputs.${inp.identifier}`,
          target: codeNodeId,
          targetHandle: `inputs.${inp.identifier}`,
          type: "default",
        })),
        // code_agent -> end edges (one per output)
        ...outputs.map((out) => ({
          id: `${codeNodeId}-${endNodeId}-${out.identifier}`,
          source: codeNodeId,
          sourceHandle: `outputs.${out.identifier}`,
          target: endNodeId,
          targetHandle: `inputs.${out.identifier}`,
          type: "default",
        })),
      ],
      state: { execution: { status: "idle" } },
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
   * Build input values record for the execute_flow event.
   * Only the first input receives the scenario message; others get empty strings.
   */
  private buildInputRecord(inputValue: string): Record<string, string> {
    const inputs =
      this.config.inputs.length > 0
        ? this.config.inputs
        : [{ identifier: "input", type: "str" }];

    const record: Record<string, string> = {};
    for (let i = 0; i < inputs.length; i++) {
      record[inputs[i]!.identifier] = i === 0 ? inputValue : "";
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
   */
  private extractOutput(result: Record<string, unknown> | null): string {
    if (!result) return "";
    if (typeof result === "string") return result;

    // Try to extract by the first configured output identifier
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
