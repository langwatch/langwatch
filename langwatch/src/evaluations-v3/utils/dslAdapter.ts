/**
 * DSL Adapter for Evaluations V3
 *
 * Converts between the V3 UI state structure and the workflow DSL.
 * This allows us to save evaluations in the existing workflow format
 * while using a simpler UI-focused state structure.
 *
 * Structure: Dataset (entry) -> Agent nodes -> Evaluator nodes (per-agent)
 */

import type { Edge, Node } from "@xyflow/react";

import type {
  Workflow,
  Entry,
  Signature,
  Code,
  Evaluator,
  Field,
} from "~/optimization_studio/types/dsl";
import type {
  AgentConfig,
  EvaluationsV3State,
  EvaluatorConfig,
  FieldMapping,
  InlineDataset,
} from "../types";

// ============================================================================
// State to Workflow (Saving)
// ============================================================================

/**
 * Convert V3 state to workflow DSL for persistence.
 */
export const stateToWorkflow = (state: EvaluationsV3State): Workflow => {
  const entryNode = createEntryNode(state.dataset);

  const agentNodes: Array<Node<Signature> | Node<Code>> = [];
  const evaluatorNodes: Array<Node<Evaluator>> = [];

  // Create agent nodes and their evaluator nodes
  state.agents.forEach((agent, agentIndex) => {
    const agentNode =
      agent.type === "llm"
        ? createSignatureNode(agent, agentIndex)
        : createCodeNode(agent, agentIndex);

    agentNodes.push(agentNode);

    // Create evaluator nodes for this agent
    agent.evaluators.forEach((evaluator, evalIndex) => {
      const evaluatorNode = createEvaluatorNode(
        evaluator,
        agent.id,
        agentIndex,
        evalIndex
      );
      evaluatorNodes.push(evaluatorNode);
    });
  });

  const agentEdges = buildAgentEdges(state.agents, state.agentMappings);
  const evaluatorEdges = buildEvaluatorEdges(
    state.agents,
    state.evaluatorMappings
  );

  return {
    spec_version: "1.4",
    name: state.name,
    icon: "🧪",
    description: "Evaluation workflow",
    version: "1.0",
    default_llm: {
      model: "openai/gpt-4o-mini",
      temperature: 0,
      max_tokens: 2048,
    },
    template_adapter: "default",
    enable_tracing: true,
    nodes: [entryNode, ...agentNodes, ...evaluatorNodes] as Workflow["nodes"],
    edges: [...agentEdges, ...evaluatorEdges],
    state: {},
  };
};

/**
 * Create the entry node from the dataset.
 */
const createEntryNode = (dataset: InlineDataset): Node<Entry> => {
  const outputs: Field[] = dataset.columns.map((col) => ({
    identifier: col.id,
    type:
      col.type === "string" ? "str" : col.type === "number" ? "float" : "str",
  }));

  return {
    id: "entry",
    type: "entry",
    data: {
      name: "Dataset",
      outputs,
      entry_selection: "first",
      train_size: 0.8,
      test_size: 0.2,
      seed: 42,
    },
    position: { x: 0, y: 0 },
  };
};

/**
 * Create a signature (LLM) node from an agent config.
 * Uses the `parameters` array structure expected by the DSL.
 */
const createSignatureNode = (
  agent: AgentConfig,
  index: number
): Node<Signature> => {
  const parameters: Field[] = [];

  // LLM config parameter
  if (agent.llmConfig) {
    parameters.push({
      identifier: "llm",
      type: "llm",
      value: agent.llmConfig,
    });
  }

  // Instructions parameter
  if (agent.instructions) {
    parameters.push({
      identifier: "instructions",
      type: "str",
      value: agent.instructions,
    });
  }

  // Messages/prompts parameter
  if (agent.messages) {
    parameters.push({
      identifier: "messages",
      type: "chat_messages",
      value: agent.messages,
    });
  }

  return {
    id: agent.id,
    type: "signature",
    data: {
      name: agent.name,
      inputs: agent.inputs,
      outputs: agent.outputs,
      parameters,
    },
    position: { x: 300, y: index * 200 },
  };
};

/**
 * Create a code node from an agent config.
 * Uses the `parameters` array structure expected by the DSL.
 */
const createCodeNode = (agent: AgentConfig, index: number): Node<Code> => {
  const parameters: Field[] = [];

  // Code parameter
  if (agent.code) {
    parameters.push({
      identifier: "code",
      type: "code",
      value: agent.code,
    });
  }

  return {
    id: agent.id,
    type: "code",
    data: {
      name: agent.name,
      inputs: agent.inputs,
      outputs: agent.outputs,
      parameters,
    },
    position: { x: 300, y: index * 200 },
  };
};

