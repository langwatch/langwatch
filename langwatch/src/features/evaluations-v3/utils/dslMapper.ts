/**
 * DSL Mapper
 *
 * Utilities to convert between Evaluation V3 state and the Workflow DSL.
 * This allows seamless integration with the existing backend.
 */

import { nanoid } from "nanoid";
import type { Edge, Node } from "@xyflow/react";
import type {
  Workflow,
  Entry,
  Signature,
  LlmPromptConfigComponent,
  Code,
  Evaluator as DSLEvaluator,
  End,
  Field,
  NodeDataset,
  LLMConfig,
} from "../../../optimization_studio/types/dsl";
import { DEFAULT_MAX_TOKENS } from "../../../optimization_studio/utils/registryUtils";
import type {
  EvaluationV3State,
  Agent,
  LLMAgent,
  CodeAgent,
  Evaluator,
  DatasetColumn,
  MappingSource,
} from "../types";
import { buildEvaluatorFromType } from "../../../optimization_studio/utils/registryUtils";
import type { EvaluatorDefinition, EvaluatorTypes } from "../../../server/evaluations/evaluators.generated";

// ============================================================================
// State to DSL Conversion
// ============================================================================

/**
 * Convert Evaluation V3 state to Workflow DSL
 */
export const stateToDSL = (
  state: EvaluationV3State,
  availableEvaluators?: Record<string, EvaluatorDefinition<EvaluatorTypes>>
): Workflow => {
  const nodes: Workflow["nodes"] = [];
  const edges: Workflow["edges"] = [];

  // 1. Create Entry node from dataset
  const entryNode = createEntryNode(state);
  nodes.push(entryNode);

  // 2. Create End node
  const endNode = createEndNode(state);
  nodes.push(endNode);

  // 3. Create agent nodes (signature or code)
  let xOffset = 300;
  for (const agent of state.agents) {
    const agentNode = createAgentNode(agent, xOffset);
    nodes.push(agentNode);

    // Create edges from entry to agent
    const agentMapping = state.agentMappings.find((m) => m.agentId === agent.id);
    if (agentMapping) {
      for (const [inputId, source] of Object.entries(agentMapping.inputMappings)) {
        if (!source) continue;
        if (source.type === "dataset") {
          edges.push({
            id: `edge_${nanoid()}`,
            source: "entry",
            sourceHandle: `outputs.${source.columnId}`,
            target: agent.id,
            targetHandle: `inputs.${inputId}`,
            type: "default",
          });
        }
      }
    }

    // Create edges from agent to end node
    for (const output of agent.outputs) {
      edges.push({
        id: `edge_${nanoid()}`,
        source: agent.id,
        sourceHandle: `outputs.${output.identifier}`,
        target: "end",
        targetHandle: `inputs.${agent.id}_${output.identifier}`,
        type: "default",
      });
    }

    xOffset += 300;
  }

  // 4. Create evaluator nodes
  let yOffset = 200;
  for (const evaluator of state.evaluators) {
    const evaluatorDef = availableEvaluators?.[evaluator.type];
    const evaluatorNode = createEvaluatorNode(evaluator, evaluatorDef, xOffset, yOffset);
    nodes.push(evaluatorNode);

    // Create edges to evaluator from agents and dataset
    const evalMapping = state.evaluatorMappings.find(
      (m) => m.evaluatorId === evaluator.id
    );

    if (evalMapping) {
      // For each agent, create mappings
      for (const agent of state.agents) {
        const agentMapping = evalMapping.agentMappings[agent.id];
        if (!agentMapping) continue;

        for (const [inputId, source] of Object.entries(agentMapping)) {
          if (!source) continue;

          if (source.type === "dataset") {
            edges.push({
              id: `edge_${nanoid()}`,
              source: "entry",
              sourceHandle: `outputs.${source.columnId}`,
              target: evaluator.id,
              targetHandle: `inputs.${inputId}`,
              type: "default",
              // Mark this as a per-agent edge
              data: { agentId: agent.id },
            });
          } else if (source.type === "agent") {
            edges.push({
              id: `edge_${nanoid()}`,
              source: source.agentId,
              sourceHandle: `outputs.${source.outputId}`,
              target: evaluator.id,
              targetHandle: `inputs.${inputId}`,
              type: "default",
              data: { agentId: agent.id },
            });
          }
        }
      }
    }

    yOffset += 150;
  }

  // Update end node inputs based on all agents
  const endInputs: Field[] = [];
  for (const agent of state.agents) {
    for (const output of agent.outputs) {
      endInputs.push({
        identifier: `${agent.id}_${output.identifier}`,
        type: output.type,
      });
    }
  }
  (endNode.data as End).inputs = endInputs;

  return {
    spec_version: "1.4",
    workflow_id: state.workflowId,
    experiment_id: state.experimentId,
    name: state.name,
    icon: "📊",
    description: "Evaluation workflow created from Evaluations V3",
    version: "1.0",
    default_llm: {
      model: "openai/gpt-5",
      temperature: 1,
      max_tokens: DEFAULT_MAX_TOKENS,
    },
    template_adapter: "default",
    enable_tracing: true,
    workflow_type: "workflow",
    nodes,
    edges,
    state: {},
  };
};

