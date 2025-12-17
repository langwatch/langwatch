import type { Edge, Node } from "@xyflow/react";
import { nanoid } from "nanoid";

import type {
  Code,
  Entry,
  Evaluator,
  Field,
  NodeDataset,
  Signature,
  Workflow,
} from "~/optimization_studio/types/dsl";
import { DEFAULT_MAX_TOKENS } from "~/optimization_studio/utils/registryUtils";
import { DEFAULT_MODEL } from "~/utils/constants";

import type {
  AgentConfig,
  DatasetColumn,
  EvaluationsV3State,
  EvaluatorConfig,
  FieldMapping,
  InlineDataset,
} from "../types";

// ============================================================================
// State → DSL Conversion
// ============================================================================

/**
 * Convert dataset columns to workflow fields.
 */
const columnsToFields = (columns: DatasetColumn[]): Field[] => {
  return columns.map((col) => ({
    identifier: col.name,
    type: col.type === "string" ? "str" : col.type === "number" ? "float" : "str",
  }));
};

/**
 * Convert inline dataset to NodeDataset format.
 */
const datasetToNodeDataset = (dataset: InlineDataset): NodeDataset => {
  if (dataset.id) {
    // Saved dataset - just reference by ID
    return {
      id: dataset.id,
      name: dataset.name,
    };
  }

  // Inline dataset - include records
  return {
    name: dataset.name,
    inline: {
      records: dataset.records,
      columnTypes: dataset.columns.map((col) => ({
        name: col.name,
        type: col.type,
      })),
    },
  };
};

/**
 * Create entry node from dataset.
 */
const createEntryNode = (dataset: InlineDataset): Node<Entry> => ({
  id: "entry",
  type: "entry",
  position: { x: 0, y: 0 },
  deletable: false,
  data: {
    name: "Entry",
    outputs: columnsToFields(dataset.columns),
    entry_selection: "first",
    train_size: 0.8,
    test_size: 0.2,
    seed: 42,
    dataset: datasetToNodeDataset(dataset),
  },
});

/**
 * Create signature (LLM) node from agent config.
 */
const createSignatureNode = (
  agent: AgentConfig,
  index: number
): Node<Signature> => ({
  id: agent.id,
  type: "signature",
  position: { x: 300, y: index * 150 },
  data: {
    name: agent.name,
    parameters: [
      {
        identifier: "llm",
        type: "llm",
        value: agent.llmConfig ?? { model: DEFAULT_MODEL },
      },
      {
        identifier: "prompting_technique",
        type: "prompting_technique",
        value: undefined,
      },
      {
        identifier: "instructions",
        type: "str",
        value: agent.instructions ?? "",
      },
      {
        identifier: "messages",
        type: "chat_messages",
        value: agent.messages ?? [{ role: "user", content: "{{input}}" }],
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: undefined,
      },
    ],
    inputs: agent.inputs,
    outputs: agent.outputs,
  },
});

/**
 * Create code node from agent config.
 */
const createCodeNode = (agent: AgentConfig, index: number): Node<Code> => ({
  id: agent.id,
  type: "code",
  position: { x: 300, y: index * 150 },
  data: {
    name: agent.name,
    parameters: [
      {
        identifier: "code",
        type: "code",
        value: agent.code ?? "",
      },
    ],
    inputs: agent.inputs,
    outputs: agent.outputs,
  },
});

/**
 * Create evaluator node from evaluator config.
 */
const createEvaluatorNode = (
  evaluator: EvaluatorConfig,
  index: number
): Node<Evaluator> => ({
  id: evaluator.id,
  type: "evaluator",
  position: { x: 600, y: index * 150 },
  data: {
    name: evaluator.name,
    cls: "LangWatchEvaluator",
    evaluator: evaluator.evaluatorType,
    parameters: Object.entries(evaluator.settings).map(([key, value]) => ({
      identifier: key,
      type: "str",
      value,
    })),
    inputs: evaluator.inputs,
    outputs: [
      { identifier: "passed", type: "bool" },
      { identifier: "score", type: "float" },
    ],
  },
});

/**
 * Build edges from agent mappings.
 */
const buildAgentEdges = (
  agents: AgentConfig[],
  agentMappings: Record<string, Record<string, FieldMapping>>
): Edge[] => {
  const edges: Edge[] = [];

  for (const agent of agents) {
    const mappings = agentMappings[agent.id] ?? {};

    for (const [inputField, mapping] of Object.entries(mappings)) {
      const sourceId = mapping.source === "dataset" ? "entry" : mapping.source;
      const sourceHandle =
        mapping.source === "dataset"
          ? `outputs.${mapping.sourceField}`
          : `outputs.${mapping.sourceField}`;

      edges.push({
        id: `edge-${nanoid()}`,
        source: sourceId,
        sourceHandle,
        target: agent.id,
        targetHandle: `inputs.${inputField}`,
        type: "default",
      });
    }
  }

  return edges;
};

