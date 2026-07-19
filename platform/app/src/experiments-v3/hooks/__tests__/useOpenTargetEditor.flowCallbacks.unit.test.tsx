/**
 * @vitest-environment jsdom
 *
 * Regression tests for issue #3087: useOpenTargetEditor must register
 * `onMappingChange` via `setFlowCallbacks("evaluatorEditor")` (durable) rather
 * than embedding it inside `mappingsConfig` (ephemeral complexProps). When the
 * callback was nested in `mappingsConfig`, ErrorBoundary recovery / drawer
 * navigation cleared it and mapping interactions crashed.
 *
 * These tests mock the drawer store entirely, so they assert hook behavior in
 * isolation (no real store, no DOM). Treat this file as unit-level.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock optimization_studio to avoid circular dependency issues
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

import type { TargetConfig } from "../../types";
import { useEvaluationsV3Store } from "../useEvaluationsV3Store";
import { useOpenTargetEditor } from "../useOpenTargetEditor";

// Capture setFlowCallbacks calls so we can assert on them.
// Must use vi.hoisted so the variables are available when vi.mock is hoisted.
const { mockSetFlowCallbacks, mockOpenDrawer } = vi.hoisted(() => ({
  mockSetFlowCallbacks: vi.fn(),
  mockOpenDrawer: vi.fn(),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    canGoBack: false,
    drawerOpen: vi.fn(() => false),
  }),
  setFlowCallbacks: mockSetFlowCallbacks,
  getComplexProps: () => ({}),
  useDrawerParams: () => ({}),
  getFlowCallbacks: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      agents: {
        getById: {
          fetch: vi.fn(),
        },
      },
    }),
  },
}));

const setupStore = () => {
  useEvaluationsV3Store.setState({
    name: "Test Evaluation",
    experimentId: "exp-123",
    experimentSlug: "test-eval",
    datasets: [
      {
        id: "dataset-1",
        name: "Test Dataset",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
        inline: {
          columns: [{ id: "input", name: "input", type: "string" }],
          records: { input: ["Hello", "World"] },
        },
      },
    ],
    activeDatasetId: "dataset-1",
    targets: [],
    evaluators: [],
    results: {
      status: "idle",
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    },
    ui: {
      selectedRows: new Set(),
      columnWidths: {},
      rowHeightMode: "compact",
      expandedCells: new Set(),
      hiddenColumns: new Set(),
      autosaveStatus: { evaluation: "idle", dataset: "idle" },
      concurrency: 10,
      hasRunThisSession: false,
    },
  });
};

const createEvaluatorTarget = (
  id: string,
  evaluatorId: string,
): TargetConfig & { type: "evaluator" } => ({
  id,
  type: "evaluator",
  targetEvaluatorId: evaluatorId,
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  outputs: [],
  mappings: {
    "dataset-1": {
      output: {
        type: "source",
        source: "dataset",
        sourceId: "dataset-1",
        sourceField: "input",
      },
    },
  },
});

describe("useOpenTargetEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  describe("when opening an evaluator target editor", () => {
    describe("given the evaluator target has a targetEvaluatorId", () => {
      it("registers onMappingChange in flowCallbacks (durable) not in mappingsConfig (ephemeral)", async () => {
        // onMappingChange must be registered via setFlowCallbacks("evaluatorEditor")
        // so it survives ErrorBoundary remount / drawer navigation.
        const target = createEvaluatorTarget("target-1", "evaluator-1");
        const { result } = renderHook(() => useOpenTargetEditor());

        await act(async () => {
          await result.current.openTargetEditor(target);
        });

        // Assert: setFlowCallbacks was called for evaluatorEditor
        await waitFor(() => {
          expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
            "evaluatorEditor",
            expect.objectContaining({
              onMappingChange: expect.any(Function),
            }),
          );
        });
      });

      it("calls openDrawer with mappingsConfig that does NOT contain onMappingChange", async () => {
        // onMappingChange must be durable via flowCallbacks — embedding it in
        // mappingsConfig routes it through ephemeral complexProps.
        const target = createEvaluatorTarget("target-1", "evaluator-1");
        const { result } = renderHook(() => useOpenTargetEditor());

        await act(async () => {
          await result.current.openTargetEditor(target);
        });

        await waitFor(() => {
          expect(mockOpenDrawer).toHaveBeenCalledWith(
            "evaluatorEditor",
            expect.objectContaining({
              evaluatorId: "evaluator-1",
              mappingsConfig: expect.not.objectContaining({
                onMappingChange: expect.any(Function),
              }),
            }),
          );
        });
      });

      it("calls openDrawer with evaluatorId from the target", async () => {
        const target = createEvaluatorTarget("target-2", "evaluator-42");
        const { result } = renderHook(() => useOpenTargetEditor());

        await act(async () => {
          await result.current.openTargetEditor(target);
        });

        await waitFor(() => {
          expect(mockOpenDrawer).toHaveBeenCalledWith(
            "evaluatorEditor",
            expect.objectContaining({
              evaluatorId: "evaluator-42",
            }),
          );
        });
      });
    });
  });
});
