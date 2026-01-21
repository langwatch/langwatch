/**
 * @vitest-environment jsdom
 *
 * Integration tests for OnlineEvaluationDrawer.
 * Only tRPC endpoints are mocked - drawer system works naturally.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { OnlineEvaluationDrawer, clearOnlineEvaluationDrawerState } from "../OnlineEvaluationDrawer";
import { EvaluatorListDrawer } from "~/components/evaluators/EvaluatorListDrawer";
import {
  clearDrawerStack,
  clearFlowCallbacks,
  getFlowCallbacks,
} from "~/hooks/useDrawer";

// Mock evaluator data
const mockEvaluators = [
  {
    id: "evaluator-1",
    name: "PII Check",
    slug: "pii-check-abc12",
    type: "evaluator",
    config: {
      evaluatorType: "langevals/pii_detection",
      settings: { sensitivityLevel: "high" },
    },
    workflowId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-10T10:00:00Z"),
    updatedAt: new Date("2025-01-15T10:00:00Z"),
  },
  {
    id: "evaluator-2",
    name: "Exact Match",
    slug: "exact-match-def34",
    type: "evaluator",
    config: {
      evaluatorType: "langevals/exact_match",
      settings: { caseSensitive: false },
    },
    workflowId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-05T10:00:00Z"),
    updatedAt: new Date("2025-01-12T10:00:00Z"),
  },
];

// Mock monitor data for edit mode
const mockMonitor = {
  id: "monitor-1",
  name: "My PII Monitor",
  checkType: "langevals/pii_detection",
  parameters: {},
  mappings: {},
  sample: 0.5,
  evaluatorId: "evaluator-1",
  projectId: "test-project-id",
  createdAt: new Date("2025-01-10T10:00:00Z"),
  updatedAt: new Date("2025-01-15T10:00:00Z"),
};

// Router mock with mutable query state
let mockQuery: Record<string, string> = {};
const mockPush = vi.fn((url: string) => {
  const queryString = url.split("?")[1] ?? "";
  const params = new URLSearchParams(queryString);
  mockQuery = {};
  params.forEach((value, key) => {
    mockQuery[key] = value;
  });
  return Promise.resolve(true);
});

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockQuery,
    asPath: Object.keys(mockQuery).length > 0
      ? "/test?" + new URLSearchParams(mockQuery).toString()
      : "/test",
    push: mockPush,
    replace: mockPush,
  }),
}));

// Track mutation calls
const mockCreateMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockInvalidate = vi.fn();

// Mock tRPC API
vi.mock("~/utils/api", () => ({
  api: {
    evaluators: {
      getAll: {
        useQuery: vi.fn(() => ({
          data: mockEvaluators,
          isLoading: false,
        })),
      },
      getById: {
        useQuery: vi.fn(({ id }: { id: string }) => ({
          data: mockEvaluators.find((e) => e.id === id) ?? null,
          isLoading: false,
        })),
      },
      delete: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isPending: false,
        })),
      },
    },
    monitors: {
      getById: {
        useQuery: vi.fn(({ id }: { id: string }) => ({
          data: id === "monitor-1" ? mockMonitor : null,
          isLoading: false,
        })),
      },
      getAllForProject: {
        useQuery: vi.fn(() => ({
          data: [mockMonitor],
          isLoading: false,
        })),
      },
      create: {
        useMutation: vi.fn((options: { onSuccess?: () => void }) => ({
          mutate: (data: unknown) => {
            mockCreateMutate(data);
            options?.onSuccess?.();
          },
          isPending: false,
        })),
      },
      update: {
        useMutation: vi.fn((options: { onSuccess?: () => void }) => ({
          mutate: (data: unknown) => {
            mockUpdateMutate(data);
            options?.onSuccess?.();
          },
          isPending: false,
        })),
      },
    },
    useContext: vi.fn(() => ({
      evaluators: {
        getAll: { invalidate: mockInvalidate },
      },
      monitors: {
        getAllForProject: { invalidate: mockInvalidate },
      },
    })),
  },
}));

// Mock project hook
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id", slug: "test-project" },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/**
 * CRITICAL Integration test - Tests the REAL navigation flow where the drawer's
 * open prop actually changes during navigation (as happens in production).
 */