/**
 * Build edges from evaluator mappings.
 */
const buildEvaluatorEdges = (
  evaluators: EvaluatorConfig[],
  evaluatorMappings: Record<string, Record<string, FieldMapping>>,
  agents: AgentConfig[]
): Edge[] => {
  const edges: Edge[] = [];

  for (const evaluator of evaluators) {
    const mappings = evaluatorMappings[evaluator.id] ?? {};

    for (const [inputField, mapping] of Object.entries(mappings)) {
      const sourceId = mapping.source === "dataset" ? "entry" : mapping.source;
      const sourceHandle =
        mapping.source === "dataset"
          ? `outputs.${mapping.sourceField}`
          : `outputs.${mapping.sourceField}`;

      edges.push({
        id: `edge-${nanoid()}`,
        source: sourceId,
        sourceHandle,
        target: evaluator.id,
        targetHandle: `inputs.${inputField}`,
        type: "default",
      });
    }
  }

  return edges;
};

/**
 * Convert V3 state to Workflow DSL for saving/execution.
 */
export const stateToWorkflow = (state: EvaluationsV3State): Workflow => {
  const entryNode = createEntryNode(state.dataset);

  const agentNodes = state.agents.map((agent, index) =>
    agent.type === "llm"
      ? createSignatureNode(agent, index)
      : createCodeNode(agent, index)
  );

  const evaluatorNodes = state.evaluators.map((evaluator, index) =>
    createEvaluatorNode(evaluator, index)
  );

  const agentEdges = buildAgentEdges(state.agents, state.agentMappings);
  const evaluatorEdges = buildEvaluatorEdges(
    state.evaluators,
    state.evaluatorMappings,
    state.agents
  );

  return {
    spec_version: "1.4",
    workflow_id: undefined,
    experiment_id: state.experimentId,
    name: state.name,
    icon: "📊",
    description: "",
    version: "1.0",
    default_llm: {
      model: DEFAULT_MODEL,
      temperature: 1.0,
      max_tokens: DEFAULT_MAX_TOKENS,
    },
    template_adapter: "default",
    enable_tracing: true,
    workflow_type: "evaluator",
    nodes: [entryNode, ...agentNodes, ...evaluatorNodes] as Workflow["nodes"],
    edges: [...agentEdges, ...evaluatorEdges],
    state: {},
  };
};

// ============================================================================
// DSL → State Conversion
// ============================================================================

/**
 * Extract dataset from entry node.
 */
const extractDatasetFromEntry = (
  entryNode: Node<Entry> | undefined
): InlineDataset => {
  if (!entryNode?.data) {
    return {
      columns: [
        { id: "input", name: "input", type: "string" },
        { id: "expected_output", name: "expected_output", type: "string" },
      ],
      records: {
        input: ["", "", ""],
        expected_output: ["", "", ""],
      },
    };
  }

  const nodeDataset = entryNode.data.dataset;

  // If it's a saved dataset reference
  if (nodeDataset?.id) {
    return {
      id: nodeDataset.id,
      name: nodeDataset.name,
      columns:
        entryNode.data.outputs?.map((output) => ({
          id: output.identifier,
          name: output.identifier,
          type: "string" as const,
        })) ?? [],
      records: {},
    };
  }

  // If it's an inline dataset
  if (nodeDataset?.inline) {
    const columns: DatasetColumn[] =
      nodeDataset.inline.columnTypes?.map((col) => ({
        id: col.name,
        name: col.name,
        type: col.type,
      })) ?? [];

    return {
      name: nodeDataset.name,
      columns,
      records: nodeDataset.inline.records ?? {},
    };
  }

  // Default empty dataset
  return {
    columns:
      entryNode.data.outputs?.map((output) => ({
        id: output.identifier,
        name: output.identifier,
        type: "string" as const,
      })) ?? [],
    records: {},
  };
};

/**
 * Convert signature node to agent config.
 */
const signatureNodeToAgentConfig = (
  node: Node<Signature>
): AgentConfig => {
  const llmParam = node.data.parameters?.find((p) => p.identifier === "llm");
  const instructionsParam = node.data.parameters?.find(
    (p) => p.identifier === "instructions"
  );
  const messagesParam = node.data.parameters?.find(
    (p) => p.identifier === "messages"
  );

  return {
    id: node.id,
    type: "llm",
    name: node.data.name ?? "LLM Agent",
    llmConfig: llmParam?.value as AgentConfig["llmConfig"],
    instructions: instructionsParam?.value as string | undefined,
    messages: messagesParam?.value as AgentConfig["messages"],
    inputs: node.data.inputs ?? [],
    outputs: node.data.outputs ?? [],
  };
};

/**
 * Convert code node to agent config.
 */
