import type { Edge, Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import type {
  EvaluatorConfig,
  FieldMapping,
  LocalPromptConfig,
  TargetConfig,
} from "~/evaluations-v3/types";
import type {
  Code,
  Entry,
  Evaluator,
  Field,
  HttpComponentConfig,
  LlmPromptConfigComponent,
  Signature,
  Workflow,
} from "~/optimization_studio/types/dsl";

/**
 * HTTP node data structure - uses parameters like other nodes.
 * This is the data shape for type: "http" nodes.
 */
type HttpNodeData = {
  name: string;
  inputs: Field[];
  outputs: Field[];
  parameters: Field[];
};
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { buildLLMConfig } from "~/server/prompt-config/llmConfigBuilder";
import type { ChatMessage } from "~/server/tracer/types";
import type {
  ExecutionCell,
  WorkflowBuilderInput,
  WorkflowBuilderOutput,
} from "./types";

// ============================================================================
// Main Workflow Builder
// ============================================================================

/**
 * Evaluator DB config type
 */
type EvaluatorDbConfig = {
  evaluatorType?: string;
  settings?: Record<string, unknown>;
};

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
    evaluators?: Map<string, { id: string; config: unknown }>;
  },
): WorkflowBuilderOutput => {
  const { cell, datasetColumns } = input;
  const { targetConfig, evaluatorConfigs, datasetEntry, rowIndex } = cell;

  const workflowId = `eval_v3_${nanoid(8)}`;

  // Build entry node with the single row of data
  const entryNode = buildEntryNode(datasetColumns, datasetEntry);

  // Build target node
  const { targetNode, targetNodeId } = buildTargetNode(
    targetConfig,
    loadedData,
    cell,
  );

  // Build evaluator nodes
  const { evaluatorNodes, evaluatorNodeIds } = buildEvaluatorNodes(
    evaluatorConfigs,
    targetConfig.id,
    cell,
    loadedData.evaluators,
  );

  // Build edges
  const edges = buildEdges(
    entryNode.id,
    targetNodeId,
    targetConfig,
    evaluatorConfigs,
    evaluatorNodeIds,
    cell,
    datasetColumns,
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
  datasetEntry: Record<string, unknown>,
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
              [datasetEntry[col.name] ?? datasetEntry[col.id] ?? ""],
            ]),
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
  cell: ExecutionCell,
): { targetNode: Node<Signature | Code | HttpNodeData>; targetNodeId: string } => {
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
          cell,
        ),
        targetNodeId,
      };
    } else if (loadedData.prompt) {
      return {
        targetNode: buildSignatureNodeFromPrompt(
          targetNodeId,
          loadedData.prompt,
          targetConfig,
          cell,
        ),
        targetNodeId,
      };
    } else {
      throw new Error(
        `Prompt target ${targetConfig.id} has no local config and no loaded prompt`,
      );
    }
  } else {
    // Agent target - dispatch based on agent type
    if (loadedData.agent) {
      switch (loadedData.agent.type) {
        case "http":
          return {
            targetNode: buildHttpNodeFromAgent(
              targetNodeId,
              loadedData.agent,
              targetConfig,
              cell,
            ),
            targetNodeId,
          };
        case "signature":
          return {
            targetNode: buildSignatureNodeFromAgent(
              targetNodeId,
              loadedData.agent,
              targetConfig,
              cell,
            ),
            targetNodeId,
          };
        case "code":
        case "workflow":
          return {
            targetNode: buildCodeNodeFromAgent(
              targetNodeId,
              loadedData.agent,
              targetConfig,
              cell,
            ),
            targetNodeId,
          };
        default: {
          const _exhaustive: never = loadedData.agent.type;
          throw new Error(`Unknown agent type: ${_exhaustive}`);
        }
      }
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
  cell: ExecutionCell,
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

  const llmConfig = buildLLMConfig({
    model: prompt.model,
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
    topP: prompt.topP,
    frequencyPenalty: prompt.frequencyPenalty,
    presencePenalty: prompt.presencePenalty,
    seed: prompt.seed,
    topK: prompt.topK,
    minP: prompt.minP,
    repetitionPenalty: prompt.repetitionPenalty,
    reasoning: prompt.reasoning,
    verbosity: prompt.verbosity,
  });

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
  cell: ExecutionCell,
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

  const llmConfig = buildLLMConfig({
    model: localConfig.llm.model,
    temperature: localConfig.llm.temperature,
    maxTokens: localConfig.llm.maxTokens,
    topP: localConfig.llm.topP,
    frequencyPenalty: localConfig.llm.frequencyPenalty,
    presencePenalty: localConfig.llm.presencePenalty,
    seed: localConfig.llm.seed,
    topK: localConfig.llm.topK,
    minP: localConfig.llm.minP,
    repetitionPenalty: localConfig.llm.repetitionPenalty,
    reasoning: localConfig.llm.reasoning,
    verbosity: localConfig.llm.verbosity,
    litellmParams: localConfig.llm.litellmParams,
  });

  // Extract system prompt from messages if present
  const systemMessage = localConfig.messages.find((m) => m.role === "system");
  const nonSystemMessages = localConfig.messages.filter(
    (m) => m.role !== "system",
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
 * Builds a signature node from a TypedAgent with type "signature".
 *
 * Signature agents store config in SignatureComponentConfig format:
 * - llm: top-level or in parameters array
 * - prompt: top-level or as "instructions" in parameters
 * - messages: top-level or in parameters array
 */
export const buildSignatureNodeFromAgent = (
  nodeId: string,
  agent: TypedAgent,
  targetConfig: TargetConfig,
  cell: ExecutionCell,
): Node<Signature> => {
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

  // Build parameters array, normalizing from top-level fields or existing parameters
  const parameters = buildSignatureNodeParameters(config);

  return {
    id: nodeId,
    type: "signature",
    position: { x: 200, y: 0 },
    data: {
      name: agent.name,
      inputs,
      outputs,
      parameters,
    } as LlmPromptConfigComponent,
  };
};

/**
 * Builds parameters array for signature node from agent config.
 *
 * Signature-type agents can store config in two formats:
 * 1. Top-level fields (llm, prompt, messages) - agent drawer format
 * 2. Parameters array with llm/instructions/messages entries - workflow node format
 *
 * This function normalizes both formats into the parameters array
 * so that addEnvs() can process them consistently.
 */
const buildSignatureNodeParameters = (
  config: TypedAgent["config"],
): Field[] => {
  const baseParams = config.parameters ?? [];

  // Start with existing parameters (may already have llm, instructions, messages)
  const resultParams: Field[] = [...baseParams];

  // Check if llm exists in parameters
  const hasLlmInParams = resultParams.some(
    (p) => p.identifier === "llm" && p.type === "llm",
  );

  // Add top-level llm if not in parameters
  if (!hasLlmInParams && "llm" in config && config.llm) {
    resultParams.unshift({
      identifier: "llm",
      type: "llm",
      value: config.llm,
    });
  }

  // Check if instructions exists in parameters
  const hasInstructionsInParams = resultParams.some(
    (p) => p.identifier === "instructions" && p.type === "str",
  );

  // Add top-level prompt as instructions if not in parameters
  if (!hasInstructionsInParams && "prompt" in config && config.prompt) {
    resultParams.push({
      identifier: "instructions",
      type: "str",
      value: config.prompt,
    });
  }

  // Check if messages exists in parameters
  const hasMessagesInParams = resultParams.some(
    (p) => p.identifier === "messages" && p.type === "chat_messages",
  );

  // Add top-level messages if not in parameters
  if (!hasMessagesInParams && "messages" in config && config.messages) {
    resultParams.push({
      identifier: "messages",
      type: "chat_messages",
      value: config.messages,
    });
  }

  return resultParams;
};

/**
 * Builds a code node from a TypedAgent with type "code" or "workflow".
 *
 * Code agents contain Python code with DSPy modules that handle their own LLM calls.
 * Parameters are passed directly - no LLM config normalization needed.
 */
export const buildCodeNodeFromAgent = (
  nodeId: string,
  agent: TypedAgent,
  targetConfig: TargetConfig,
  cell: ExecutionCell,
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

/**
 * Fixed input fields for HTTP agents - these are always available for mapping.
 * Users can add custom fields, but these 3 are always present.
 */
const HTTP_AGENT_FIXED_INPUTS = ["threadId", "messages", "input"] as const;

/**
 * Builds an HTTP node from a TypedAgent with type "http".
 * The HTTP config is read directly from the agent, not duplicated on the target.
 *
 * HTTP config is stored in `parameters` like other node types (Code, Signature, etc.)
 * This ensures consistent handling in the Python parser via parse_fields().
 */
export const buildHttpNodeFromAgent = (
  nodeId: string,
  agent: TypedAgent,
  targetConfig: TargetConfig,
  cell: ExecutionCell,
): Node<HttpNodeData> => {
  // The agent.type === "http" check is done before calling this function,
  // so we can safely cast the config to HttpComponentConfig
  const config = agent.config as HttpComponentConfig;

  // Start with the fixed HTTP agent inputs (threadId, messages, input)
  // These are always available for mapping regardless of what's stored
  const fixedInputs = HTTP_AGENT_FIXED_INPUTS.map((identifier) => ({
    identifier,
    type: "str" as Field["type"],
    value: getInputValue(identifier, targetConfig, cell),
  }));

  // Add any custom user-defined inputs from targetConfig (excluding fixed ones)
  const customInputs = (targetConfig.inputs ?? [])
    .filter(
      (input) =>
        !HTTP_AGENT_FIXED_INPUTS.includes(
          input.identifier as (typeof HTTP_AGENT_FIXED_INPUTS)[number],
        ),
    )
    .map((input) => ({
      identifier: input.identifier,
      type: input.type as Field["type"],
      value: getInputValue(input.identifier, targetConfig, cell),
    }));

  const inputs = [...fixedInputs, ...customInputs];

  // HTTP agents always have a single "output" output
  const outputs = [{ identifier: "output", type: "str" as const }];

  // Build parameters array with HTTP config (consistent with other node types)
  const parameters: Field[] = [
    { identifier: "url", type: "str", value: config.url },
    { identifier: "method", type: "str", value: config.method ?? "POST" },
  ];

  if (config.bodyTemplate) {
    parameters.push({
      identifier: "body_template",
      type: "str",
      value: config.bodyTemplate,
    });
  }

  if (config.outputPath) {
    parameters.push({
      identifier: "output_path",
      type: "str",
      value: config.outputPath,
    });
  }

  if (config.headers && config.headers.length > 0) {
    // Convert array of {key, value} to dict
    const headersDict: Record<string, string> = {};
    for (const h of config.headers) {
      if (h.key) {
        headersDict[h.key] = h.value ?? "";
      }
    }
    parameters.push({
      identifier: "headers",
      type: "dict",
      value: headersDict,
    });
  }

  if (config.timeoutMs) {
    parameters.push({
      identifier: "timeout_ms",
      type: "int",
      value: config.timeoutMs,
    });
  }

  // Add auth params if configured
  if (config.auth && config.auth.type !== "none") {
    parameters.push({
      identifier: "auth_type",
      type: "str",
      value: config.auth.type,
    });

    if (config.auth.type === "bearer" && "token" in config.auth) {
      parameters.push({
        identifier: "auth_token",
        type: "str",
        value: config.auth.token,
      });
    } else if (config.auth.type === "api_key" && "header" in config.auth) {
      parameters.push({
        identifier: "auth_header",
        type: "str",
        value: config.auth.header,
      });
      parameters.push({
        identifier: "auth_value",
        type: "str",
        value: config.auth.value,
      });
    } else if (config.auth.type === "basic" && "username" in config.auth) {
      parameters.push({
        identifier: "auth_username",
        type: "str",
        value: config.auth.username,
      });
      parameters.push({
        identifier: "auth_password",
        type: "str",
        value: config.auth.password,
      });
    }
  }

  return {
    id: nodeId,
    type: "http",
    position: { x: 200, y: 0 },
    data: {
      name: agent.name,
      inputs,
      outputs,
      parameters,
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
  cell: ExecutionCell,
  loadedEvaluators?: Map<string, { id: string; config: unknown }>,
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

    // Get settings from loaded evaluator (DB) instead of workbench state
    const dbEvaluator = evaluator.dbEvaluatorId
      ? loadedEvaluators?.get(evaluator.dbEvaluatorId)
      : undefined;
    const dbConfig = dbEvaluator?.config as EvaluatorDbConfig | undefined;
    const settings = dbConfig?.settings ?? {};

    const node = buildEvaluatorNode(
      evaluator,
      nodeId,
      targetId,
      cell,
      index,
      settings,
      evaluator.dbEvaluatorId, // Pass dbEvaluatorId to use evaluators/{id} path
    );
    evaluatorNodes.push(node);
  });

  return { evaluatorNodes, evaluatorNodeIds };
};

/**
 * Builds a single evaluator node.
 * @param settings - Evaluator settings from DB (always fetched fresh, not from workbench state)
 * @param dbEvaluatorId - Database evaluator ID for using evaluators/{id} path
 */
export const buildEvaluatorNode = (
  evaluator: EvaluatorConfig,
  nodeId: string,
  targetId: string,
  cell: ExecutionCell,
  index: number,
  settings: Record<string, unknown> = {},
  dbEvaluatorId?: string,
): Node<Evaluator> => {
  // Get evaluator definition to know what inputs it expects
  const _evaluatorDef =
    AVAILABLE_EVALUATORS[evaluator.evaluatorType as EvaluatorTypes];

  // Build inputs with value mappings applied
  const inputs: Field[] = evaluator.inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
    value: getEvaluatorInputValue(input.identifier, evaluator, targetId, cell),
  }));

  // Convert evaluator settings to parameters format expected by langwatch_nlp
  // Settings like { model: "...", prompt: "...", max_tokens: 100 } become:
  // [{ identifier: "model", type: "str", value: "..." }, ...]
  const parameters: Field[] = Object.entries(settings).map(([key, value]) => ({
    identifier: key,
    type: "str" as const, // Settings are treated as strings by default
    value,
  }));

  // Use evaluators/{dbEvaluatorId} path when available so langwatch_nlp
  // calls LangWatch API which fetches settings from DB
  // Otherwise fall back to direct evaluator type (e.g., langevals/exact_match)
  const evaluatorPath = dbEvaluatorId
    ? (`evaluators/${dbEvaluatorId}` as const)
    : evaluator.evaluatorType;

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
      evaluator: evaluatorPath,
      parameters,
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
  cell: ExecutionCell,
  datasetColumns: Array<{ id: string; name: string; type: string }>,
): Edge[] => {
  const edges: Edge[] = [];
  const datasetId = cell.datasetEntry._datasetId as string | undefined;

  // Helper to resolve column name to column ID
  // sourceField in mappings is the column name, but entry node uses column ID
  const getColumnId = (columnName: string): string => {
    const column = datasetColumns.find((c) => c.name === columnName);
    return column?.id ?? columnName; // Fall back to columnName if not found
  };

  // Build edges from entry to target based on target mappings
  const targetMappings = datasetId
    ? (targetConfig.mappings[datasetId] ?? {})
    : {};

  // Python NLP expects handles in format "outputs.field" and "inputs.field"
  for (const [inputField, mapping] of Object.entries(targetMappings)) {
    if (mapping.type === "source" && mapping.source === "dataset") {
      const columnId = getColumnId(mapping.sourceField);
      edges.push({
        id: `${entryNodeId}->${targetNodeId}.${inputField}`,
        source: entryNodeId,
        sourceHandle: `outputs.${columnId}`,
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
      ? (evaluator.mappings[datasetId]?.[targetConfig.id] ?? {})
      : {};

    for (const [inputField, mapping] of Object.entries(evaluatorMappings)) {
      if (mapping.type === "source") {
        if (mapping.source === "dataset") {
          // From dataset entry - use column ID, not name
          const columnId = getColumnId(mapping.sourceField);
          edges.push({
            id: `${entryNodeId}->${evaluatorNodeId}.${inputField}`,
            source: entryNodeId,
            sourceHandle: `outputs.${columnId}`,
            target: evaluatorNodeId,
            targetHandle: `inputs.${inputField}`,
            type: "default",
          });
        } else if (
          mapping.source === "target" &&
          mapping.sourceId === targetConfig.id
        ) {
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
  cell: ExecutionCell,
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
  cell: ExecutionCell,
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