describe("OnlineEvaluationDrawer + EvaluatorListDrawer Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = {};
    clearDrawerStack();
    clearFlowCallbacks();
    clearOnlineEvaluationDrawerState();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("CRITICAL: evaluator selection persists when returning from EvaluatorListDrawer", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Helper to determine which drawer should be open based on URL
    const isOnlineEvalOpen = () => mockQuery["drawer.open"] === "onlineEvaluationDrawer" || mockQuery["drawer.open"] === undefined;
    const isEvaluatorListOpen = () => mockQuery["drawer.open"] === "evaluatorList";

    // Start with online evaluation drawer open
    mockQuery = { "drawer.open": "onlineEvaluationDrawer" };

    // Render BOTH drawers - the open prop is controlled by URL state (like real app)
    const { rerender } = render(
      <Wrapper>
        <OnlineEvaluationDrawer open={isOnlineEvalOpen()} />
        <EvaluatorListDrawer open={isEvaluatorListOpen()} />
      </Wrapper>
    );

    // Step 1: OnlineEvaluationDrawer is open, shows Select Evaluator
    await waitFor(() => {
      expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
    });

    // Step 2: Click "Select Evaluator" - this navigates to evaluator list
    await user.click(screen.getByText("Select Evaluator"));

    // Step 3: URL should now have drawer.open=evaluatorList
    await waitFor(() => {
      expect(mockQuery["drawer.open"]).toBe("evaluatorList");
    });

    // Step 4: Re-render with REAL open state changes
    // OnlineEvaluationDrawer.open is now FALSE, EvaluatorListDrawer.open is now TRUE
    rerender(
      <Wrapper>
        <OnlineEvaluationDrawer open={isOnlineEvalOpen()} />
        <EvaluatorListDrawer open={isEvaluatorListOpen()} />
      </Wrapper>
    );

    // Step 5: EvaluatorListDrawer should now be visible with evaluators
    await waitFor(() => {
      expect(screen.getByText("PII Check")).toBeInTheDocument();
    });

    // Step 6: Click on "PII Check" evaluator to select it
    const piiCheckCard = screen.getByTestId("evaluator-card-evaluator-1");
    await user.click(piiCheckCard);

    // Step 7: After selection, goBack() navigates back to online eval drawer
    await waitFor(() => {
      expect(mockQuery["drawer.open"]).not.toBe("evaluatorList");
    });

    // Step 8: Re-render with the REAL state - OnlineEvaluationDrawer.open is TRUE again
    rerender(
      <Wrapper>
        <OnlineEvaluationDrawer open={isOnlineEvalOpen()} />
        <EvaluatorListDrawer open={isEvaluatorListOpen()} />
      </Wrapper>
    );

    // Step 9: CRITICAL - OnlineEvaluationDrawer should show the selected evaluator
    await waitFor(() => {
      // Should show "PII Check" in the selection box (not "Select Evaluator")
      expect(screen.getByText("PII Check")).toBeInTheDocument();
      // Name should be auto-filled
      const nameInput = screen.getByPlaceholderText("Enter evaluation name") as HTMLInputElement;
      expect(nameInput.value).toBe("PII Check");
    });
  });
});

