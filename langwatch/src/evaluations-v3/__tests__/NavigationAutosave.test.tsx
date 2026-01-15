/**
 * @vitest-environment jsdom
 *
 * Tests for navigation and autosave interaction.
 * Verifies that navigating away and back doesn't cause data loss.
 *
 * CRITICAL BUG TESTED:
 * When navigating away from an evaluation and using browser back button,
 * the store state might be stale (from previous evaluation or initial state),
 * and autosave could overwrite the actual saved evaluation with blank data.
 */
import { cleanup, render, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Autosave debounce delay (must match the constant in useAutosaveEvaluationsV3.ts)
const AUTOSAVE_DEBOUNCE_MS = 1500;

// Mock router with mutable query for simulating navigation
let mockRouterQuery: Record<string, string> = { slug: "existing-evaluation" };
const mockRouterReplace = vi.fn();
const mockRouterPush = vi.fn();

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
}));

// Mock save mutation
const mockSaveMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: "existing-experiment-id",
    slug: "existing-evaluation",
    name: "My Important Evaluation",
  })
);

// Mock load query with controllable data
let mockExistingExperimentData: any = null;
let mockExistingExperimentLoading = true;

vi.mock("../../utils/api", () => ({
  api: {
    experiments: {
      saveEvaluationsV3: {
        useMutation: () => ({
          mutateAsync: mockSaveMutateAsync,
          isPending: false,
        }),
      },
      getEvaluationsV3BySlug: {
        useQuery: () => ({
          data: mockExistingExperimentData,
          isLoading: mockExistingExperimentLoading,
        }),
      },
    },
  },
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
import { useAutosaveEvaluationsV3 } from "../hooks/useAutosaveEvaluationsV3";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Test component that uses the autosave hook
const TestAutosaveComponent = () => {
  const { isLoading } = useAutosaveEvaluationsV3();
  return (
    <div data-testid="autosave-test">
      {isLoading ? "Loading..." : "Ready"}
    </div>
  );
};

describe("Navigation and autosave interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterQuery = { slug: "existing-evaluation" };
    mockExistingExperimentData = null;
    mockExistingExperimentLoading = true;
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Loading existing evaluation", () => {
    it("does NOT autosave while loading an existing evaluation", async () => {
      // Simulate navigating to an existing evaluation
      // The query returns loading state initially
      mockExistingExperimentLoading = true;
      mockExistingExperimentData = null;

      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Wait a bit longer than debounce
      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 500)
        );
      });

      // Should NOT have called save while loading
      expect(mockSaveMutateAsync).not.toHaveBeenCalled();
    });

    it("loads existing evaluation data into store when query completes", async () => {
      // Start with loading
      mockExistingExperimentLoading = true;
      mockExistingExperimentData = null;

      const { rerender } = render(<TestAutosaveComponent />, {
        wrapper: Wrapper,
      });

      // Wait for initial render
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Now simulate query completing with data
      mockExistingExperimentLoading = false;
      mockExistingExperimentData = {
        id: "existing-experiment-id",
        slug: "existing-evaluation",
        name: "My Important Evaluation",
        wizardState: {
          name: "My Important Evaluation",
          datasets: [
            {
              id: "my-dataset",
              name: "My Dataset",
              type: "inline",
              columns: [{ id: "input", name: "input", type: "string" }],
              inline: {
                columns: [{ id: "input", name: "input", type: "string" }],
                records: { input: ["important data"] },
              },
            },
          ],
          activeDatasetId: "my-dataset",
          evaluators: [],
          targets: [
            {
              id: "my-target",
              type: "prompt",
              name: "GPT-4 Target",
              promptId: "prompt-123",
            },
          ],
        },
      };

      // Rerender to pick up query changes
      rerender(<TestAutosaveComponent />);

      // Store should be updated with the loaded data
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        expect(state.experimentId).toBe("existing-experiment-id");
        expect(state.name).toBe("My Important Evaluation");
        expect(state.targets.length).toBe(1);
        expect(state.targets[0]?.name).toBe("GPT-4 Target");
      });
    });
  });

  describe("Browser back navigation (critical bug scenario)", () => {
    it("does NOT autosave initial/blank state over existing evaluation when navigating back", async () => {
      // This tests the critical bug:
      // 1. User has built an evaluation with targets, evaluators, data
      // 2. User navigates away (e.g., to History page)
      // 3. User presses browser back button
      // 4. Component remounts but store might be reset or have stale state
      // 5. Autosave should NOT overwrite the saved evaluation

      // Simulate: Store has been reset (like after navigation)
      useEvaluationsV3Store.getState().reset();

      // The URL says we should load "existing-evaluation"
      mockRouterQuery = { slug: "existing-evaluation" };

      // Query is loading the existing experiment
      mockExistingExperimentLoading = true;
      mockExistingExperimentData = null;

      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Wait longer than debounce - autosave should NOT trigger
      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 1000)
        );
      });

      // CRITICAL: Should NOT have saved while loading
      expect(mockSaveMutateAsync).not.toHaveBeenCalled();
    });

    it("does NOT autosave when store has stale experimentId from different evaluation", async () => {
      // Simulate: User was on evaluation A, store has A's experimentId
      // Then navigates to evaluation B via back button
      // Store still has A's experimentId but URL says B

      // Set store with "evaluation A" data
      useEvaluationsV3Store.setState({
        experimentId: "evaluation-a-id",
        experimentSlug: "evaluation-a",
        name: "Evaluation A",
      });

      // But URL says we're on "evaluation B"
      mockRouterQuery = { slug: "evaluation-b" };

      // And we're loading evaluation B
      mockExistingExperimentLoading = true;
      mockExistingExperimentData = null;

      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Wait longer than debounce
      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 1000)
        );
      });

      // Should NOT save - the slug mismatch means we're loading a different evaluation
      expect(mockSaveMutateAsync).not.toHaveBeenCalled();
    });

    it("loads correct evaluation data after browser back navigation", async () => {
      // Store is blank (simulating fresh component mount after back button)
      useEvaluationsV3Store.getState().reset();

      mockRouterQuery = { slug: "my-saved-evaluation" };
      mockExistingExperimentLoading = true;

      const { rerender } = render(<TestAutosaveComponent />, {
        wrapper: Wrapper,
      });

      // Should not save while loading
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });
      expect(mockSaveMutateAsync).not.toHaveBeenCalled();

      // Now query completes with the saved data
      mockExistingExperimentLoading = false;
      mockExistingExperimentData = {
        id: "my-saved-id",
        slug: "my-saved-evaluation",
        name: "My Saved Evaluation",
        wizardState: {
          name: "My Saved Evaluation",
          datasets: [],
          activeDatasetId: null,
          evaluators: [],
          targets: [
            { id: "target-1", type: "prompt", name: "My Target" },
            { id: "target-2", type: "agent", name: "My Agent" },
          ],
        },
      };

      rerender(<TestAutosaveComponent />);

      // Should load the data into store
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        expect(state.experimentId).toBe("my-saved-id");
        expect(state.targets.length).toBe(2);
      });

      // And still should not have triggered any saves
      expect(mockSaveMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("Slug mismatch detection", () => {
    it("detects when store experimentSlug does not match URL slug and reloads", async () => {
      // Store has one evaluation
      useEvaluationsV3Store.setState({
        experimentId: "old-id",
        experimentSlug: "old-evaluation",
        name: "Old Evaluation",
      });

      // But URL says different evaluation
      mockRouterQuery = { slug: "new-evaluation" };
      mockExistingExperimentLoading = false;
      mockExistingExperimentData = {
        id: "new-id",
        slug: "new-evaluation",
        name: "New Evaluation",
        wizardState: {
          name: "New Evaluation",
          datasets: [],
          activeDatasetId: null,
          evaluators: [],
          targets: [],
        },
      };

      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Should load the new evaluation's data
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        expect(state.experimentId).toBe("new-id");
        expect(state.experimentSlug).toBe("new-evaluation");
      });
    });

    it("does NOT autosave when slug mismatch is detected (critical for back navigation)", async () => {
      // This is the critical bug scenario:
      // Store was reset (e.g., store.reset() was called somewhere)
      // but still has experimentId from before reset got cleared by another effect

      // First, set up as if we had an evaluation loaded
      useEvaluationsV3Store.setState({
        experimentId: "the-real-id", // This ID is still in store
        experimentSlug: "the-real-slug",
        name: "Important Evaluation",
        targets: [{ id: "t1", type: "prompt", name: "My Target", mappings: {}, inputs: [], outputs: [] }],
      });

      // Now simulate what happens after navigation:
      // Store gets reset but maybe experimentId/slug persists in some edge case
      // OR the store is fresh but experimentSlug is empty while experimentId isn't set
      const resetState = useEvaluationsV3Store.getState();
      useEvaluationsV3Store.getState().reset();

      // URL points to an existing evaluation
      mockRouterQuery = { slug: "the-real-slug" };
      mockExistingExperimentLoading = true; // Still loading
      mockExistingExperimentData = null;

      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Wait longer than autosave debounce
      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 1000)
        );
      });

      // CRITICAL: Should NOT have saved blank state while loading
      expect(mockSaveMutateAsync).not.toHaveBeenCalled();

      // Now complete the load
      mockExistingExperimentLoading = false;
      mockExistingExperimentData = {
        id: "the-real-id",
        slug: "the-real-slug",
        name: "Important Evaluation",
        wizardState: {
          name: "Important Evaluation",
          datasets: [],
          activeDatasetId: null,
          evaluators: [],
          targets: [{ id: "t1", type: "prompt", name: "My Target" }],
        },
      };

      // Cleanup and rerender - in real app this would be a state change
      cleanup();
      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Should load the data
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        expect(state.experimentId).toBe("the-real-id");
        expect(state.targets.length).toBe(1);
      });
    });
  });

  describe("Store experimentSlug vs router slug matching", () => {
    it("does NOT autosave when experimentSlug differs from router slug", async () => {
      // Store has BLANK state but has experimentSlug that doesn't match URL
      // This can happen after reset when another evaluation's URL is accessed
      useEvaluationsV3Store.getState().reset();

      // Store is now blank (initial state), experimentSlug is empty
      // URL says we should be on a specific evaluation
      mockRouterQuery = { slug: "my-evaluation" };
      mockExistingExperimentLoading = true;
      mockExistingExperimentData = null;

      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Change something in the store (simulating UI interaction)
      act(() => {
        useEvaluationsV3Store.getState().setName("Accidentally editing blank");
      });

      // Wait for autosave debounce
      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 500)
        );
      });

      // Should NOT save because we're still loading the real evaluation
      expect(mockSaveMutateAsync).not.toHaveBeenCalled();
    });

    it("CRITICAL: reloads after store.reset() is called on same slug (navigation away and back)", async () => {
      // This test verifies that when the component stays mounted but store is reset,
      // the data is correctly reloaded from the database (not left blank)
      // and autosave doesn't save blank state

      // Step 1: First load of the evaluation
      mockRouterQuery = { slug: "foo" };
      mockExistingExperimentLoading = false;
      mockExistingExperimentData = {
        id: "foo-id",
        slug: "foo",
        name: "My Evaluation Foo",
        wizardState: {
          name: "My Evaluation Foo",
          datasets: [],
          activeDatasetId: null,
          evaluators: [],
          targets: [
            { id: "t1", type: "prompt", name: "Target 1" },
          ],
        },
      };

      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Wait for load to complete
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        expect(state.experimentId).toBe("foo-id");
        expect(state.targets.length).toBe(1);
      });

      mockSaveMutateAsync.mockClear();

      // Step 2: Simulate navigation away (reset is called) while component stays mounted
      // This is what happens in Next.js when the cleanup effect runs
      // but the component isn't fully unmounted (e.g., browser back button)
      act(() => {
        useEvaluationsV3Store.getState().reset();
      });

      // The component should detect the store was reset and reload the data
      // This happens because loadedSlugRef gets cleared when experimentSlug !== routerSlug
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        // Data should be reloaded, NOT left blank
        expect(state.experimentId).toBe("foo-id");
        expect(state.name).toBe("My Evaluation Foo");
        expect(state.targets.length).toBe(1);
      });

      // Wait for potential autosave debounce
      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 500)
        );
      });

      // CRITICAL: If save was called, it should NOT be blank state
      // The data was reloaded before autosave could fire
      if (mockSaveMutateAsync.mock.calls.length > 0) {
        const savedState = mockSaveMutateAsync.mock.calls[0]?.[0]?.state;
        // Verify it's NOT blank - it should have the loaded data
        expect(savedState?.targets?.length).toBeGreaterThan(0);
        expect(savedState?.name).toBe("My Evaluation Foo");
        expect(savedState?.experimentId).toBe("foo-id");
      }
    });

    it("CRITICAL BUG: does NOT autosave when store has experimentId but wrong slug", async () => {
      // This is the exact scenario that caused data loss:
      // 1. User loads evaluation A
      // 2. Store has experimentId="A", experimentSlug="eval-a"
      // 3. User navigates away
      // 4. User presses back button, URL is now /eval-b (different evaluation)
      // 5. Store still has experimentId="A" from step 2
      // 6. shouldLoadExisting = false (because experimentId is truthy)
      // 7. Query is disabled (enabled: shouldLoadExisting)
      // 8. existingExperiment.isLoading = false (query is disabled, not loading)
      // 9. Autosave proceeds and saves eval-a's state to eval-b's slug!

      // Set up store as if we had evaluation A loaded
      useEvaluationsV3Store.setState({
        experimentId: "eval-a-id",
        experimentSlug: "eval-a",
        name: "Evaluation A",
        datasets: [],
        targets: [],
        evaluators: [],
      });

      // URL says we're on evaluation B (browser back button scenario)
      mockRouterQuery = { slug: "eval-b" };

      // Query is disabled because experimentId is set, so not loading
      mockExistingExperimentLoading = false;
      mockExistingExperimentData = null; // Would have eval-b data if query was enabled

      render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Wait for autosave debounce
      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 500)
        );
      });

      // CRITICAL: Should NOT save because URL slug doesn't match store slug
      // This would cause eval-a's data to be saved under eval-b's slug!
      expect(mockSaveMutateAsync).not.toHaveBeenCalled();
    });

    it("reloads when URL slug changes to different evaluation", async () => {
      // First mount with evaluation A
      useEvaluationsV3Store.setState({
        experimentId: "eval-a-id",
        experimentSlug: "eval-a",
        name: "Evaluation A",
      });
      mockRouterQuery = { slug: "eval-a" };
      mockExistingExperimentLoading = false;
      mockExistingExperimentData = null;

      const { rerender } = render(<TestAutosaveComponent />, { wrapper: Wrapper });

      // Now URL changes to evaluation B (simulating back button)
      mockRouterQuery = { slug: "eval-b" };
      mockExistingExperimentLoading = false;
      mockExistingExperimentData = {
        id: "eval-b-id",
        slug: "eval-b",
        name: "Evaluation B",
        wizardState: {
          name: "Evaluation B",
          datasets: [],
          activeDatasetId: null,
          evaluators: [],
          targets: [{ id: "b-target", type: "prompt", name: "B Target" }],
        },
      };

      rerender(<TestAutosaveComponent />);

      // Should detect slug mismatch and load evaluation B
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        expect(state.experimentId).toBe("eval-b-id");
        expect(state.experimentSlug).toBe("eval-b");
        expect(state.targets.length).toBe(1);
        expect(state.targets[0]?.name).toBe("B Target");
      }, { timeout: 3000 });
    });
  });
});