const codeNodeToAgentConfig = (node: Node<Code>): AgentConfig => {
  const codeParam = node.data.parameters?.find((p) => p.identifier === "code");

  return {
    id: node.id,
    type: "code",
    name: node.data.name ?? "Code Agent",
    code: codeParam?.value as string | undefined,
    inputs: node.data.inputs ?? [],
    outputs: node.data.outputs ?? [],
  };
};

/**
 * Convert node to agent config based on type.
 */
const nodeToAgentConfig = (node: Node): AgentConfig => {
  if (node.type === "signature") {
    return signatureNodeToAgentConfig(node as Node<Signature>);
  }
  return codeNodeToAgentConfig(node as Node<Code>);
};

/**
 * Convert evaluator node to evaluator config.
 */
const nodeToEvaluatorConfig = (node: Node<Evaluator>): EvaluatorConfig => {
  const settings: Record<string, unknown> = {};

  for (const param of node.data.parameters ?? []) {
    settings[param.identifier] = param.value;
  }

  return {
    id: node.id,
    evaluatorType: node.data.evaluator ?? "langevals/exact_match",
    name: node.data.name ?? "Evaluator",
    settings,
    inputs: node.data.inputs ?? [],
  };
};

/**
 * Extract agent mappings from edges.
 */
const extractAgentMappings = (
  edges: Edge[],
  agentNodes: Node[]
): Record<string, Record<string, FieldMapping>> => {
  const agentIds = new Set(agentNodes.map((n) => n.id));
  const mappings: Record<string, Record<string, FieldMapping>> = {};

  for (const edge of edges) {
    if (!agentIds.has(edge.target)) continue;

    const inputField = edge.targetHandle?.replace("inputs.", "") ?? "";
    const sourceField = edge.sourceHandle?.replace("outputs.", "") ?? "";
    const source = edge.source === "entry" ? "dataset" : edge.source;

    if (!mappings[edge.target]) {
      mappings[edge.target] = {};
    }

    mappings[edge.target]![inputField] = {
      source,
      sourceField,
    };
  }

  return mappings;
};

/**
 * Extract evaluator mappings from edges.
 */
const extractEvaluatorMappings = (
  edges: Edge[],
  evaluatorNodes: Node[]
): Record<string, Record<string, FieldMapping>> => {
  const evaluatorIds = new Set(evaluatorNodes.map((n) => n.id));
  const mappings: Record<string, Record<string, FieldMapping>> = {};

  for (const edge of edges) {
    if (!evaluatorIds.has(edge.target)) continue;

    const inputField = edge.targetHandle?.replace("inputs.", "") ?? "";
    const sourceField = edge.sourceHandle?.replace("outputs.", "") ?? "";
    const source = edge.source === "entry" ? "dataset" : edge.source;

    if (!mappings[edge.target]) {
      mappings[edge.target] = {};
    }

    mappings[edge.target]![inputField] = {
      source,
      sourceField,
    };
  }

  return mappings;
};

/**
 * Convert Workflow DSL to V3 state on load.
 */
export const workflowToState = (
  workflow: Workflow
): Partial<EvaluationsV3State> => {
  const entryNode = workflow.nodes.find((n) => n.type === "entry") as
    | Node<Entry>
    | undefined;

  const agentNodes = workflow.nodes.filter(
    (n) => n.type === "signature" || n.type === "code"
  );

  const evaluatorNodes = workflow.nodes.filter(
    (n) => n.type === "evaluator"
  ) as Node<Evaluator>[];

  return {
    name: workflow.name,
    experimentId: workflow.experiment_id,
    dataset: extractDatasetFromEntry(entryNode),
    agents: agentNodes.map(nodeToAgentConfig),
    evaluators: evaluatorNodes.map(nodeToEvaluatorConfig),
    agentMappings: extractAgentMappings(workflow.edges, agentNodes),
    evaluatorMappings: extractEvaluatorMappings(workflow.edges, evaluatorNodes),
  };
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if two states have different data that would affect the DSL.
 * Used for dirty checking / autosave.
 */
export const hasStateChanged = (
  prev: EvaluationsV3State,
  current: EvaluationsV3State
): boolean => {
  // Compare datasets
  if (JSON.stringify(prev.dataset) !== JSON.stringify(current.dataset)) {
    return true;
  }

  // Compare agents
  if (JSON.stringify(prev.agents) !== JSON.stringify(current.agents)) {
    return true;
  }

  // Compare evaluators
  if (JSON.stringify(prev.evaluators) !== JSON.stringify(current.evaluators)) {
    return true;
  }

  // Compare mappings
  if (
    JSON.stringify(prev.agentMappings) !==
    JSON.stringify(current.agentMappings)
  ) {
    return true;
  }

  if (
    JSON.stringify(prev.evaluatorMappings) !==
    JSON.stringify(current.evaluatorMappings)
  ) {
    return true;
  }

  // Compare name
  if (prev.name !== current.name) {
    return true;
  }

  return false;
};