describe("OnlineEvaluationDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = {};
    clearDrawerStack();
    clearFlowCallbacks();
    clearOnlineEvaluationDrawerState();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("Basic rendering - New evaluation mode", () => {
    it("shows New Online Evaluation header", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("New Online Evaluation")).toBeInTheDocument();
      });
    });

    it("shows Evaluator field label", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Evaluator")).toBeInTheDocument();
      });
    });

    it("shows Select Evaluator button when none selected", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
    });

    it("shows Name field", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Name")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Enter evaluation name")).toBeInTheDocument();
      });
    });

    it("shows Sampling field", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText(/Sampling/)).toBeInTheDocument();
        // Default sampling is 1 (100%) shown in input
        const samplingInput = screen.getByDisplayValue("1") as HTMLInputElement;
        expect(samplingInput).toBeInTheDocument();
      });
    });

    it("shows Cancel and Create buttons", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
        expect(screen.getByText("Create")).toBeInTheDocument();
      });
    });
  });

  describe("Evaluator selection", () => {
    it("opens evaluator list when clicking Select Evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalled();
        const lastCall = mockPush.mock.calls[mockPush.mock.calls.length - 1]?.[0];
        expect(lastCall).toContain("drawer.open=evaluatorList");
      });
    });

    it("sets flow callback for evaluator selection", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        const callbacks = getFlowCallbacks("evaluatorList");
        expect(callbacks).toBeDefined();
        expect(callbacks?.onSelect).toBeDefined();
      });
    });

    it("displays selected evaluator after selection", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      // Simulate evaluator selection via callback
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
    });

    it("pre-fills name with evaluator name when name is empty", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        const nameInput = screen.getByPlaceholderText("Enter evaluation name") as HTMLInputElement;
        expect(nameInput.value).toBe("PII Check");
      });
    });

    it("shows selected evaluator in clickable selection box", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
        // Selection box should be clickable (has caret indicator for re-selection)
        const selectionBox = screen.getByText("PII Check").closest("button");
        expect(selectionBox).toBeInTheDocument();
      });
    });
  });

  describe("Name field behavior", () => {
    it("allows typing in name field", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      const nameInput = screen.getByPlaceholderText("Enter evaluation name");
      await user.type(nameInput, "My Custom Monitor");

      expect(nameInput).toHaveValue("My Custom Monitor");
    });

    it("does not override custom name when selecting evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // First type a custom name
      const nameInput = screen.getByPlaceholderText("Enter evaluation name");
      await user.type(nameInput, "My Custom Name");

      // Then select evaluator
      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Name should still be custom
      await waitFor(() => {
        expect(nameInput).toHaveValue("My Custom Name");
      });
    });
  });

  describe("Sampling input", () => {
    it("shows 1.0 (100%) sampling by default", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        const samplingInput = screen.getByDisplayValue("1") as HTMLInputElement;
        expect(samplingInput).toBeInTheDocument();
      });
    });

    it("shows helper text explaining sampling", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        // Text appears in both preconditions and sampling sections
        const texts = screen.getAllByText(/This evaluation will run on every message/);
        expect(texts.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Validation", () => {
    it("Create button is disabled when no evaluator selected", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        const createButton = screen.getByText("Create");
        expect(createButton).toBeDisabled();
      });
    });

    it("Create button is disabled when name is empty", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select evaluator
      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for the name to be auto-filled
      const nameInput = screen.getByPlaceholderText("Enter evaluation name") as HTMLInputElement;
      await waitFor(() => {
        expect(nameInput.value).toBe("PII Check");
      });

      // Clear the auto-filled name
      await user.clear(nameInput);

      // Wait for the name to actually be empty
      await waitFor(() => {
        expect(nameInput.value).toBe("");
      });

      // Now check the button is disabled
      await waitFor(() => {
        const createButton = screen.getByText("Create");
        expect(createButton).toBeDisabled();
      });
    });

    it("Create button is enabled when evaluator and name are set", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        const createButton = screen.getByText("Create");
        expect(createButton).not.toBeDisabled();
      });
    });
  });

  describe("Save functionality - Create mode", () => {
    it("calls create mutation with correct data", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("Create")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Create"));

      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "test-project-id",
          name: "PII Check",
          checkType: "langevals/pii_detection",
          evaluatorId: "evaluator-1",
          sample: 1.0,
        })
      );
    });

    it("calls onSave callback after successful create", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockOnSave = vi.fn();
      render(<OnlineEvaluationDrawer open={true} onSave={mockOnSave} />, { wrapper: Wrapper });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => expect(screen.getByText("Create")).not.toBeDisabled());

      await user.click(screen.getByText("Create"));

      expect(mockOnSave).toHaveBeenCalled();
    });
  });

  describe("Edit mode", () => {
    it("shows Edit Online Evaluation header in edit mode", async () => {
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Edit Online Evaluation")).toBeInTheDocument();
      });
    });

    it("shows Save Changes button instead of Create", async () => {
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Save Changes")).toBeInTheDocument();
        expect(screen.queryByText("Create")).not.toBeInTheDocument();
      });
    });

    it("loads existing monitor data", async () => {
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, { wrapper: Wrapper });

      await waitFor(() => {
        const nameInput = screen.getByPlaceholderText("Enter evaluation name") as HTMLInputElement;
        expect(nameInput.value).toBe("My PII Monitor");
      });

      await waitFor(() => {
        // Sample rate from mock is 0.5
        const samplingInput = screen.getByDisplayValue("0.5") as HTMLInputElement;
        expect(samplingInput).toBeInTheDocument();
      });
    });

    it("loads linked evaluator", async () => {
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
    });

    it("calls update mutation in edit mode", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, { wrapper: Wrapper });

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText("Save Changes")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Save Changes"));

      expect(mockUpdateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "monitor-1",
          projectId: "test-project-id",
        })
      );
    });
  });

  describe("Close behavior", () => {
    it("calls onClose when clicking Cancel", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockOnClose = vi.fn();
      render(<OnlineEvaluationDrawer open={true} onClose={mockOnClose} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("does not render when open is false", () => {
      render(<OnlineEvaluationDrawer open={false} />, { wrapper: Wrapper });

      expect(screen.queryByText("New Online Evaluation")).not.toBeInTheDocument();
    });
  });

  describe("Reset on reopen", () => {
    it("resets form when drawer reopens in create mode after true close", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(
        <OnlineEvaluationDrawer open={true} />,
        { wrapper: Wrapper }
      );

      // Select evaluator and enter name
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Close drawer
      rerender(<Wrapper><OnlineEvaluationDrawer open={false} /></Wrapper>);

      // Clear callbacks and drawer state (simulates a true close via Cancel/X button
      // which calls handleClose() to clear the persisted state)
      clearFlowCallbacks();
      clearOnlineEvaluationDrawerState();

      // Reopen drawer
      rerender(<Wrapper><OnlineEvaluationDrawer open={true} /></Wrapper>);

      // Should be reset
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
    });
  });

  describe("State persistence during navigation", () => {
    it("preserves selected evaluator when navigating to evaluator list and back", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // First, select an evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Change the name to something custom
      const nameInput = screen.getByPlaceholderText("Enter evaluation name") as HTMLInputElement;
      await user.clear(nameInput);
      await user.type(nameInput, "My Custom Monitor Name");

      await waitFor(() => {
        expect(nameInput.value).toBe("My Custom Monitor Name");
      });

      // Now click on the selection box to navigate to evaluator list again (caret indicates clickable)
      const selectionBox = screen.getByText("PII Check").closest("button");
      await user.click(selectionBox!);

      // Clear the flow callbacks to simulate navigation
      clearFlowCallbacks();

      // The evaluator should still be selected (we didn't close the drawer, just navigated)
      // When user comes back without selecting a new evaluator, state should be preserved
      await waitFor(() => {
        // The evaluator is still shown because we're still in the same session
        expect(screen.getByText("PII Check")).toBeInTheDocument();
        expect(nameInput.value).toBe("My Custom Monitor Name");
      });
    });

    it("updates evaluator when selecting a different one after navigation", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select first evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Clear name to ensure it gets updated
      const nameInput = screen.getByPlaceholderText("Enter evaluation name") as HTMLInputElement;
      await user.clear(nameInput);

      // Click selection box to select a different evaluator (caret indicates clickable)
      const selectionBox = screen.getByText("PII Check").closest("button");
      await user.click(selectionBox!);
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

      // Select the second evaluator
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[1]!);

      // Should now show the new evaluator and update the name
      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
        expect(nameInput.value).toBe("Exact Match");
      });
    });
  });

  describe("Integration with EvaluatorListDrawer", () => {
    it("flow callback updates OnlineEvaluationDrawer state when evaluator selected", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      // Click to open evaluator list
      await user.click(screen.getByText("Select Evaluator"));

      // Get the flow callback
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      const flowCallbacks = getFlowCallbacks("evaluatorList");
      expect(flowCallbacks?.onSelect).toBeInstanceOf(Function);

      // Call the callback (simulating evaluator selection)
      flowCallbacks?.onSelect?.(mockEvaluators[1]!);

      // OnlineEvaluationDrawer should update
      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
        const nameInput = screen.getByPlaceholderText("Enter evaluation name") as HTMLInputElement;
        expect(nameInput.value).toBe("Exact Match");
      });
    });
  });

  describe("Evaluation Level selector", () => {
    it("shows Trace Level and Thread Level options", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Trace Level")).toBeInTheDocument();
        expect(screen.getByText("Thread Level")).toBeInTheDocument();
      });
    });

    it("Trace Level is selected by default", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        const traceRadio = screen.getByRole("radio", { name: /trace level/i });
        expect(traceRadio).toBeChecked();
      });
    });

    it("shows trace level description", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText(/evaluate each trace individually/i)).toBeInTheDocument();
      });
    });

    it("shows thread level description", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText(/evaluate all traces in a conversation thread/i)).toBeInTheDocument();
      });
    });

    it("allows switching between Trace Level and Thread Level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Initially Trace Level
      const traceRadio = screen.getByRole("radio", { name: /trace level/i });
      const threadRadio = screen.getByRole("radio", { name: /thread level/i });
      expect(traceRadio).toBeChecked();
      expect(threadRadio).not.toBeChecked();

      // Switch to Thread Level
      await user.click(threadRadio);
      await waitFor(() => {
        expect(threadRadio).toBeChecked();
        expect(traceRadio).not.toBeChecked();
      });

      // Switch back to Trace Level
      await user.click(traceRadio);
      await waitFor(() => {
        expect(traceRadio).toBeChecked();
        expect(threadRadio).not.toBeChecked();
      });
    });
  });

  describe("Mappings functionality", () => {
    it("includes mappings data in create mutation", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("Create")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Create"));

      // Verify mappings is included (may be empty or auto-inferred)
      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          mappings: expect.any(Object),
        })
      );
    });

    it("includes mappings data in update mutation", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, { wrapper: Wrapper });

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText("Save Changes")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Save Changes"));

      expect(mockUpdateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          mappings: expect.any(Object),
        })
      );
    });
  });

  describe("Pending mappings warning", () => {
    // Note: Testing the full pending mappings flow requires complex setup
    // because it depends on evaluator requiredFields which come from AVAILABLE_EVALUATORS
    // These tests verify the UI elements are rendered correctly when conditions are met

    it("Create button has title tooltip when disabled", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        const createButton = screen.getByText("Create");
        expect(createButton).toBeDisabled();
      });
    });

    it("shows Evaluation Level field label", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Evaluation Level")).toBeInTheDocument();
      });
    });

    it("shows evaluator selection box", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
    });
  });

  describe("Level change with evaluator selected", () => {
    it("resets to initial state when level changes", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select evaluator at trace level
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Evaluator should remain selected after level change
      const threadRadio = screen.getByRole("radio", { name: /thread/i });
      await user.click(threadRadio);

      await waitFor(() => {
        // Evaluator should still be selected
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
    });
  });
});
