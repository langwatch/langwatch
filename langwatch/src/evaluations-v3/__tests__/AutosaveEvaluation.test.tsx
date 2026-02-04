/**
 * @vitest-environment jsdom
 *
 * Tests for autosave functionality of evaluation state.
 * Verifies that changes to the evaluation workspace are persisted to the database.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
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
  });

  it("triggers save when cell value changes", async () => {
    const { rerender } = render(<TestAutosaveComponent />, {
      wrapper: Wrapper,
    });

    // Wait for initial render - should not have called save yet
    expect(mockMutateAsync).not.toHaveBeenCalled();

    // Wait for initial effect to complete and debounce to clear
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    // Make a change to the store
    act(() => {
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "test value");
    });

    // Force re-render to pick up store changes
    rerender(<TestAutosaveComponent />);

    // Wait for autosave to be triggered (debounce + buffer)
    await waitFor(
      () => {
        expect(mockMutateAsync).toHaveBeenCalled();
      },
      { timeout: AUTOSAVE_DEBOUNCE_MS + 1000 },
    );

    // Verify the mutation was called with the right project
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "test-project-id",
      }),
    );
  });

  it(
    "updates autosave status to saving then saved then idle",
    { timeout: 15000 },
    async () => {
      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Wait for initial render, any pending saves, and status to settle to idle
      await waitFor(
        () => {
          expect(
            useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation,
          ).toBe("idle");
        },
        { timeout: AUTOSAVE_DEBOUNCE_MS + 3000 },
      );

      // Wait for debounce to clear
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      // Make a change
      act(() => {
        useEvaluationsV3Store
          .getState()
          .setCellValue("test-data", 0, "input", "trigger save " + Date.now());
      });

      // Status should transition through saving -> saved (may be too fast to catch "saving")
      // So we check it reaches "saved" which proves the flow worked
      await waitFor(
        () => {
          const status =
            useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation;
          expect(["saving", "saved"]).toContain(status);
        },
        { timeout: AUTOSAVE_DEBOUNCE_MS + 1000 },
      );

      // After mutation completes, should go to saved
      await waitFor(() => {
        expect(
          useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation,
        ).toBe("saved");
      });

      // After delay, should go back to idle (2s delay in markSaved + buffer)
      await waitFor(
        () => {
          expect(
            useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation,
          ).toBe("idle");
        },
        { timeout: 5000 },
      );
    },
  );

  it("sets autosave status to error when save fails", async () => {
    render(<TestAutosaveComponent />, { wrapper: Wrapper });

    // Wait for initial render and debounce to clear
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    // NOW mock mutation to fail (after any initial effects have completed)
    mockMutateAsync.mockRejectedValueOnce(new Error("Network error"));

    // Make a change - this should trigger the rejected mock
    act(() => {
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "will fail " + Date.now());
    });

    // Should eventually show error status (after debounce)
    await waitFor(
      () => {
        const status =
          useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation;
        expect(status).toBe("error");
      },
      { timeout: AUTOSAVE_DEBOUNCE_MS + 1000 },
    );
  });

  it("saves when a new dataset is added", async () => {
    render(<TestAutosaveComponent />, { wrapper: Wrapper });

    // Wait for initial render and debounce to clear
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
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

    // Wait for autosave (after debounce)
    await waitFor(
      () => {
        expect(mockMutateAsync).toHaveBeenCalled();
      },
      { timeout: AUTOSAVE_DEBOUNCE_MS + 1000 },
    );
  });

  it("saves when active dataset changes", async () => {
    render(<TestAutosaveComponent />, { wrapper: Wrapper });

    // Wait for initial render and debounce to clear
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
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

    // Wait for first save (after debounce)
    await waitFor(
      () => {
        expect(mockMutateAsync).toHaveBeenCalled();
      },
      { timeout: AUTOSAVE_DEBOUNCE_MS + 1000 },
    );
    mockMutateAsync.mockClear();

    // Wait for debounce to clear again
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    // Change active dataset
    act(() => {
      useEvaluationsV3Store.getState().setActiveDataset("second-dataset");
    });

    // Wait for autosave (after debounce)
    await waitFor(
      () => {
        expect(mockMutateAsync).toHaveBeenCalled();
      },
      { timeout: AUTOSAVE_DEBOUNCE_MS + 1000 },
    );
  });
});
