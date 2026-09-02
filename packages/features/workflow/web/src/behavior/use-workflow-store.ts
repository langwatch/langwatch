import isDeepEqual from "fast-deep-equal";
import debounce from "lodash-es/debounce";
import { temporal } from "zundo";
import { create } from "zustand";

// Keep the public hook and its pure state helpers on one browser package
// surface; app transport code composes around this hook.
export {
  getWorkflow,
  initialDSL,
  initialState,
  removeInvalidDecorations,
  removeInvalidEdges,
  type SocketStatus,
  type State,
  serializeWorkflow,
  store,
  updateCodeClassName,
  updateInputFields,
  updateOutputFields,
  type WorkflowStore,
} from "./workflow-store";

import { store, type WorkflowStore } from "./workflow-store";

export const _useWorkflowStore = create<WorkflowStore>()(
  temporal(store, {
    handleSet: (handleSet) => {
      return debounce<typeof handleSet>(
        (pastState: WorkflowStore) => {
          if (pastState.nodes.some((node) => node.dragging)) {
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

export const useWorkflowStore = ((...args: Parameters<UseWorkflowStoreType>) => {
  const selector = args[0] ?? ((state) => state);
  const equalityFn = args[1];

  return _useWorkflowStore(selector, equalityFn);
}) as UseWorkflowStoreType;
