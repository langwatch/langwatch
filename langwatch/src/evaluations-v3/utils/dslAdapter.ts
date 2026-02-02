/**
 * DSL Adapter for Evaluations V3
 *
 * Converts V3 UI state to the workflow DSL for execution.
 * This is a one-way conversion - state is persisted via workbenchState, not DSL.
 *
 * Key concepts:
 * - Evaluators are global/shared in state - targets reference them by ID
 * - When generating DSL, evaluators are duplicated per-target with {targetId}.{evaluatorId} naming
 * - Mappings: target.mappings for target inputs, evaluator.mappings[targetId] for evaluator inputs
 * - Multi-dataset: DSL is generated for the active dataset only
 */

import type { Edge, Node } from "@xyflow/react";

import type {
  Code,
  Entry,
  Evaluator,
  Field,
  HttpComponentConfig,
  Signature,
  Workflow,
} from "~/optimization_studio/types/dsl";
import type {
  DatasetColumn,
  DatasetReference,
  EvaluationsV3State,
  EvaluatorConfig,
  InlineDataset,
  TargetConfig,
} from "../types";

// ============================================================================
// State to Workflow (for execution)
// ============================================================================

/**
 * Convert V3 state to workflow DSL for execution.
 * Uses the active dataset for generating the entry node.
 * Evaluators are duplicated per-target with clear naming for result mapping.
 *
 * @param state - The current evaluations V3 state
 * @param datasetIdOverride - Optional dataset ID to use instead of activeDatasetId
 * @returns The workflow DSL ready for execution
 */