const createEntryNode = (state: EvaluationV3State): Node<Entry> => {
  const columns = state.dataset.columns;
  const outputs: Field[] = columns.map((col) => ({
    identifier: col.id,
    type: columnTypeToFieldType(col.type),
  }));

  let dataset: NodeDataset;
  if (state.dataset.type === "inline") {
    const records: Record<string, string[]> = {};
    for (const col of columns) {
      records[col.id] = state.dataset.rows.map(
        (row) => String(row.values[col.id] ?? "")
      );
    }
    dataset = {
      name: state.dataset.name,
      inline: {
        records,
        columnTypes: columns.map((col) => ({
          id: col.id,
          name: col.name,
          type: col.type,
        })),
      },
    };
  } else {
    dataset = {
      id: state.dataset.id,
      name: state.dataset.name,
    };
  }

  return {
    id: "entry",
    type: "entry",
    position: { x: 0, y: 0 },
    deletable: false,
    data: {
      name: "Entry",
      outputs,
      entry_selection: "first",
      train_size: 0.8,
      test_size: 0.2,
      seed: 42,
      dataset,
    },
  };
};

const createEndNode = (state: EvaluationV3State): Node<End> => {
  return {
    id: "end",
    type: "end",
    position: { x: 900, y: 0 },
    deletable: false,
    data: {
      name: "End",
      inputs: [],
    },
  };
};

const createAgentNode = (
  agent: Agent,
  xOffset: number
): Node<LlmPromptConfigComponent | Code> => {
  if (agent.type === "llm") {
    return createLLMAgentNode(agent, xOffset);
  } else {
    return createCodeAgentNode(agent, xOffset);
  }
};

const createLLMAgentNode = (
  agent: LLMAgent,
  xOffset: number
): Node<LlmPromptConfigComponent> => {
  return {
    id: agent.id,
    type: "signature",
    position: { x: xOffset, y: 0 },
    data: {
      name: agent.name,
      configId: agent.promptConfigId,
      versionMetadata: agent.promptVersionId
        ? {
            versionId: agent.promptVersionId,
            versionNumber: 1,
            versionCreatedAt: new Date().toISOString(),
          }
        : undefined,
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: agent.llmConfig,
        },
        {
          identifier: "messages",
          type: "chat_messages",
          value: agent.messages,
        },
      ],
      inputs: agent.inputs as LlmPromptConfigComponent["inputs"],
      outputs: agent.outputs as LlmPromptConfigComponent["outputs"],
    },
  };
};

const createCodeAgentNode = (
  agent: CodeAgent,
  xOffset: number
): Node<Code> => {
  return {
    id: agent.id,
    type: "code",
    position: { x: xOffset, y: 0 },
    data: {
      name: agent.name,
      cls: "CustomModule",
      parameters: [
        {
          identifier: "code",
          type: "code",
          value: agent.code,
        },
      ],
      inputs: agent.inputs,
      outputs: agent.outputs,
    },
  };
};

const createEvaluatorNode = (
  evaluator: Evaluator,
  evaluatorDef: EvaluatorDefinition<EvaluatorTypes> | undefined,
  x: number,
  y: number
): Node<DSLEvaluator> => {
  return {
    id: evaluator.id,
    type: "evaluator",
    position: { x, y },
    data: {
      name: evaluator.name,
      cls: "evaluator",
      evaluator: evaluator.type,
      parameters: Object.entries(evaluator.settings).map(([key, value]) => ({
        identifier: key,
        type: "str" as const,
        value,
      })),
      inputs: evaluator.inputs,
      outputs: evaluatorDef?.result
        ? Object.entries(evaluatorDef.result).map(([key, val]) => ({
            identifier: key,
            type: key === "passed" ? "bool" : key === "score" ? "float" : "str",
            desc: (val as { description: string }).description,
          }))
        : [],
    },
  };
};