/**
 * Create an evaluator node for a specific agent.
 */
const createEvaluatorNode = (
  evaluator: EvaluatorConfig,
  agentId: string,
  agentIndex: number,
  evalIndex: number
): Node<Evaluator> => {
  return {
    id: `${agentId}.${evaluator.id}`,
    type: "evaluator",
    data: {
      name: evaluator.name,
      cls: "LangWatchEvaluator",
      inputs: evaluator.inputs,
      outputs: [{ identifier: "passed", type: "bool" }],
      evaluator: evaluator.evaluatorType,
      ...evaluator.settings,
    },
    position: { x: 600, y: agentIndex * 200 + evalIndex * 100 },
  };
};

/**
 * Build edges connecting entry to agents based on mappings.
 */
const buildAgentEdges = (
  agents: AgentConfig[],
  agentMappings: Record<string, Record<string, FieldMapping>>
): Edge[] => {
  const edges: Edge[] = [];

  for (const agent of agents) {
    const mappings = agentMappings[agent.id] ?? {};

    for (const [inputField, mapping] of Object.entries(mappings)) {
      if (mapping.source === "dataset") {
        edges.push({
          id: `entry->${agent.id}.${inputField}`,
          source: "entry",
          sourceHandle: `output-${mapping.sourceField}`,
          target: agent.id,
          targetHandle: `input-${inputField}`,
        });
      }
    }
  }

  return edges;
};

/**
 * Build edges connecting agents to their evaluators.
 */
const buildEvaluatorEdges = (
  agents: AgentConfig[],
  evaluatorMappings: Record<
    string,
    Record<string, Record<string, FieldMapping>>
  >
): Edge[] => {
  const edges: Edge[] = [];

  for (const agent of agents) {
    const agentEvalMappings = evaluatorMappings[agent.id] ?? {};

    for (const evaluator of agent.evaluators) {
      const evalMappings = agentEvalMappings[evaluator.id] ?? {};
      const evaluatorNodeId = `${agent.id}.${evaluator.id}`;

      for (const [inputField, mapping] of Object.entries(evalMappings)) {
        if (mapping.source === "dataset") {
          // From dataset
          edges.push({
            id: `entry->${evaluatorNodeId}.${inputField}`,
            source: "entry",
            sourceHandle: `output-${mapping.sourceField}`,
            target: evaluatorNodeId,
            targetHandle: `input-${inputField}`,
          });
        } else if (mapping.source === agent.id) {
          // From this agent's output
          edges.push({
            id: `${agent.id}->${evaluatorNodeId}.${inputField}`,
            source: agent.id,
            sourceHandle: `output-${mapping.sourceField}`,
            target: evaluatorNodeId,
            targetHandle: `input-${inputField}`,
          });
        }
      }
    }
  }

  return edges;
};

// ============================================================================
// Workflow to State (Loading)
// ============================================================================

/**
 * Convert workflow DSL to V3 state for UI display.
 */
export const workflowToState = (
  workflow: Workflow
): Partial<EvaluationsV3State> => {
  const entryNode = workflow.nodes.find((n) => n.type === "entry") as
    | Node<Entry>
    | undefined;

  const dataset = entryNode ? extractDataset(entryNode) : undefined;

  const agentNodes = workflow.nodes.filter(
    (n) => n.type === "signature" || n.type === "code"
  ) as Array<Node<Signature> | Node<Code>>;

  const evaluatorNodes = workflow.nodes.filter(
    (n) => n.type === "evaluator"
  ) as Array<Node<Evaluator>>;

  // Build agents with their evaluators
  const agents: AgentConfig[] = agentNodes.map((node) =>
    extractAgent(node, evaluatorNodes)
  );

  const agentMappings = extractAgentMappings(workflow.edges, agents);
  const evaluatorMappings = extractEvaluatorMappings(
    workflow.edges,
    agents,
    evaluatorNodes
  );

  return {
    name: workflow.name,
    dataset,
    agents,
    agentMappings,
    evaluatorMappings,
  };
};

/**
 * Extract dataset from entry node.
 */
const extractDataset = (entryNode: Node<Entry>): InlineDataset => {
  const columns =
    entryNode.data.outputs?.map((output: Field) => ({
      id: output.identifier,
      name: output.identifier,
      type:
        output.type === "str"
          ? ("string" as const)
          : output.type === "float" || output.type === "int"
            ? ("number" as const)
            : ("string" as const),
    })) ?? [];

  const records: Record<string, string[]> = {};
  for (const col of columns) {
    records[col.id] = [];
  }

  return { columns, records };
};

