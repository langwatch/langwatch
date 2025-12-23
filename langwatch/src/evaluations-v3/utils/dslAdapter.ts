/**
 * DSL Adapter for Evaluations V3
 *
 * Converts V3 UI state to the workflow DSL for execution.
 * This is a one-way conversion - state is persisted via wizardState, not DSL.
 *
 * Key concepts:
 * - Evaluators are global/shared in state - agents reference them by ID
 * - When generating DSL, evaluators are duplicated per-agent with {agentId}.{evaluatorId} naming
 * - Mappings: agent.mappings for agent inputs, evaluator.mappings[agentId] for evaluator inputs
 * - Multi-dataset: DSL is generated for the active dataset only
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
  DatasetColumn,
  DatasetReference,
  EvaluationsV3State,
  EvaluatorConfig,
  InlineDataset,
} from "../types";

// ============================================================================
// State to Workflow (for execution)
// ============================================================================

/**
 * Convert V3 state to workflow DSL for execution.
 * Uses the active dataset for generating the entry node.
 * Evaluators are duplicated per-agent with clear naming for result mapping.
 *
 * @param state - The current evaluations V3 state
 * @param datasetIdOverride - Optional dataset ID to use instead of activeDatasetId
 * @returns The workflow DSL ready for execution
 */
export const stateToWorkflow = (
  state: EvaluationsV3State,
  datasetIdOverride?: string
): Workflow => {
  const datasetId = datasetIdOverride ?? state.activeDatasetId;
  const activeDataset = state.datasets.find((d) => d.id === datasetId);

  if (!activeDataset) {
    throw new Error(`Dataset with id ${datasetId} not found`);
  }

  const entryNode = createEntryNode(activeDataset);

  const agentNodes: Array<Node<Signature> | Node<Code>> = [];
  const evaluatorNodes: Array<Node<Evaluator>> = [];

  // Create agent nodes
  state.agents.forEach((agent, agentIndex) => {
    const agentNode =
      agent.type === "llm"
        ? createSignatureNode(agent, agentIndex)
        : createCodeNode(agent, agentIndex);

    agentNodes.push(agentNode);

    // Create evaluator nodes for each evaluator this agent uses
    // Evaluators are duplicated per-agent in the DSL
    agent.evaluatorIds.forEach((evaluatorId, evalIndex) => {
      const evaluator = state.evaluators.find((e) => e.id === evaluatorId);
      if (!evaluator) return;

      const evaluatorNode = createEvaluatorNode(
        evaluator,
        agent.id,
        agentIndex,
        evalIndex
      );
      evaluatorNodes.push(evaluatorNode);
    });
  });

  const agentEdges = buildAgentEdges(state.agents, datasetId);
  const evaluatorEdges = buildEvaluatorEdges(
    state.agents,
    state.evaluators,
    datasetId
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
 * Create the entry node from the active dataset.
 */
const createEntryNode = (dataset: DatasetReference): Node<Entry> => {
  const outputs: Field[] = dataset.columns.map((col) => ({
    identifier: col.id,
    type: columnTypeToFieldType(col.type),
  }));

  return {
    id: "entry",
    type: "entry",
    data: {
      name: dataset.name,
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
 * Convert dataset column type to DSL field type.
 */
const columnTypeToFieldType = (
  colType: DatasetColumn["type"]
): Field["type"] => {
  switch (colType) {
    case "string":
      return "str";
    case "number":
      return "float";
    default:
      return "str";
  }
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
 * Node ID is {agentId}.{evaluatorId} for clear result mapping back to the table.
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
      name: `${evaluator.name}`,
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
 * Build edges connecting entry to agents based on agent.mappings.
 * Only creates edges for mappings that reference the active dataset.
 */
const buildAgentEdges = (
  agents: AgentConfig[],
  activeDatasetId: string
): Edge[] => {
  const edges: Edge[] = [];

  for (const agent of agents) {
    for (const [inputField, mapping] of Object.entries(agent.mappings)) {
      if (
        mapping.source === "dataset" &&
        mapping.sourceId === activeDatasetId
      ) {
        edges.push({
          id: `entry->${agent.id}.${inputField}`,
          source: "entry",
          sourceHandle: `output-${mapping.sourceField}`,
          target: agent.id,
          targetHandle: `input-${inputField}`,
        });
      } else if (mapping.source === "agent") {
        // Agent-to-agent mapping
        edges.push({
          id: `${mapping.sourceId}->${agent.id}.${inputField}`,
          source: mapping.sourceId,
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
 * Mappings are stored inside evaluator.mappings[agentId].
 * Only creates edges for mappings that reference the active dataset.
 */
const buildEvaluatorEdges = (
  agents: AgentConfig[],
  evaluators: EvaluatorConfig[],
  activeDatasetId: string
): Edge[] => {
  const edges: Edge[] = [];

  for (const agent of agents) {
    for (const evaluatorId of agent.evaluatorIds) {
      const evaluator = evaluators.find((e) => e.id === evaluatorId);
      if (!evaluator) continue;

      const agentMappings = evaluator.mappings[agent.id] ?? {};
      const evaluatorNodeId = `${agent.id}.${evaluator.id}`;

      for (const [inputField, mapping] of Object.entries(agentMappings)) {
        if (
          mapping.source === "dataset" &&
          mapping.sourceId === activeDatasetId
        ) {
          // From dataset
          edges.push({
            id: `entry->${evaluatorNodeId}.${inputField}`,
            source: "entry",
            sourceHandle: `output-${mapping.sourceField}`,
            target: evaluatorNodeId,
            targetHandle: `input-${inputField}`,
          });
        } else if (
          mapping.source === "agent" &&
          mapping.sourceId === agent.id
        ) {
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
// Helper: Get inline dataset data for execution
// ============================================================================

/**
 * Get the inline dataset data for execution.
 * For saved datasets, this would need to be fetched from the database separately.
 */
export const getActiveDatasetData = (
  state: EvaluationsV3State
): InlineDataset | undefined => {
  const activeDataset = state.datasets.find(
    (d) => d.id === state.activeDatasetId
  );
  if (!activeDataset || activeDataset.type !== "inline") {
    return undefined;
  }
  return activeDataset.inline;
};
