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
import type { CodeAgentData } from "../types";
import { NlpServiceBaseAdapter, type FieldDef } from "./nlp-service-base.adapter";

/**
 * Serialized code agent adapter that uses pre-fetched configuration.
 * Sends code execution requests to the NLP service. No database access required.
 */
export class SerializedCodeAgentAdapter extends NlpServiceBaseAdapter {
  private static readonly ENTRY_NODE_ID = "entry";
  private static readonly CODE_NODE_ID = "code_agent";
  private static readonly END_NODE_ID = "end";

  constructor(
    private readonly config: CodeAgentData,
    nlpServiceUrl: string,
    apiKey: string,
  ) {
    super(nlpServiceUrl, apiKey);
    this.name = "SerializedCodeAgentAdapter";
  }

  /**
   * Override call to inject inputValue into the workflow build step,
   * since code adapters embed input values directly into the DSL nodes.
   */
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

  protected buildWorkflowPayload(): Record<string, unknown> {
    // Not used directly - call() uses buildWorkflow(inputValue) instead
    return this.buildWorkflow("");
  }

  protected getInputFields(): FieldDef[] {
    return this.config.inputs;
  }

  protected getOutputFields(): FieldDef[] {
    return this.config.outputs;
  }

  protected getErrorLabel(): string {
    return "Code";
  }

  /**
   * Build a minimal DSL workflow with entry -> code -> end nodes for execution.
   *
   * The /studio/execute_sync endpoint returns result.get("end"), so we need
   * an end node to capture the code node's outputs.
   */
  private buildWorkflow(inputValue: string) {
    const { ENTRY_NODE_ID, CODE_NODE_ID, END_NODE_ID } =
      SerializedCodeAgentAdapter;

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
}
