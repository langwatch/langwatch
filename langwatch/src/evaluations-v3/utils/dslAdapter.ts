/**
 * DSL Adapter for Evaluations V3
 *
 * Converts V3 UI state to the workflow DSL for execution.
 * This is a one-way conversion - state is persisted via wizardState, not DSL.
 *
 * Key concepts:
 * - Evaluators are global/shared in state - runners reference them by ID
 * - When generating DSL, evaluators are duplicated per-runner with {runnerId}.{evaluatorId} naming
 * - Mappings: runner.mappings for runner inputs, evaluator.mappings[runnerId] for evaluator inputs
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
  RunnerConfig,
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
 * Evaluators are duplicated per-runner with clear naming for result mapping.
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

  const runnerNodes: Array<Node<Signature> | Node<Code>> = [];
  const evaluatorNodes: Array<Node<Evaluator>> = [];

  // Create runner nodes
  state.runners.forEach((runner, runnerIndex) => {
    // Skip prompt runners - they need different handling via API calls
    if (runner.type === "prompt") {
      // For now, skip prompts - they would be handled differently
      return;
    }

    // For agent runners, check the underlying agent type
    const runnerNode = createCodeNode(runner, runnerIndex);
    runnerNodes.push(runnerNode);

    // Create evaluator nodes for each evaluator this runner uses
    // Evaluators are duplicated per-runner in the DSL
    runner.evaluatorIds.forEach((evaluatorId, evalIndex) => {
      const evaluator = state.evaluators.find((e) => e.id === evaluatorId);
      if (!evaluator) return;

      const evaluatorNode = createEvaluatorNode(
        evaluator,
        runner.id,
        runnerIndex,
        evalIndex
      );
      evaluatorNodes.push(evaluatorNode);
    });
  });

  const runnerEdges = buildRunnerEdges(state.runners, datasetId);
  const evaluatorEdges = buildEvaluatorEdges(
    state.runners,
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
    nodes: [entryNode, ...runnerNodes, ...evaluatorNodes] as Workflow["nodes"],
    edges: [...runnerEdges, ...evaluatorEdges],
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
 * Create a code node from a runner config.
 * Uses the `parameters` array structure expected by the DSL.
 */
const createCodeNode = (runner: RunnerConfig, index: number): Node<Code> => {
  const parameters: Field[] = [];

  return {
    id: runner.id,
    type: "code",
    data: {
      name: runner.name,
      inputs: runner.inputs ?? [],
      outputs: runner.outputs ?? [{ identifier: "output", type: "str" }],
      parameters,
    },
    position: { x: 300, y: index * 200 },
  };
};

/**
 * Create an evaluator node for a specific runner.
 * Node ID is {runnerId}.{evaluatorId} for clear result mapping back to the table.
 */
const createEvaluatorNode = (
  evaluator: EvaluatorConfig,
  runnerId: string,
  runnerIndex: number,
  evalIndex: number
): Node<Evaluator> => {
  return {
    id: `${runnerId}.${evaluator.id}`,
    type: "evaluator",
    data: {
      name: `${evaluator.name}`,
      cls: "LangWatchEvaluator",
      inputs: evaluator.inputs,
      outputs: [{ identifier: "passed", type: "bool" }],
      evaluator: evaluator.evaluatorType,
      ...evaluator.settings,
    },
    position: { x: 600, y: runnerIndex * 200 + evalIndex * 100 },
  };
};

/**
 * Build edges connecting entry to runners based on runner.mappings.
 * Only creates edges for mappings that reference the active dataset.
 */
const buildRunnerEdges = (
  runners: RunnerConfig[],
  activeDatasetId: string
): Edge[] => {
  const edges: Edge[] = [];

  for (const runner of runners) {
    if (!runner.mappings) continue;

    for (const [inputField, mapping] of Object.entries(runner.mappings)) {
      if (
        mapping.source === "dataset" &&
        mapping.sourceId === activeDatasetId
      ) {
        edges.push({
          id: `entry->${runner.id}.${inputField}`,
          source: "entry",
          sourceHandle: `output-${mapping.sourceField}`,
          target: runner.id,
          targetHandle: `input-${inputField}`,
        });
      } else if (mapping.source === "runner") {
        // Runner-to-runner mapping
        edges.push({
          id: `${mapping.sourceId}->${runner.id}.${inputField}`,
          source: mapping.sourceId,
          sourceHandle: `output-${mapping.sourceField}`,
          target: runner.id,
          targetHandle: `input-${inputField}`,
        });
      }
    }
  }

  return edges;
};

/**
 * Build edges connecting runners to their evaluators.
 * Mappings are stored inside evaluator.mappings[runnerId].
 * Only creates edges for mappings that reference the active dataset.
 */
const buildEvaluatorEdges = (
  runners: RunnerConfig[],
  evaluators: EvaluatorConfig[],
  activeDatasetId: string
): Edge[] => {
  const edges: Edge[] = [];

  for (const runner of runners) {
    for (const evaluatorId of runner.evaluatorIds) {
      const evaluator = evaluators.find((e) => e.id === evaluatorId);
      if (!evaluator) continue;

      const runnerMappings = evaluator.mappings[runner.id] ?? {};
      const evaluatorNodeId = `${runner.id}.${evaluator.id}`;

      for (const [inputField, mapping] of Object.entries(runnerMappings)) {
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
          mapping.source === "runner" &&
          mapping.sourceId === runner.id
        ) {
          // From this runner's output
          edges.push({
            id: `${runner.id}->${evaluatorNodeId}.${inputField}`,
            source: runner.id,
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
