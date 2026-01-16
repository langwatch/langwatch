import type { Node, Edge } from "@xyflow/react";
import { nanoid } from "nanoid";

import type {
  Workflow,
  Entry,
  Signature,
  Code,
  Evaluator,
  Field,
  LlmPromptConfigComponent,
  LLMConfig,
} from "~/optimization_studio/types/dsl";
import type { ChatMessage } from "~/server/tracer/types";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type {
  WorkflowBuilderInput,
  WorkflowBuilderOutput,
  ExecutionCell,
} from "./types";
import type {
  TargetConfig,
  EvaluatorConfig,
  FieldMapping,
  LocalPromptConfig,
} from "~/evaluations-v3/types";

// ============================================================================
// Main Workflow Builder
// ============================================================================

/**
 * Builds a mini-workflow for executing a single cell (row + target + evaluators).
 * 
 * The workflow structure:
 * - Entry node: Contains the single row of dataset data
 * - Target node: Either a signature (prompt) or code (agent) node
 * - Evaluator nodes: One per evaluator, connected to both entry and target
 */
export const buildCellWorkflow = (
  input: WorkflowBuilderInput,
  loadedData: {
    prompt?: VersionedPrompt;
    agent?: TypedAgent;
  }
): WorkflowBuilderOutput => {
  const { projectId, cell, datasetColumns } = input;
  const { targetConfig, evaluatorConfigs, datasetEntry, rowIndex } = cell;

  const workflowId = `eval_v3_${nanoid(8)}`;
  const traceId = `trace_${nanoid()}`;

  // Build entry node with the single row of data
  const entryNode = buildEntryNode(datasetColumns, datasetEntry);

  // Build target node
  const { targetNode, targetNodeId } = buildTargetNode(
    targetConfig,
    loadedData,
    cell
  );

  // Build evaluator nodes
  const { evaluatorNodes, evaluatorNodeIds } = buildEvaluatorNodes(
    evaluatorConfigs,
    targetConfig.id,
    cell
  );

  // Build edges
  const edges = buildEdges(
    entryNode.id,
    targetNodeId,
    targetConfig,
    evaluatorConfigs,
    evaluatorNodeIds,
    cell
  );

  const workflow: Workflow = {
    spec_version: "1.4",
    workflow_id: workflowId,
    name: `Evaluation V3 - Row ${rowIndex}`,
    icon: "🧪",
    description: `Single cell execution for row ${rowIndex}`,
    version: "1.0",
    default_llm: {
      model: "openai/gpt-4o-mini",
      temperature: 0,
      max_tokens: 2048,
    },
    template_adapter: "default",
    enable_tracing: true,
    nodes: [entryNode, targetNode, ...evaluatorNodes] as Workflow["nodes"],
    edges,
    state: {},
  };

  return {
    workflow,
    targetNodeId,
    evaluatorNodeIds,
  };
};

// ============================================================================
// Entry Node Builder
// ============================================================================

/**
 * Builds an entry node containing the dataset row data.
 */
const buildEntryNode = (
  columns: Array<{ id: string; name: string; type: string }>,
  datasetEntry: Record<string, unknown>
): Node<Entry> => {
  const outputs: Field[] = columns.map((col) => ({
    identifier: col.id,
    type: columnTypeToFieldType(col.type),
    value: datasetEntry[col.name] ?? datasetEntry[col.id] ?? "",
  }));

  return {
    id: "entry",
    type: "entry",
    position: { x: 0, y: 0 },
    data: {
      name: "Dataset Entry",
      outputs,
      entry_selection: "first",
      train_size: 1,
      test_size: 0,
      seed: 42,
      // Inline dataset with just this one row
      dataset: {
        inline: {
          records: Object.fromEntries(
            columns.map((col) => [
              col.id,
              [String(datasetEntry[col.name] ?? datasetEntry[col.id] ?? "")],
            ])
          ),
          columnTypes: columns.map((col) => ({
            name: col.name,
            type: col.type as "string" | "number",
          })),
        },
      },
    },
  };
};

// ============================================================================
// Target Node Builders
// ============================================================================

/**
 * Builds the target node based on whether it's a prompt or agent.
 */
const buildTargetNode = (
  targetConfig: TargetConfig,
  loadedData: { prompt?: VersionedPrompt; agent?: TypedAgent },
  cell: ExecutionCell
): { targetNode: Node<Signature | Code>; targetNodeId: string } => {
  const targetNodeId = targetConfig.id;

  if (targetConfig.type === "prompt") {
    // Use local config if available, otherwise use loaded prompt
    if (targetConfig.localPromptConfig) {
      return {
        targetNode: buildSignatureNodeFromLocalConfig(
          targetNodeId,
          targetConfig.name,
          targetConfig.localPromptConfig,
          targetConfig,
          cell
        ),
        targetNodeId,
      };
    } else if (loadedData.prompt) {
      return {
        targetNode: buildSignatureNodeFromPrompt(
          targetNodeId,
          loadedData.prompt,
          targetConfig,
          cell
        ),
        targetNodeId,
      };
    } else {
      throw new Error(
        `Prompt target ${targetConfig.id} has no local config and no loaded prompt`
      );
    }
  } else {
    // Agent/code target
    if (loadedData.agent) {
      return {
        targetNode: buildCodeNodeFromAgent(
          targetNodeId,
          loadedData.agent,
          targetConfig,
          cell
        ),
        targetNodeId,
      };
    } else {
      throw new Error(`Agent target ${targetConfig.id} has no loaded agent`);
    }
  }
};