/**
 * Extract agent config from a signature or code node, including its evaluators.
 */
const extractAgent = (
  node: Node<Signature> | Node<Code>,
  evaluatorNodes: Array<Node<Evaluator>>
): AgentConfig => {
  // Find evaluators that belong to this agent (their ID starts with agentId.)
  const agentEvaluators = evaluatorNodes
    .filter((e) => e.id.startsWith(`${node.id}.`))
    .map((evalNode) => extractEvaluator(evalNode, node.id));

  const params = node.data.parameters ?? [];
  const llmParam = params.find((p: Field) => p.identifier === "llm");
  const instructionsParam = params.find(
    (p: Field) => p.identifier === "instructions"
  );
  const messagesParam = params.find((p: Field) => p.identifier === "messages");
  const codeParam = params.find((p: Field) => p.identifier === "code");

  if (node.type === "signature") {
    return {
      id: node.id,
      type: "llm",
      name: node.data.name ?? node.id,
      inputs: node.data.inputs ?? [],
      outputs: node.data.outputs ?? [],
      llmConfig: llmParam?.value as AgentConfig["llmConfig"],
      instructions: instructionsParam?.value as string | undefined,
      messages: messagesParam?.value as AgentConfig["messages"],
      evaluators: agentEvaluators,
    };
  } else {
    return {
      id: node.id,
      type: "code",
      name: node.data.name ?? node.id,
      inputs: node.data.inputs ?? [],
      outputs: node.data.outputs ?? [],
      code: codeParam?.value as string | undefined,
      evaluators: agentEvaluators,
    };
  }
};

/**
 * Extract evaluator config from an evaluator node.
 */
const extractEvaluator = (
  node: Node<Evaluator>,
  agentId: string
): EvaluatorConfig => {
  // The evaluator ID is the node ID minus the "agentId." prefix
  const evaluatorId = node.id.replace(`${agentId}.`, "");

  const { name, inputs, outputs, evaluator, cls, ...settings } = node.data;

  return {
    id: evaluatorId,
    evaluatorType:
      (evaluator as EvaluatorConfig["evaluatorType"]) ?? "custom/unknown",
    name: name ?? evaluatorId,
    settings,
    inputs: inputs ?? [],
  };
};

/**
 * Extract agent input mappings from edges.
 */
const extractAgentMappings = (
  edges: Edge[],
  agents: AgentConfig[]
): Record<string, Record<string, FieldMapping>> => {
  const mappings: Record<string, Record<string, FieldMapping>> = {};

  for (const agent of agents) {
    mappings[agent.id] = {};

    const agentEdges = edges.filter((e) => e.target === agent.id);
    for (const edge of agentEdges) {
      const inputField = edge.targetHandle?.replace("input-", "") ?? "";
      const sourceField = edge.sourceHandle?.replace("output-", "") ?? "";

      if (edge.source === "entry") {
        mappings[agent.id]![inputField] = {
          source: "dataset",
          sourceField,
        };
      }
    }
  }

  return mappings;
};

/**
 * Extract evaluator input mappings from edges.
 */
const extractEvaluatorMappings = (
  edges: Edge[],
  agents: AgentConfig[],
  _evaluatorNodes: Array<Node<Evaluator>>
): Record<string, Record<string, Record<string, FieldMapping>>> => {
  const mappings: Record<
    string,
    Record<string, Record<string, FieldMapping>>
  > = {};

  for (const agent of agents) {
    mappings[agent.id] = {};

    for (const evaluator of agent.evaluators) {
      const evaluatorNodeId = `${agent.id}.${evaluator.id}`;
      mappings[agent.id]![evaluator.id] = {};

      const evalEdges = edges.filter((e) => e.target === evaluatorNodeId);
      for (const edge of evalEdges) {
        const inputField = edge.targetHandle?.replace("input-", "") ?? "";
        const sourceField = edge.sourceHandle?.replace("output-", "") ?? "";

        if (edge.source === "entry") {
          mappings[agent.id]![evaluator.id]![inputField] = {
            source: "dataset",
            sourceField,
          };
        } else if (edge.source === agent.id) {
          mappings[agent.id]![evaluator.id]![inputField] = {
            source: agent.id,
            sourceField,
          };
        }
      }
    }
  }

  return mappings;
};
