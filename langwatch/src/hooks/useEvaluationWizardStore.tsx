import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import type { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import { initialDSL } from "../optimization_studio/hooks/useWorkflowStore";
import { entryNode } from "../optimization_studio/templates/blank";
import type { Evaluator, Workflow } from "../optimization_studio/types/dsl";
import { nameToId } from "../optimization_studio/utils/nodeUtils";
import { convertEvaluator } from "../optimization_studio/utils/registryUtils";
import type { MappingState } from "../server/tracer/tracesMapping";
import { datasetColumnsToFields } from "../optimization_studio/utils/datasetUtils";
import type { DatasetColumns } from "../server/datasets/types";

export type EvaluatorCategory =
  | "expected_answer"
  | "llm_judge"
  | "quality"
  | "rag"
  | "safety";

export const steps = [
  "task",
  "dataset",
  "executor",
  "evaluator",
  "configuration",
  "finalize",
] as const;

export type Step = (typeof steps)[number];

export type PartialEdge = Omit<Workflow["edges"][number], "target"> & {
  target?: string;
};

export type State = {
  experimentId?: string;
  wizardState: {
    step: Step;
    task?:
      | "real_time"
      | "batch"
      | "prompt_creation"
      | "custom_evaluator"
      | "scan";
    dataSource?: "choose" | "from_production" | "manual" | "upload";
    evaluatorCategory?: EvaluatorCategory;
    realTimeTraceMappings?: MappingState;
    workspaceTab?: "dataset" | "workflow" | "results";
  };
  dsl: Workflow;
};

type EvaluationWizardStore = State & {
  reset: () => void;
  setExperimentId: (experiment_id: string) => void;
  getExperimentId: () => string | undefined;
  setWizardState: (
    state:
      | Partial<State["wizardState"]>
      | ((state: State["wizardState"]) => Partial<State["wizardState"]>)
  ) => void;
  getWizardState: () => State["wizardState"];
  setDSL: (
    dsl:
      | Partial<State["dsl"]>
      | ((state: State["dsl"]) => Partial<State["dsl"]>)
  ) => void;
  getDSL: () => State["dsl"];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  nextStep: () => void;
  setDatasetId: (datasetId: string, columnTypes: DatasetColumns) => void;
  getDatasetId: () => string | undefined;
  setFirstEvaluator: (
    evaluator: Partial<Evaluator> & { evaluator: string }
  ) => void;
  getFirstEvaluatorNode: () => Node<Evaluator> | undefined;
  setFirstEvaluatorEdges: (edges: Workflow["edges"]) => void;
  getFirstEvaluatorEdges: () => Workflow["edges"] | undefined;
};

const initialState: State = {
  experimentId: undefined,
  wizardState: {
    step: "task",
    workspaceTab: "dataset",
  },
  dsl: initialDSL,
};

const store = (
  set: (
    partial:
      | EvaluationWizardStore
      | Partial<EvaluationWizardStore>
      | ((
          state: EvaluationWizardStore
        ) => EvaluationWizardStore | Partial<EvaluationWizardStore>),
    replace?: boolean | undefined
  ) => void,
  get: () => EvaluationWizardStore
): EvaluationWizardStore => ({
  ...initialState,
  reset() {
    set(initialState);
  },
  setExperimentId(experiment_id) {
    set((current) => ({ ...current, experimentId: experiment_id }));
  },
  getExperimentId() {
    return get().experimentId;
  },
  setWizardState(state) {
    if (typeof state === "function") {
      set((current) => ({
        ...current,
        wizardState: {
          ...current.wizardState,
          ...state(current.wizardState),
        },
      }));
    } else {
      set((current) => ({
        ...current,
        wizardState: { ...current.wizardState, ...state },
      }));
    }
  },
  getWizardState() {
    return get().wizardState;
  },
  setDSL(dsl) {
    if (typeof dsl === "function") {
      set((current) => ({
        ...current,
        dsl: { ...current.dsl, ...dsl(current.dsl) },
      }));
    } else {
      set((current) => ({
        ...current,
        dsl: { ...current.dsl, ...dsl },
      }));
    }
  },
  getDSL() {
    return get().dsl;
  },
  onNodesChange: (changes: NodeChange[]) => {
    set({
      dsl: { ...get().dsl, nodes: applyNodeChanges(changes, get().dsl.nodes) },
    });
  },
  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      dsl: { ...get().dsl, edges: applyEdgeChanges(changes, get().dsl.edges) },
    });
  },
  onConnect: (connection: Connection) => {
    set({
      dsl: {
        ...get().dsl,
        edges: addEdge(connection, get().dsl.edges).map((edge) => ({
          ...edge,
          type: edge.type ?? "default",
        })),
      },
    });
  },
  nextStep() {
    set((current) => {
      const currentStepIndex = steps.indexOf(current.wizardState.step);
      if (currentStepIndex < steps.length - 1) {
        const nextStep = steps[currentStepIndex + 1];
        if (
          nextStep === "executor" &&
          current.wizardState.task === "real_time"
        ) {
          return {
            ...current,
            wizardState: { ...current.wizardState, step: "evaluator" },
          };
        } else {
          return {
            ...current,
            wizardState: { ...current.wizardState, step: nextStep! },
          };
        }
      }
      return current;
    });
  },
  setDatasetId(datasetId, columnTypes) {
    get().setDSL((current) => {
      const hasEntryNode = current.nodes.some((node) => node.type === "entry");

      if (hasEntryNode) {
        return {
          ...current,
          nodes: current.nodes.map((node) => {
            if (node.type !== "entry") {
              return node;
            }

            return {
              ...node,
              data: { ...node.data, dataset: { id: datasetId } },
            };
          }),
        };
      } else {
        const newEntryNode = entryNode();

        return {
          ...current,
          nodes: [
            ...current.nodes,
            {
              ...newEntryNode,
              data: {
                ...newEntryNode.data,
                dataset: { id: datasetId },
                outputs: datasetColumnsToFields(columnTypes),
              },
            },
          ],
        };
      }
    });
  },
  getDatasetId() {
    const entryNodeData = get().dsl.nodes.find((node) => node.type === "entry")
      ?.data;
    if (entryNodeData && "dataset" in entryNodeData) {
      return entryNodeData.dataset?.id;
    }
    return undefined;
  },
  setFirstEvaluator(evaluator: Partial<Evaluator> & { evaluator: string }) {
    get().setDSL((current) => {
      if (evaluator.evaluator.startsWith("custom/")) {
        throw new Error("Custom evaluators are not supported yet");
      }

      const firstEvaluatorIndex = current.nodes.findIndex(
        (node) => node.type === "evaluator"
      );

      const initialEvaluator = convertEvaluator(
        evaluator.evaluator as keyof typeof AVAILABLE_EVALUATORS
      );
      const firstEvaluator = current.nodes[firstEvaluatorIndex] ?? {
        id: nameToId(initialEvaluator.name ?? initialEvaluator.cls),
        type: "evaluator",
        data: initialEvaluator,
        position: { x: 600, y: 0 },
      };

      const evaluatorNode: Node<Evaluator> = {
        ...firstEvaluator,
        data: {
          ...(firstEvaluator.data as Evaluator),
          ...evaluator,
          parameters:
            evaluator.parameters ??
            // Reset parameters if not given the evaluator is not the same as the current evaluator
            (firstEvaluator.data.cls !== evaluator.cls
              ? []
              : firstEvaluator.data.parameters ?? []),
        },
      };

      if (firstEvaluatorIndex === -1) {
        return {
          ...current,
          nodes: [...current.nodes, evaluatorNode],
        };
      }

      return {
        ...current,
        nodes: current.nodes.map((node, index) =>
          index === firstEvaluatorIndex ? evaluatorNode : node
        ),
      };
    });
  },
  getFirstEvaluatorNode() {
    const node = get().dsl.nodes.find((node) => node.type === "evaluator");
    if (node?.data && "evaluator" in node.data) {
      return node as Node<Evaluator>;
    }
    return undefined;
  },
  setFirstEvaluatorEdges(edges: Edge[]) {
    get().setDSL((current) => {
      const firstEvaluator = get().getFirstEvaluatorNode();

      if (!firstEvaluator?.id) {
        return current;
      }

      return {
        ...current,
        edges: [
          ...current.edges.filter((edge) => edge.target !== firstEvaluator.id),
          ...edges.map((edge) => ({
            ...edge,
            target: firstEvaluator.id,
          })),
        ],
      };
    });
  },
  getFirstEvaluatorEdges() {
    const firstEvaluator = get().getFirstEvaluatorNode();
    if (!firstEvaluator) {
      return undefined;
    }

    return get().dsl.edges.filter((edge) => edge.target === firstEvaluator.id);
  },
});

export const useEvaluationWizardStore = create<EvaluationWizardStore>()(store);