/**
 * Builds a signature node from a VersionedPrompt (database prompt).
 */
export const buildSignatureNodeFromPrompt = (
  nodeId: string,
  prompt: VersionedPrompt,
  targetConfig: TargetConfig,
  cell: ExecutionCell
): Node<Signature> => {
  const inputs = (prompt.inputs ?? []).map((input) => ({
    identifier: input.identifier,
    type: input.type as Field["type"],
    // Apply value mappings
    value: getInputValue(input.identifier, targetConfig, cell),
  }));

  const outputs = (prompt.outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as Field["type"],
  }));

  const llmConfig: LLMConfig = {
    model: prompt.model,
    temperature: prompt.temperature,
    max_tokens: prompt.maxTokens,
  };

  const messages: ChatMessage[] = prompt.messages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  return {
    id: nodeId,
    type: "signature",
    position: { x: 200, y: 0 },
    data: {
      name: prompt.handle ?? prompt.name ?? "Prompt",
      inputs,
      outputs,
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: llmConfig,
        },
        {
          identifier: "instructions",
          type: "str",
          value: prompt.prompt,
        },
        {
          identifier: "messages",
          type: "chat_messages",
          value: messages,
        },
      ],
    } as LlmPromptConfigComponent,
  };
};

/**
 * Builds a signature node from LocalPromptConfig (unsaved local changes).
 */
export const buildSignatureNodeFromLocalConfig = (
  nodeId: string,
  name: string,
  localConfig: LocalPromptConfig,
  targetConfig: TargetConfig,
  cell: ExecutionCell
): Node<Signature> => {
  const inputs = localConfig.inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type as Field["type"],
    // Apply value mappings
    value: getInputValue(input.identifier, targetConfig, cell),
  }));

  const outputs = localConfig.outputs.map((output) => ({
    identifier: output.identifier,
    type: output.type as Field["type"],
  }));

  const llmConfig: LLMConfig = {
    model: localConfig.llm.model,
    temperature: localConfig.llm.temperature,
    max_tokens: localConfig.llm.maxTokens,
    litellm_params: localConfig.llm.litellmParams,
  };

  // Extract system prompt from messages if present
  const systemMessage = localConfig.messages.find((m) => m.role === "system");
  const nonSystemMessages = localConfig.messages.filter(
    (m) => m.role !== "system"
  );

  return {
    id: nodeId,
    type: "signature",
    position: { x: 200, y: 0 },
    data: {
      name,
      inputs,
      outputs,
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: llmConfig,
        },
        {
          identifier: "instructions",
          type: "str",
          value: systemMessage?.content ?? "",
        },
        {
          identifier: "messages",
          type: "chat_messages",
          value: nonSystemMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        },
      ],
    } as LlmPromptConfigComponent,
  };
};

/**
 * Builds a code node from a TypedAgent (database agent).
 */
export const buildCodeNodeFromAgent = (
  nodeId: string,
  agent: TypedAgent,
  targetConfig: TargetConfig,
  cell: ExecutionCell
): Node<Code> => {
  const config = agent.config;

  // Get inputs with value mappings applied
  const inputs = (config.inputs ?? []).map((input) => ({
    identifier: input.identifier,
    type: input.type as Field["type"],
    value: getInputValue(input.identifier, targetConfig, cell),
  }));

  const outputs = (config.outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as Field["type"],
  }));

  return {
    id: nodeId,
    type: "code",
    position: { x: 200, y: 0 },
    data: {
      name: agent.name,
      inputs,
      outputs,
      parameters: config.parameters ?? [],
      cls: "Code",
    },
  };
};

// ============================================================================
// Evaluator Node Builder
// ============================================================================

/**
 * Builds evaluator nodes for all evaluators in the cell.
 */
const buildEvaluatorNodes = (
  evaluatorConfigs: EvaluatorConfig[],
  targetId: string,
  cell: ExecutionCell
): {
  evaluatorNodes: Array<Node<Evaluator>>;
  evaluatorNodeIds: Record<string, string>;
} => {
  const evaluatorNodes: Array<Node<Evaluator>> = [];
  const evaluatorNodeIds: Record<string, string> = {};

  evaluatorConfigs.forEach((evaluator, index) => {
    // Node ID pattern: {targetId}.{evaluatorId}
    const nodeId = `${targetId}.${evaluator.id}`;
    evaluatorNodeIds[evaluator.id] = nodeId;

    const node = buildEvaluatorNode(evaluator, nodeId, targetId, cell, index);
    evaluatorNodes.push(node);
  });

  return { evaluatorNodes, evaluatorNodeIds };
};