// ============================================================================
// DSL to State Conversion
// ============================================================================

/**
 * Convert Workflow DSL to Evaluation V3 state
 */
export const dslToState = (
  dsl: Workflow,
  availableEvaluators?: Record<string, EvaluatorDefinition<EvaluatorTypes>>
): Partial<EvaluationV3State> => {
  const entryNode = dsl.nodes.find((n) => n.type === "entry") as
    | Node<Entry>
    | undefined;
  const agentNodes = dsl.nodes.filter(
    (n) => n.type === "signature" || n.type === "code"
  );
  const evaluatorNodes = dsl.nodes.filter(
    (n) => n.type === "evaluator"
  ) as Node<DSLEvaluator>[];

  // Parse dataset
  const dataset = parseDataset(entryNode);

  // Parse agents
  const agents = agentNodes.map((node) => parseAgent(node));

  // Parse evaluators
  const evaluators = evaluatorNodes.map((node) =>
    parseEvaluator(node, availableEvaluators)
  );

  // Parse mappings from edges
  const agentMappings = parseAgentMappings(dsl.edges, agents, dataset.columns);
  const evaluatorMappings = parseEvaluatorMappings(
    dsl.edges,
    evaluators,
    agents,
    dataset.columns
  );

  return {
    name: dsl.name,
    workflowId: dsl.workflow_id,
    experimentId: dsl.experiment_id,
    dataset,
    agents,
    evaluators,
    agentMappings,
    evaluatorMappings,
  };
};

const parseDataset = (
  entryNode: Node<Entry> | undefined
): EvaluationV3State["dataset"] => {
  if (!entryNode?.data.dataset) {
    return {
      type: "inline",
      name: "Draft Dataset",
      columns: [
        { id: "input", name: "input", type: "string" },
        { id: "expected_output", name: "expected_output", type: "string" },
      ],
      rows: [],
    };
  }

  const nodeDataset = entryNode.data.dataset;

  if (nodeDataset.inline) {
    const columns: DatasetColumn[] =
      nodeDataset.inline.columnTypes?.map((ct) => ({
        id: ct.id ?? ct.name,
        name: ct.name,
        type: ct.type,
      })) ??
      Object.keys(nodeDataset.inline.records).map((key) => ({
        id: key,
        name: key,
        type: "string" as const,
      }));

    const rowCount = Math.max(
      ...Object.values(nodeDataset.inline.records).map((arr) => arr.length),
      0
    );

    const rows = Array.from({ length: rowCount }, (_, i) => ({
      id: `row_${i}`,
      values: Object.fromEntries(
        columns.map((col) => [
          col.id,
          nodeDataset.inline!.records[col.id]?.[i] ?? "",
        ])
      ),
    }));

    return {
      type: "inline",
      name: nodeDataset.name ?? "Draft Dataset",
      columns,
      rows,
    };
  }

  // Saved dataset
  return {
    type: "saved",
    id: nodeDataset.id!,
    name: nodeDataset.name ?? "Dataset",
    columns:
      entryNode.data.outputs?.map((out) => ({
        id: out.identifier,
        name: out.identifier,
        type: fieldTypeToColumnType(out.type),
      })) ?? [],
  };
};

const parseAgent = (node: Node): Agent => {
  if (node.type === "signature") {
    const data = node.data as Signature;
    const llmParam = data.parameters?.find((p) => p.identifier === "llm");
    const messagesParam = data.parameters?.find(
      (p) => p.identifier === "messages"
    );

    return {
      id: node.id,
      type: "llm",
      name: data.name ?? "Agent",
      model: (llmParam?.value as LLMConfig)?.model ?? "openai/gpt-5",
      llmConfig: (llmParam?.value as LLMConfig) ?? {
        model: "openai/gpt-5",
        temperature: 1,
        max_tokens: DEFAULT_MAX_TOKENS,
      },
      messages: (messagesParam?.value as LLMAgent["messages"]) ?? [
        { role: "user", content: "" },
      ],
      inputs: (data.inputs ?? []) as Field[],
      outputs: (data.outputs ?? []) as Field[],
    };
  }

  // Code node
  const data = node.data as Code;
  const codeParam = data.parameters?.find((p) => p.identifier === "code");

  return {
    id: node.id,
    type: "code",
    name: data.name ?? "Code Agent",
    code: (codeParam?.value as string) ?? "",
    inputs: (data.inputs ?? []) as Field[],
    outputs: (data.outputs ?? []) as Field[],
  };
};

