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

vi.mock("../../utils/api", () => ({
  api: {
    useContext: () => ({
      experiments: {
        getEvaluationsV3BySlug: {
          invalidate: vi.fn(),
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
vi.mock("next/router", () => ({
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
}));

// Import hook after mocks
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAutosaveEvaluationsV3 } from "../hooks/useAutosaveEvaluationsV3";

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
const TestAutosaveComponent = () => {
  useAutosaveEvaluationsV3();
  return <div data-testid="autosave-test">Autosave Active</div>;
};

describe("Autosave evaluation state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(
      useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation,
    ).toBe("saved");

    // Advance past the 2s delay in markSaved to go back to idle
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(
      useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation,
    ).toBe("idle");
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
    expect(
      useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation,
    ).toBe("error");
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
});