export const stateToWorkflow = (
  state: EvaluationsV3State,
  datasetIdOverride?: string,
): Workflow => {
  const datasetId = datasetIdOverride ?? state.activeDatasetId;
  const activeDataset = state.datasets.find((d) => d.id === datasetId);

  if (!activeDataset) {
    throw new Error(`Dataset with id ${datasetId} not found`);
  }

  const entryNode = createEntryNode(activeDataset);

  const targetNodes: Array<
    Node<Signature> | Node<Code> | Node<HttpComponentConfig>
  > = [];
  const evaluatorNodes: Array<Node<Evaluator>> = [];

  // Create target nodes
  state.targets.forEach((target, targetIndex) => {
    // Skip prompt targets - they need different handling via API calls
    if (target.type === "prompt") {
      // For now, skip prompts - they would be handled differently
      return;
    }

    // For agent targets, dispatch based on agent type
    const targetNode = createTargetNode(target, datasetId, targetIndex);
    targetNodes.push(targetNode);

    // Create evaluator nodes for ALL evaluators (they apply to all targets)
    // Evaluators are duplicated per-target in the DSL
    state.evaluators.forEach((evaluator, evalIndex) => {
      const evaluatorNode = createEvaluatorNode(
        evaluator,
        datasetId,
        target.id,
        targetIndex,
        evalIndex,
      );
      evaluatorNodes.push(evaluatorNode);
    });
  });

  const targetEdges = buildTargetEdges(state.targets, datasetId);
  const evaluatorEdges = buildEvaluatorEdges(
    state.targets,
    state.evaluators,
    datasetId,
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
    nodes: [entryNode, ...targetNodes, ...evaluatorNodes] as Workflow["nodes"],
    edges: [...targetEdges, ...evaluatorEdges],
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
  colType: DatasetColumn["type"],
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
 * Dispatch to the correct node creation function based on agent type.
 * HTTP agents get HTTP nodes, all others get code nodes (for backward compatibility).
 */
const createTargetNode = (
  target: TargetConfig,
  activeDatasetId: string,
  index: number,
): Node<Code> | Node<HttpComponentConfig> => {
  if (target.agentType === "http") {
    if (!target.httpConfig) {
      throw new Error(`HTTP target "${target.id}" is missing httpConfig`);
    }
    return createHttpNode(target, activeDatasetId, index);
  }
  // Default to code node for backward compatibility (code, signature, workflow, or undefined agentType)
  return createCodeNode(target, activeDatasetId, index);
};

/**
 * Create a code node from a target config.
 * Uses the `parameters` array structure expected by the DSL.
 * Sets default values on inputs that have value mappings.
 */
const createCodeNode = (
  target: TargetConfig,
  activeDatasetId: string,
  index: number,
): Node<Code> => {
  const parameters: Field[] = [];

  // Get mappings for the active dataset
  const datasetMappings = target.mappings[activeDatasetId] ?? {};

  // Apply value mappings as default values on inputs
  const inputs: Field[] = (target.inputs ?? []).map((input) => {
    const mapping = datasetMappings[input.identifier];
    if (mapping?.type === "value") {
      return { ...input, value: mapping.value };
    }
    return input;
  });

  return {
    id: target.id,
    type: "code",
    data: {
      name: target.id, // Name is fetched from DB at execution time
      inputs,
      outputs: target.outputs ?? [{ identifier: "output", type: "str" }],
      parameters,
    },
    position: { x: 300, y: index * 200 },
  };
};

/**
 * Create an HTTP node from an HTTP agent target config.
 * Includes all HTTP configuration (url, method, headers, auth, bodyTemplate, outputPath, timeoutMs).
 * Sets default values on inputs that have value mappings.
 */
const createHttpNode = (
  target: TargetConfig,
  activeDatasetId: string,
  index: number,
): Node<HttpComponentConfig> => {
  const httpConfig = target.httpConfig!;

  // Get mappings for the active dataset
  const datasetMappings = target.mappings[activeDatasetId] ?? {};

  // Apply value mappings as default values on inputs
  const inputs: Field[] = (target.inputs ?? []).map((input) => {
    const mapping = datasetMappings[input.identifier];
    if (mapping?.type === "value") {
      return { ...input, value: mapping.value };
    }
    return input;
  });

  return {
    id: target.id,
    type: "http",
    data: {
      name: target.id, // Name is fetched from DB at execution time
      inputs: inputs as HttpComponentConfig["inputs"],
      outputs: (target.outputs ?? [{ identifier: "output", type: "str" }]) as HttpComponentConfig["outputs"],
      // HTTP-specific config
      url: httpConfig.url,
      method: httpConfig.method,
      headers: httpConfig.headers,
      auth: httpConfig.auth,
      bodyTemplate: httpConfig.bodyTemplate,
      outputPath: httpConfig.outputPath,
      timeoutMs: httpConfig.timeoutMs,
    },
    position: { x: 300, y: index * 200 },
  };
};

/**
 * Create an evaluator node for a specific target.
 * Node ID is {targetId}.{evaluatorId} for clear result mapping back to the table.
 * Sets default values on inputs that have value mappings.
 */
const createEvaluatorNode = (
  evaluator: EvaluatorConfig,
  activeDatasetId: string,
  targetId: string,
  targetIndex: number,
  evalIndex: number,
): Node<Evaluator> => {
  // Get the mappings for this dataset and target
  const datasetMappings = evaluator.mappings[activeDatasetId];
  const targetMappings = datasetMappings?.[targetId] ?? {};

  // Apply value mappings as default values on inputs
  const inputs: Field[] = evaluator.inputs.map((input) => {
    const mapping = targetMappings[input.identifier];
    if (mapping?.type === "value") {
      return { ...input, value: mapping.value };
    }
    return input;
  });

  return {
    id: `${targetId}.${evaluator.id}`,
    type: "evaluator",
    data: {
      name: evaluator.id, // Name is fetched from DB at execution time
      cls: "LangWatchEvaluator",
      inputs,
      outputs: [{ identifier: "passed", type: "bool" }],
      evaluator: evaluator.evaluatorType,
      // Note: settings are fetched from DB at execution time, not stored in workbench state
    },
    position: { x: 600, y: targetIndex * 200 + evalIndex * 100 },
  };
};

/**
 * Build edges connecting entry to targets based on target.mappings.
 * With per-dataset structure: mappings[datasetId][inputField]
 * Only creates edges for mappings that reference the active dataset.
 */
const buildTargetEdges = (
  targets: TargetConfig[],
  activeDatasetId: string,
): Edge[] => {
  const edges: Edge[] = [];

  for (const target of targets) {
    // Get mappings for the active dataset
    const datasetMappings = target.mappings[activeDatasetId];
    if (!datasetMappings) continue;

    for (const [inputField, mapping] of Object.entries(datasetMappings)) {
      // Skip value mappings - they don't create edges
      if (mapping.type === "value") continue;

      if (
        mapping.source === "dataset" &&
        mapping.sourceId === activeDatasetId
      ) {
        edges.push({
          id: `entry->${target.id}.${inputField}`,
          source: "entry",
          sourceHandle: `output-${mapping.sourceField}`,
          target: target.id,
          targetHandle: `input-${inputField}`,
        });
      } else if (mapping.source === "target") {
        // Target-to-target mapping
        edges.push({
          id: `${mapping.sourceId}->${target.id}.${inputField}`,
          source: mapping.sourceId,
          sourceHandle: `output-${mapping.sourceField}`,
          target: target.id,
          targetHandle: `input-${inputField}`,
        });
      }
    }
  }

  return edges;
};

/**
 * Build edges connecting targets to their evaluators.
 * With per-dataset, per-target structure: mappings[datasetId][targetId][inputField]
 * Only creates edges for mappings that reference the active dataset.
 */
const buildEvaluatorEdges = (
  targets: TargetConfig[],
  evaluators: EvaluatorConfig[],
  activeDatasetId: string,
): Edge[] => {
  const edges: Edge[] = [];

  // All evaluators apply to all targets
  for (const target of targets) {
    for (const evaluator of evaluators) {
      // Get mappings for the active dataset and this target
      const datasetMappings = evaluator.mappings[activeDatasetId];
      const targetMappings = datasetMappings?.[target.id] ?? {};
      const evaluatorNodeId = `${target.id}.${evaluator.id}`;

      for (const [inputField, mapping] of Object.entries(targetMappings)) {
        // Skip value mappings - they don't create edges
        if (mapping.type === "value") continue;

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
          mapping.source === "target" &&
          mapping.sourceId === target.id
        ) {
          // From this target's output
          edges.push({
            id: `${target.id}->${evaluatorNodeId}.${inputField}`,
            source: target.id,
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
  state: EvaluationsV3State,
): InlineDataset | undefined => {
  const activeDataset = state.datasets.find(
    (d) => d.id === state.activeDatasetId,
  );
  if (!activeDataset || activeDataset.type !== "inline") {
    return undefined;
  }
  return activeDataset.inline;
};
