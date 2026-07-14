/**
 * @vitest-environment jsdom
 *
 * The studio results panel used to carry an Optimizations tab next to
 * Evaluations. Optimizations were DSPy-only and have been removed, so the
 * panel now shows only the evaluation results, with no tab to switch to.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fakeStoreState = {
  workflow_id: "wf_1",
  experiment_id: undefined,
  state: { evaluation: undefined },
  getWorkflow: () => ({ nodes: [], edges: [] }),
};

vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: (s: typeof fakeStoreState) => unknown) =>
    selector(fakeStoreState),
}));

// No project, so EvaluationResults short-circuits to its empty state. That
// keeps this test focused on the panel's tab structure, not the run table.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: undefined }),
}));

vi.mock("~/optimization_studio/hooks/useRunEvalution", () => ({
  useRunEvalution: () => ({ stopEvaluation: vi.fn() }),
}));

vi.mock("~/components/experiments/BatchEvaluationV2", () => ({
  useBatchEvaluationState: () => ({
    selectedRun: undefined,
    isFinished: true,
    batchEvaluationRuns: { data: undefined, isLoading: false },
    selectedRunId: undefined,
  }),
}));

const emptyQuery = { data: undefined, isLoading: false, isError: false };
vi.mock("~/utils/api", () => ({
  api: {
    experiments: {
      getExperimentBySlugOrId: { useQuery: () => emptyQuery },
      getExperimentBatchEvaluationRun: { useQuery: () => emptyQuery },
    },
  },
}));

import { ResultsPanel } from "../ResultsPanel";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("ResultsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the results panel opens at the bottom of the studio", () => {
    /** @scenario "The results panel has no Optimizations tab" */
    it("shows only the Evaluations tab, with no Optimizations tab", async () => {
      render(<ResultsPanel isCollapsed={false} collapsePanel={vi.fn()} />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(screen.getByText("Evaluations")).toBeInTheDocument();
      });
      // The Optimizations tab is gone: it is the regression this guards.
      expect(screen.queryByText("Optimizations")).not.toBeInTheDocument();
    });
  });
});
