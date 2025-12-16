import type { Edge, Node } from "@xyflow/react";
import isDeepEqual from "fast-deep-equal";
import debounce from "lodash-es/debounce";
import React from "react";
import { temporal } from "zundo";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../../components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { WizardContext } from "../../components/evaluations/wizard/hooks/useWizardContext";
import type { Field } from "../types/dsl";

// Re-export types and values from core
export {
  initialDSL,
  initialState,
  getWorkflow,
  store,
  removeInvalidEdges,
  removeInvalidDecorations,
  updateCodeClassName,
  type SocketStatus,
  type State,
  type WorkflowStore,
} from "./workflowStoreCore";

import { store, type WorkflowStore } from "./workflowStoreCore";

export const _useWorkflowStore = create<WorkflowStore>()(
  temporal(store, {
    handleSet: (handleSet) => {
      return debounce<typeof handleSet>(
        (pastState) => {
          if ((pastState as any).nodes?.some((node: Node) => node.dragging)) {
            return;
          }
          handleSet(pastState);
        },

        // Our goal is to store the previous state to mark it as a "history entry" whenever state changes,
        // however, sometimes two pieces of state change in a very short period of time, and we don't want to
        // create two or more entries on the undo. We then store the pastState as soon as the debounce begins,
        // and only try to store again if more than 100ms has passed since the last state change.
        100,
        { leading: true, trailing: false },
      );
    },
    equality: (pastState, currentState) => {
      const partialize = (state: WorkflowStore) => {
        const state_ = {
          name: state.name,
          icon: state.icon,
          description: state.description,
          version: undefined,
          default_llm: state.default_llm,
          edges: state.edges.map((edge) => {
            const edge_ = { ...edge };
            delete edge_.selected;
            return edge_;
          }),
          nodes: state.nodes.map((node) => {
            const node_ = { ...node, data: { ...node.data } };
            delete node_.selected;
            delete node_.data.execution_state;
            return node_;
          }),
        };
        return state_;
      };
      return isDeepEqual(partialize(pastState), partialize(currentState));
    },
  }),
);

type UseWorkflowStoreType = typeof _useWorkflowStore;

export const useWorkflowStore = ((
  ...args: Parameters<UseWorkflowStoreType>
) => {
  const { isInsideWizard } = React.useContext(WizardContext);

  const selector = args[0] ?? ((state) => state);
  const equalityFn = args[1];

  if (isInsideWizard) {
    return useEvaluationWizardStore(
      useShallow(({ workflowStore }) => {
        return selector(workflowStore);
      }),
      equalityFn,
    );
  }

  return _useWorkflowStore(selector, equalityFn);
}) as UseWorkflowStoreType;
