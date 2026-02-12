/**
 * Serialized code agent adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 *
 * Executes Python code by sending a minimal DSL workflow to the
 * langwatch_nlp service's /execute_sync endpoint.
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import type { CodeAgentData } from "../types";

/**
 * Serialized code agent adapter that uses pre-fetched configuration.
 * Sends code execution requests to the NLP service. No database access required.
 */
export class SerializedCodeAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  constructor(
    private readonly config: CodeAgentData,
    private readonly nlpServiceUrl: string,
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

    const workflow = this.buildWorkflow(inputValue);
    const result = await this.executeOnNlpService(workflow);
    return result;
  }

  /**
   * Build a minimal DSL workflow with entry → code node for execution.
   */
  private buildWorkflow(inputValue: string) {
    const entryNodeId = "entry";
    const codeNodeId = "code_agent";

    // Build input fields with the scenario input value
    const inputs = this.config.inputs.length > 0
      ? this.config.inputs.map((inp) => ({
          identifier: inp.identifier,
          type: inp.type,
          value: inputValue,
        }))
      : [{ identifier: "input", type: "str", value: inputValue }];

    const outputs = this.config.outputs.length > 0
      ? this.config.outputs
      : [{ identifier: "output", type: "str" }];

    return {
      workflow_id: "scenario-code-execution",
      spec_version: "1.3",
      name: "Scenario Code Execution",
      icon: "🔧",
      description: "Minimal workflow for scenario code agent execution",
      version: "1.0",
      default_llm: {},
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
            dataset: "",
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
      ],
      edges: inputs.map((inp) => ({
        id: `${entryNodeId}-${codeNodeId}-${inp.identifier}`,
        source: entryNodeId,
        sourceHandle: `${entryNodeId}.outputs.${inp.identifier}`,
        target: codeNodeId,
        targetHandle: `${codeNodeId}.inputs.${inp.identifier}`,
        type: "default",
      })),
      state: { execution: { status: "idle" } },
    };
  }

  /**
   * Execute the workflow via the NLP service's /execute_sync endpoint.
   */
  private async executeOnNlpService(workflow: ReturnType<typeof this.buildWorkflow>): Promise<string> {
    const event = {
      type: "execute_component",
      payload: {
        trace_id: `scenario-${Date.now()}`,
        workflow,
        node_id: "code_agent",
        inputs: this.buildInputRecord(workflow),
      },
    };

    const response = await fetch(`${this.nlpServiceUrl}/execute_sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Code execution failed: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
      );
    }

    const result = await response.json() as Record<string, unknown>;
    return this.extractOutput(result);
  }

  /**
   * Build input values for the execute_component event.
   */
  private buildInputRecord(workflow: ReturnType<typeof this.buildWorkflow>): Record<string, unknown> {
    const codeNode = workflow.nodes.find((n) => n.id === "code_agent");
    if (!codeNode) return {};

    const record: Record<string, unknown> = {};
    for (const input of codeNode.data.inputs ?? []) {
      record[input.identifier] = input.value ?? "";
    }
    return record;
  }

  /**
   * Extract the output string from the NLP service response.
   */
  private extractOutput(result: Record<string, unknown>): string {
    // The NLP service returns the component outputs in the result
    // Try common output patterns
    if (typeof result === "string") return result;

    // Check for outputs field (standard DSL response format)
    const outputs = result.outputs as Record<string, unknown> | undefined;
    if (outputs) {
      const firstOutput = this.config.outputs[0]?.identifier ?? "output";
      const value = outputs[firstOutput];
      if (value !== undefined) return this.stringify(value);

      // Return first available output
      const firstValue = Object.values(outputs)[0];
      if (firstValue !== undefined) return this.stringify(firstValue);
    }

    // Fallback: stringify the whole result
    return this.stringify(result);
  }

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
