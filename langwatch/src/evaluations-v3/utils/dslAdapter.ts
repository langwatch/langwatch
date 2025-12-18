/**
 * DSL Adapter for Evaluations V3
 *
 * Converts between the V3 UI state structure and the workflow DSL.
 * This allows us to save evaluations in the existing workflow format
 * while using a simpler UI-focused state structure.
 *
 * Key concepts:
 * - Evaluators are global/shared in state - agents reference them by ID
 * - When saving to DSL, evaluators are duplicated per-agent with {agentId}.{evaluatorId} naming
 * - When loading from DSL, evaluators are deduplicated back into global definitions
 * - Mappings: agent.mappings for agent inputs, evaluator.mappings[agentId] for evaluator inputs
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
 * Evaluators are duplicated per-agent with clear naming for result mapping.
 */
export const stateToWorkflow = (state: EvaluationsV3State): Workflow => {
  const entryNode = createEntryNode(state.dataset);

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

  const agentEdges = buildAgentEdges(state.agents);
  const evaluatorEdges = buildEvaluatorEdges(state.agents, state.evaluators);

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
 */
const buildAgentEdges = (agents: AgentConfig[]): Edge[] => {
  const edges: Edge[] = [];

  for (const agent of agents) {
    for (const [inputField, mapping] of Object.entries(agent.mappings)) {
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
 * Mappings are stored inside evaluator.mappings[agentId].
 */
const buildEvaluatorEdges = (
  agents: AgentConfig[],
  evaluators: EvaluatorConfig[]
): Edge[] => {
  const edges: Edge[] = [];

  for (const agent of agents) {
    for (const evaluatorId of agent.evaluatorIds) {
      const evaluator = evaluators.find((e) => e.id === evaluatorId);
      if (!evaluator) continue;

      const agentMappings = evaluator.mappings[agent.id] ?? {};
      const evaluatorNodeId = `${agent.id}.${evaluator.id}`;

      for (const [inputField, mapping] of Object.entries(agentMappings)) {
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
 * Evaluators are deduplicated - same evaluator type+settings become one global definition.
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

  // Extract global evaluators (deduplicated by evaluator ID within agent)
  // and build per-agent mappings
  const { evaluators, evaluatorsByAgent } = extractGlobalEvaluators(
    evaluatorNodes,
    workflow.edges,
    agentNodes.map((n) => n.id)
  );

  // Build agents with their evaluatorIds and mappings
  const agents: AgentConfig[] = agentNodes.map((node) =>
    extractAgent(node, evaluatorsByAgent[node.id] ?? [], workflow.edges)
  );

  return {
    name: workflow.name,
    dataset,
    evaluators,
    agents,
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
 * Extract global evaluators from evaluator nodes.
 * Deduplicates by evaluator ID (the part after the agent ID prefix).
 * Returns evaluators with per-agent mappings and a mapping of which evaluators each agent has.
 */
const extractGlobalEvaluators = (
  evaluatorNodes: Array<Node<Evaluator>>,
  edges: Edge[],
  agentIds: string[]
): {
  evaluators: EvaluatorConfig[];
  evaluatorsByAgent: Record<string, string[]>;
} => {
  const evaluatorsMap = new Map<string, EvaluatorConfig>();
  const evaluatorsByAgent: Record<string, string[]> = {};

  for (const agentId of agentIds) {
    evaluatorsByAgent[agentId] = [];
  }

  for (const node of evaluatorNodes) {
    // Parse the node ID to get agentId and evaluatorId
    // Format: {agentId}.{evaluatorId}
    const dotIndex = node.id.indexOf(".");
    if (dotIndex === -1) continue;

    const agentId = node.id.substring(0, dotIndex);
    const evaluatorId = node.id.substring(dotIndex + 1);

    if (!agentIds.includes(agentId)) continue;

    // Add to agent's evaluator list
    if (!evaluatorsByAgent[agentId]!.includes(evaluatorId)) {
      evaluatorsByAgent[agentId]!.push(evaluatorId);
    }

    // Extract evaluator config
    const { name, inputs, evaluator, cls, outputs, ...settings } = node.data;

    // Get or create the global evaluator
    if (!evaluatorsMap.has(evaluatorId)) {
      evaluatorsMap.set(evaluatorId, {
        id: evaluatorId,
        evaluatorType:
          (evaluator as EvaluatorConfig["evaluatorType"]) ?? "custom/unknown",
        name: name ?? evaluatorId,
        settings,
        inputs: inputs ?? [],
        mappings: {},
      });
    }

    // Extract mappings for this agent from edges
    const evalConfig = evaluatorsMap.get(evaluatorId)!;
    const evalEdges = edges.filter((e) => e.target === node.id);

    evalConfig.mappings[agentId] = {};

    for (const edge of evalEdges) {
      const inputField = edge.targetHandle?.replace("input-", "") ?? "";
      const sourceField = edge.sourceHandle?.replace("output-", "") ?? "";

      if (edge.source === "entry") {
        evalConfig.mappings[agentId]![inputField] = {
          source: "dataset",
          sourceField,
        };
      } else if (edge.source === agentId) {
        evalConfig.mappings[agentId]![inputField] = {
          source: agentId,
          sourceField,
        };
      }
    }
  }

  return {
    evaluators: Array.from(evaluatorsMap.values()),
    evaluatorsByAgent,
  };
};

/**
 * Extract agent config from a signature or code node.
 */
const extractAgent = (
  node: Node<Signature> | Node<Code>,
  evaluatorIds: string[],
  edges: Edge[]
): AgentConfig => {
  const params = node.data.parameters ?? [];
  const llmParam = params.find((p: Field) => p.identifier === "llm");
  const instructionsParam = params.find(
    (p: Field) => p.identifier === "instructions"
  );
  const messagesParam = params.find((p: Field) => p.identifier === "messages");
  const codeParam = params.find((p: Field) => p.identifier === "code");

  // Extract agent input mappings from edges
  const mappings = extractAgentMappings(node.id, edges);

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
      mappings,
      evaluatorIds,
    };
  } else {
    return {
      id: node.id,
      type: "code",
      name: node.data.name ?? node.id,
      inputs: node.data.inputs ?? [],
      outputs: node.data.outputs ?? [],
      code: codeParam?.value as string | undefined,
      mappings,
      evaluatorIds,
    };
  }
};

/**
 * Extract agent input mappings from edges.
 */
const extractAgentMappings = (
  agentId: string,
  edges: Edge[]
): Record<string, FieldMapping> => {
  const mappings: Record<string, FieldMapping> = {};

  const agentEdges = edges.filter((e) => e.target === agentId);
  for (const edge of agentEdges) {
    const inputField = edge.targetHandle?.replace("input-", "") ?? "";
    const sourceField = edge.sourceHandle?.replace("output-", "") ?? "";

    if (edge.source === "entry") {
      mappings[inputField] = {
        source: "dataset",
        sourceField,
      };
    }
  }

  return mappings;
};