/**
 * Builds a single evaluator node.
 */
export const buildEvaluatorNode = (
  evaluator: EvaluatorConfig,
  nodeId: string,
  targetId: string,
  cell: ExecutionCell,
  index: number
): Node<Evaluator> => {
  // Get evaluator definition to know what inputs it expects
  const evaluatorDef = AVAILABLE_EVALUATORS[evaluator.evaluatorType as EvaluatorTypes];

  // Build inputs with value mappings applied
  const inputs: Field[] = evaluator.inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
    value: getEvaluatorInputValue(input.identifier, evaluator, targetId, cell),
  }));

  return {
    id: nodeId,
    type: "evaluator",
    position: { x: 400, y: index * 100 },
    data: {
      name: evaluator.name,
      cls: "LangWatchEvaluator",
      inputs,
      outputs: [
        { identifier: "passed", type: "bool" },
        { identifier: "score", type: "float" },
        { identifier: "label", type: "str" },
      ],
      evaluator: evaluator.evaluatorType,
      ...evaluator.settings,
    },
  };
};

// ============================================================================
// Edge Builder
// ============================================================================

/**
 * Builds edges connecting entry -> target and target/entry -> evaluators.
 */
const buildEdges = (
  entryNodeId: string,
  targetNodeId: string,
  targetConfig: TargetConfig,
  evaluatorConfigs: EvaluatorConfig[],
  evaluatorNodeIds: Record<string, string>,
  cell: ExecutionCell
): Edge[] => {
  const edges: Edge[] = [];
  const datasetId = cell.datasetEntry._datasetId as string | undefined;

  // Build edges from entry to target based on target mappings
  const targetMappings = datasetId
    ? targetConfig.mappings[datasetId] ?? {}
    : {};

  // Python NLP expects handles in format "outputs.field" and "inputs.field"
  for (const [inputField, mapping] of Object.entries(targetMappings)) {
    if (mapping.type === "source" && mapping.source === "dataset") {
      edges.push({
        id: `${entryNodeId}->${targetNodeId}.${inputField}`,
        source: entryNodeId,
        sourceHandle: `outputs.${mapping.sourceField}`,
        target: targetNodeId,
        targetHandle: `inputs.${inputField}`,
        type: "default",
      });
    }
  }

  // Build edges to evaluators
  for (const evaluator of evaluatorConfigs) {
    const evaluatorNodeId = evaluatorNodeIds[evaluator.id];
    if (!evaluatorNodeId) continue;

    const evaluatorMappings = datasetId
      ? evaluator.mappings[datasetId]?.[targetConfig.id] ?? {}
      : {};

    for (const [inputField, mapping] of Object.entries(evaluatorMappings)) {
      if (mapping.type === "source") {
        if (mapping.source === "dataset") {
          // From dataset entry
          edges.push({
            id: `${entryNodeId}->${evaluatorNodeId}.${inputField}`,
            source: entryNodeId,
            sourceHandle: `outputs.${mapping.sourceField}`,
            target: evaluatorNodeId,
            targetHandle: `inputs.${inputField}`,
            type: "default",
          });
        } else if (mapping.source === "target" && mapping.sourceId === targetConfig.id) {
          // From target output
          edges.push({
            id: `${targetNodeId}->${evaluatorNodeId}.${inputField}`,
            source: targetNodeId,
            sourceHandle: `outputs.${mapping.sourceField}`,
            target: evaluatorNodeId,
            targetHandle: `inputs.${inputField}`,
            type: "default",
          });
        }
      }
    }
  }

  return edges;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Converts dataset column type to DSL field type.
 */
const columnTypeToFieldType = (colType: string): Field["type"] => {
  switch (colType) {
    case "string":
      return "str";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    case "list":
      return "list";
    case "json":
    case "object":
      return "dict";
    default:
      return "str";
  }
};

/**
 * Gets the input value for a target, applying value mappings if present.
 */
const getInputValue = (
  inputIdentifier: string,
  targetConfig: TargetConfig,
  cell: ExecutionCell
): unknown => {
  const datasetId = cell.datasetEntry._datasetId as string | undefined;
  if (!datasetId) return undefined;

  const mapping = targetConfig.mappings[datasetId]?.[inputIdentifier];
  if (!mapping) return undefined;

  if (mapping.type === "value") {
    return mapping.value;
  }

  // For source mappings, the value will come from edges (don't set here)
  return undefined;
};

/**
 * Gets the input value for an evaluator, applying value mappings if present.
 */
const getEvaluatorInputValue = (
  inputIdentifier: string,
  evaluator: EvaluatorConfig,
  targetId: string,
  cell: ExecutionCell
): unknown => {
  const datasetId = cell.datasetEntry._datasetId as string | undefined;
  if (!datasetId) return undefined;

  const mapping = evaluator.mappings[datasetId]?.[targetId]?.[inputIdentifier];
  if (!mapping) return undefined;

  if (mapping.type === "value") {
    return mapping.value;
  }

  // For source mappings, the value will come from edges (don't set here)
  return undefined;
};