const parseEvaluator = (
  node: Node<DSLEvaluator>,
  availableEvaluators?: Record<string, EvaluatorDefinition<EvaluatorTypes>>
): Evaluator => {
  const data = node.data;
  const evaluatorType = (data.evaluator ?? "langevals/basic/semantic_similarity") as Evaluator["type"];
  const evaluatorDef = availableEvaluators?.[evaluatorType];

  return {
    id: node.id,
    type: evaluatorType,
    name: data.name ?? evaluatorDef?.name ?? "Evaluator",
    category: (evaluatorDef?.category ?? "quality") as Evaluator["category"],
    settings: Object.fromEntries(
      (data.parameters ?? []).map((p) => [p.identifier, p.value])
    ),
    inputs: (data.inputs ?? []) as Field[],
  };
};

const parseAgentMappings = (
  edges: Edge[],
  agents: Agent[],
  columns: DatasetColumn[]
): EvaluationV3State["agentMappings"] => {
  return agents.map((agent) => {
    const inputMappings: Record<string, MappingSource | null> = {};

    for (const input of agent.inputs) {
      const edge = edges.find(
        (e) =>
          e.target === agent.id &&
          e.targetHandle === `inputs.${input.identifier}`
      );

      if (edge) {
        if (edge.source === "entry") {
          const sourceHandle = edge.sourceHandle?.replace("outputs.", "");
          const column = columns.find((c) => c.id === sourceHandle);
          if (column) {
            inputMappings[input.identifier] = {
              type: "dataset",
              columnId: column.id,
            };
          }
        }
      }
    }

    return {
      agentId: agent.id,
      inputMappings,
    };
  });
};

const parseEvaluatorMappings = (
  edges: Edge[],
  evaluators: Evaluator[],
  agents: Agent[],
  columns: DatasetColumn[]
): EvaluationV3State["evaluatorMappings"] => {
  return evaluators.map((evaluator) => {
    const agentMappings: Record<string, Record<string, MappingSource | null>> =
      {};

    for (const agent of agents) {
      const inputMappings: Record<string, MappingSource | null> = {};

      for (const input of evaluator.inputs) {
        const edge = edges.find(
          (e) =>
            e.target === evaluator.id &&
            e.targetHandle === `inputs.${input.identifier}` &&
            ((e.data as { agentId?: string })?.agentId === agent.id ||
              e.source === agent.id ||
              e.source === "entry")
        );

        if (edge) {
          if (edge.source === "entry") {
            const sourceHandle = edge.sourceHandle?.replace("outputs.", "");
            const column = columns.find((c) => c.id === sourceHandle);
            if (column) {
              inputMappings[input.identifier] = {
                type: "dataset",
                columnId: column.id,
              };
            }
          } else {
            const sourceHandle = edge.sourceHandle?.replace("outputs.", "");
            inputMappings[input.identifier] = {
              type: "agent",
              agentId: edge.source,
              outputId: sourceHandle ?? "",
            };
          }
        }
      }

      agentMappings[agent.id] = inputMappings;
    }

    return {
      evaluatorId: evaluator.id,
      agentMappings,
    };
  });
};

// ============================================================================
// Helpers
// ============================================================================

const columnTypeToFieldType = (
  type: DatasetColumn["type"]
): Field["type"] => {
  switch (type) {
    case "number":
      return "float";
    case "boolean":
      return "bool";
    case "date":
      return "str";
    case "list":
      return "list";
    case "json":
      return "dict";
    case "chat_messages":
      return "chat_messages";
    case "image":
      return "image";
    case "string":
    default:
      return "str";
  }
};

const fieldTypeToColumnType = (
  type: Field["type"]
): DatasetColumn["type"] => {
  switch (type) {
    case "float":
    case "int":
      return "number";
    case "bool":
      return "boolean";
    case "list":
    case "list[str]":
    case "list[float]":
    case "list[int]":
    case "list[bool]":
      return "list";
    case "dict":
    case "json_schema":
      return "json";
    case "chat_messages":
      return "chat_messages";
    case "image":
      return "image";
    case "str":
    default:
      return "string";
  }
};

