/**
 * @vitest-environment jsdom
 *
 * Tests for autosave functionality of evaluation state.
 * Verifies that changes to the evaluation workspace are persisted to the database.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Autosave debounce delay (must match the constant in useAutosaveEvaluationsV3.ts)
const AUTOSAVE_DEBOUNCE_MS = 1500;

// Mock tRPC API - must use hoisted mocks
const mockMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: "test-experiment-id",
    slug: "test-slug",
    name: "New Evaluation",
  }),
);

const mockStateFetch = vi.hoisted(() => vi.fn());

vi.mock("../../utils/api", () => ({
  api: {
    useUtils: () => ({
      experiments: {
        getEvaluationsV3BySlug: {
          invalidate: vi.fn(),
          reset: vi.fn(),
          fetch: mockStateFetch,
        },
      },
    }),
    experiments: {
      saveEvaluationsV3: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          isPending: false,
        }),
      },
      getEvaluationsV3BySlug: {
        useQuery: () => ({
          data: null,
          isLoading: false,
        }),
      },
    },
  },
}));

// Mock next/router
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { slug: "test-slug" },
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock organization hook
vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id", slug: "test-project" },
  }),
}));

// Mock toaster
vi.mock("../../components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

// Mock posthog
vi.mock("../../utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

// Import hook after mocks
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { captureException } from "../../utils/posthogErrorCapture";
import { useAutosaveEvaluationsV3 } from "../hooks/useAutosaveEvaluationsV3";
import { extractPersistedState } from "../types/persistence";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
  </QueryClientProvider>
);

// Test component that uses the autosave hook
let autosave: ReturnType<typeof useAutosaveEvaluationsV3> | null = null;
const TestAutosaveComponent = () => {
  autosave = useAutosaveEvaluationsV3();
  return <div data-testid="autosave-test">Autosave Active</div>;
};

describe("Autosave evaluation state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autosave = null;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queryClient.clear();
    // Reset the mock to default success implementation
    mockMutateAsync.mockResolvedValue({
      id: "test-experiment-id",
      slug: "test-slug",
      name: "New Evaluation",
    });
    useEvaluationsV3Store.getState().reset();
    // Set slug AND experimentId to match router query so shouldLoadExisting is false
    // This simulates the state after initial load completes (experiment already exists)
    useEvaluationsV3Store.setState({
      experimentSlug: "test-slug",
      experimentId: "test-experiment-id",
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("triggers save when cell value changes", async () => {
    const { rerender } = render(<TestAutosaveComponent />, {
      wrapper: Wrapper,
    });

    // Wait for initial render - should not have called save yet
    expect(mockMutateAsync).not.toHaveBeenCalled();

    // Wait for initial effect to complete
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // Make a change to the store
    act(() => {
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "test value");
    });

    // Force re-render to pick up store changes
    rerender(<TestAutosaveComponent />);

    // Advance past debounce delay
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
    });

    // Verify the mutation was called with the right project
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "test-project-id",
      }),
    );
  });

  it("updates autosave status to saving then saved then idle", async () => {
    render(<TestAutosaveComponent />, { wrapper: Wrapper });

    // Make a change
    act(() => {
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "trigger save");
    });

    // Advance past debounce - should trigger save and go to "saving" then "saved"
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
    });

    // After mutation completes, should be at "saved"
    expect(useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation).toBe(
      "saved",
    );

    // Advance past the 2s delay in markSaved to go back to idle
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation).toBe(
      "idle",
    );
  });

  it("sets autosave status to error when save fails", async () => {
    render(<TestAutosaveComponent />, { wrapper: Wrapper });

    // Wait for initial render
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // NOW mock mutation to fail (after any initial effects have completed)
    mockMutateAsync.mockRejectedValueOnce(new Error("Network error"));

    // Make a change - this should trigger the rejected mock
    act(() => {
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "will fail");
    });

    // Advance past debounce to trigger save
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
    });

    // Should show error status
    expect(useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation).toBe(
      "error",
    );
  });

  // Dataset records, prompt text and run results are customer content. The
  // capture stays useful with identifiers and counts, so none of it has to
  // travel to telemetry.
  it("reports a failed save with identifiers and counts, never workbench content", async () => {
    const customerContent = "patient record 4711, contact jane@example.com";
    render(<TestAutosaveComponent />, { wrapper: Wrapper });

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    mockMutateAsync.mockRejectedValueOnce(new Error("Network error"));

    act(() => {
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", customerContent);
    });

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
    });

    expect(captureException).toHaveBeenCalled();
    const captured = vi.mocked(captureException).mock.calls.at(-1)?.[1];
    expect(JSON.stringify(captured?.extra)).not.toContain(customerContent);
    expect(captured?.extra).toMatchObject({
      context: "Failed to autosave evaluations v3",
      projectId: "test-project-id",
      experimentId: "test-experiment-id",
      datasetCount: 1,
      targetCount: 0,
      evaluatorCount: 0,
    });
    expect(captured?.extra?.stateByteSize).toBeGreaterThan(0);
  });

  it("saves when a new dataset is added", async () => {
    render(<TestAutosaveComponent />, { wrapper: Wrapper });

    // Wait for initial render
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // Add a new dataset
    act(() => {
      useEvaluationsV3Store.getState().addDataset({
        id: "new-dataset",
        name: "New Dataset",
        type: "inline",
        columns: [{ id: "col1", name: "col1", type: "string" }],
        inline: {
          columns: [{ id: "col1", name: "col1", type: "string" }],
          records: { col1: ["value1"] },
        },
      });
    });

    // Advance past debounce to trigger save
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
    });

    expect(mockMutateAsync).toHaveBeenCalled();
  });

  it("saves when active dataset changes", async () => {
    render(<TestAutosaveComponent />, { wrapper: Wrapper });

    // Wait for initial render
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // First, add another dataset
    act(() => {
      useEvaluationsV3Store.getState().addDataset({
        id: "second-dataset",
        name: "Second Dataset",
        type: "inline",
        columns: [{ id: "col1", name: "col1", type: "string" }],
        inline: {
          columns: [{ id: "col1", name: "col1", type: "string" }],
          records: { col1: [""] },
        },
      });
    });

    // Advance past debounce for first save
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
    });
    expect(mockMutateAsync).toHaveBeenCalled();
    mockMutateAsync.mockClear();

    // Change active dataset
    act(() => {
      useEvaluationsV3Store.getState().setActiveDataset("second-dataset");
    });

    // Advance past debounce for second save
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
    });

    expect(mockMutateAsync).toHaveBeenCalled();
  });

  describe("when the save is refused as stale", () => {
    /** @scenario Autosave hitting a stale version pauses and offers reload */
    it("stands down instead of clobbering, and saves nothing further", async () => {
      // The tRPC envelope for experiment_stale_workbench_state, as
      // readHandledError expects it: payload under data.error.
      mockMutateAsync.mockRejectedValue({
        data: {
          error: {
            code: "experiment_stale_workbench_state",
            httpStatus: 409,
            message: "experiment_stale_workbench_state",
            meta: { currentVersion: 9 },
          },
        },
      });
      useEvaluationsV3Store.getState().setWorkbenchVersion(4);

      render(<TestAutosaveComponent />, { wrapper: Wrapper });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      act(() => {
        useEvaluationsV3Store
          .getState()
          .setCellValue("test-data", 0, "input", "an edit that will lose");
      });
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
      });

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ expectedVersion: 4 }),
      );
      expect(useEvaluationsV3Store.getState().staleWorkbench).toEqual({
        serverVersion: 9,
      });
      expect(
        useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation,
      ).toBe("error");

      // Standing down: further edits do not save while stale.
      mockMutateAsync.mockClear();
      act(() => {
        useEvaluationsV3Store
          .getState()
          .setCellValue("test-data", 0, "input", "another edit");
      });
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
      });
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    /** @scenario "A refused save names who holds the newer version" */
    it("keeps who wrote the newer version, so the banner can name them", async () => {
      mockMutateAsync.mockRejectedValue({
        data: {
          error: {
            code: "experiment_stale_workbench_state",
            httpStatus: 409,
            message: "experiment_stale_workbench_state",
            meta: { currentVersion: 9, actorLabel: "langy" },
          },
        },
      });
      useEvaluationsV3Store.getState().setWorkbenchVersion(4);

      render(<TestAutosaveComponent />, { wrapper: Wrapper });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      act(() => {
        useEvaluationsV3Store
          .getState()
          .setCellValue("test-data", 0, "input", "an edit that will lose");
      });
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
      });

      expect(useEvaluationsV3Store.getState().staleWorkbench).toEqual({
        serverVersion: 9,
        actorLabel: "langy",
      });
    });
  });

  // The silent reconciliation path reloads a clean workbench, and the server
  // often holds exactly what the page already shows. Nothing changes, so the
  // autosave effect never runs, so a "skip the next pass" flag armed by the
  // reload would still be armed when the user types, and that edit would be
  // dropped.
  describe("when a reload finds the server state unchanged", () => {
    it("saves the next edit", async () => {
      useEvaluationsV3Store.getState().setWorkbenchVersion(3);
      render(<TestAutosaveComponent />, { wrapper: Wrapper });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Byte for byte what the workbench already holds.
      mockStateFetch.mockResolvedValue({
        id: "test-experiment-id",
        slug: "test-slug",
        version: 3,
        workbenchState: extractPersistedState(useEvaluationsV3Store.getState()),
      });

      await act(async () => {
        await autosave!.reloadFromServer();
      });

      act(() => {
        useEvaluationsV3Store
          .getState()
          .setCellValue("test-data", 0, "input", "typed right after a reload");
      });
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
      });

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ expectedVersion: 3 }),
      );
    });
  });
});
