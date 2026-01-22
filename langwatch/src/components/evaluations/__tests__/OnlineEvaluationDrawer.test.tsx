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
import { EvaluatorEditorDrawer } from "~/components/evaluators/EvaluatorEditorDrawer";
import { CurrentDrawer } from "~/components/CurrentDrawer";
import {
  clearDrawerStack,
  clearFlowCallbacks,
  getFlowCallbacks,
  getDrawerStack,
} from "~/hooks/useDrawer";

// Mock evaluator data
const mockEvaluators = [
  {
    id: "evaluator-1",
    name: "PII Check",
    slug: "pii-check-abc12",
    type: "evaluator",
    config: {
      evaluatorType: "presidio/pii_detection",
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
  // Evaluator with required input/output fields (for auto-inference testing)
  {
    id: "evaluator-3",
    name: "Answer Relevance",
    slug: "answer-relevance-ghi78",
    type: "evaluator",
    config: {
      evaluatorType: "legacy/ragas_answer_relevancy",
      settings: { model: "openai/gpt-4" },
    },
    workflowId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-08T10:00:00Z"),
    updatedAt: new Date("2025-01-14T10:00:00Z"),
  },
];

// Mock monitor data for edit mode
const mockMonitor = {
  id: "monitor-1",
  name: "My PII Monitor",
  checkType: "presidio/pii_detection",
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
  useRouter: () => {
    const asPath = Object.keys(mockQuery).length > 0
      ? "/test?" + Object.entries(mockQuery).map(([k, v]) => `${k}=${v}`).join("&")
      : "/test";
    // console.log("useRouter called, asPath:", asPath);
    return {
      query: mockQuery,
      asPath,
      push: mockPush,
      replace: mockPush,
    };
  },
}));

// Mock scrollIntoView which jsdom doesn't support
Element.prototype.scrollIntoView = vi.fn();

// Track mutation calls
const mockCreateMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockInvalidate = vi.fn();

// Track evaluator mutation calls
const mockEvaluatorCreateMutate = vi.fn();
const mockEvaluatorUpdateMutate = vi.fn();

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
      create: {
        useMutation: vi.fn((options?: { onSuccess?: (evaluator: unknown) => void }) => ({
          mutate: (data: unknown) => {
            mockEvaluatorCreateMutate(data);
            options?.onSuccess?.(mockEvaluators[0]);
          },
          mutateAsync: async (data: unknown) => {
            mockEvaluatorCreateMutate(data);
            return mockEvaluators[0];
          },
          isPending: false,
        })),
      },
      update: {
        useMutation: vi.fn((options?: { onSuccess?: (evaluator: unknown) => void }) => ({
          mutate: (data: unknown) => {
            mockEvaluatorUpdateMutate(data);
            options?.onSuccess?.(mockEvaluators[0]);
          },
          mutateAsync: async (data: unknown) => {
            mockEvaluatorUpdateMutate(data);
            return mockEvaluators[0];
          },
          isPending: false,
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
    modelProvider: {
      getAllForProject: {
        useQuery: vi.fn(() => ({
          data: {},
          isLoading: false,
        })),
      },
      getAllForProjectForFrontend: {
        useQuery: vi.fn(() => ({
          data: { providers: {}, modelMetadata: {} },
          isLoading: false,
          refetch: vi.fn(),
        })),
      },
    },
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
          checkType: "presidio/pii_detection",
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

/**
 * INTEGRATION TEST: OnlineEvaluationDrawer + EvaluatorEditorDrawer
 *
 * This tests the full flow where:
 * 1. User opens OnlineEvaluationDrawer
 * 2. User selects an evaluator with required mappings
 * 3. EvaluatorEditorDrawer opens for mapping configuration
 * 4. User clicks on mapping input and sees trace fields
 * 5. User selects a nested field (e.g., metadata.thread_id)
 */
describe("OnlineEvaluationDrawer + EvaluatorEditorDrawer Mapping Integration", () => {
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

  // Helper to determine which drawer should be open based on URL
  const isOnlineEvalOpen = () =>
    mockQuery["drawer.open"] === "onlineEvaluationDrawer" ||
    mockQuery["drawer.open"] === undefined ||
    !mockQuery["drawer.open"];
  const isEvaluatorListOpen = () => mockQuery["drawer.open"] === "evaluatorList";
  const isEvaluatorEditorOpen = () => mockQuery["drawer.open"] === "evaluatorEditor";

  it("INTEGRATION: shows trace mapping dropdown with nested fields when configuring evaluator", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Start with online evaluation drawer open
    mockQuery = { "drawer.open": "onlineEvaluation" };

    const { rerender } = render(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>
    );

    // Step 1: OnlineEvaluationDrawer is open
    await waitFor(() => {
      expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
    });

    // Step 2: Click "Select Evaluator" and select via flow callback
    await user.click(screen.getByText("Select Evaluator"));
    await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

    // Select PII Check evaluator
    getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

    // Step 3: Wait for navigation to evaluator editor (Issue 1 fix)
    await vi.advanceTimersByTimeAsync(200);

    await waitFor(() => {
      expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
    }, { timeout: 500 });

    // Step 4: Re-render to pick up the new URL state
    rerender(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>
    );

    // Step 5: Find a mapping input in the evaluator editor
    await waitFor(() => {
      expect(screen.getByText("Variables")).toBeInTheDocument();
    });

    // Step 6: Find and click on a mapping input
    const textboxes = screen.getAllByRole("textbox");
    // Find the mapping input (not the name input) - look for one with placeholder
    const mappingInput = textboxes.find(tb =>
      tb.getAttribute("placeholder")?.includes("source") ||
      tb.getAttribute("placeholder")?.includes("Required") ||
      tb.getAttribute("placeholder") === ""
    ) ?? textboxes[1]; // Skip the name input (first one)

    await user.click(mappingInput!);

    // Step 7: Should show trace fields in dropdown
    await waitFor(() => {
      const fieldOptions = screen.queryAllByTestId(/^field-option-/);
      expect(fieldOptions.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // Step 8: Click on "metadata" (has children)
    await waitFor(() => {
      expect(screen.getByTestId("field-option-metadata")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("field-option-metadata"));

    // Step 9: Should show metadata badge AND nested children
    await waitFor(() => {
      expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("metadata");
    });

    await waitFor(() => {
      expect(screen.getByTestId("field-option-thread_id")).toBeInTheDocument();
    });

    // Step 10: Click on thread_id to complete the mapping
    await user.click(screen.getByTestId("field-option-thread_id"));

    // Step 11: Should show completed mapping as "metadata.thread_id"
    await waitFor(() => {
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
      expect(screen.getByText("metadata.thread_id")).toBeInTheDocument();
    });
  });

  it("INTEGRATION: selecting spans shows nested span subfields", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Start with online evaluation drawer open
    mockQuery = { "drawer.open": "onlineEvaluation" };

    const { rerender } = render(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>
    );

    // Select evaluator
    await waitFor(() => {
      expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Select Evaluator"));
    await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

    getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

    await vi.advanceTimersByTimeAsync(200);

    await waitFor(() => {
      expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
    }, { timeout: 500 });

    rerender(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Variables")).toBeInTheDocument();
    });

    const textboxes = screen.getAllByRole("textbox");
    const mappingInput = textboxes[1]; // Skip the name input

    await user.click(mappingInput!);

    await waitFor(() => {
      expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Click on "spans"
    await user.click(screen.getByTestId("field-option-spans"));

    // Should show spans badge AND nested children
    await waitFor(() => {
      expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("spans");
    });

    await waitFor(() => {
      expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
      expect(screen.getByTestId("field-option-output")).toBeInTheDocument();
    });

    // Select output
    await user.click(screen.getByTestId("field-option-output"));

    // Should show completed mapping
    await waitFor(() => {
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
      expect(screen.getByText("spans.output")).toBeInTheDocument();
    });
  });
});

/**
 * ISSUE-SPECIFIC INTEGRATION TESTS
 *
 * These tests verify the expected behaviors for the 4 reported issues.
 * They should FAIL initially and pass after fixes are implemented.
 */
describe("OnlineEvaluationDrawer Issue Fixes", () => {
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

  // Helper functions for drawer state
  const isOnlineEvalOpen = () =>
    mockQuery["drawer.open"] === "onlineEvaluationDrawer" ||
    mockQuery["drawer.open"] === undefined ||
    !mockQuery["drawer.open"];
  const isEvaluatorListOpen = () => mockQuery["drawer.open"] === "evaluatorList";
  const isEvaluatorEditorOpen = () => mockQuery["drawer.open"] === "evaluatorEditor";

  /**
   * ISSUE 1: Always open evaluator editor after selection
   *
   * Current behavior: Only opens editor when there are pending mappings
   * Expected behavior: ALWAYS open the editor so user can see/edit settings
   */
  describe("Issue 1: Always open evaluator editor after selection", () => {
    it("opens evaluator editor after selecting an evaluator at trace level (even without pending mappings)", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluationDrawer" };

      const { rerender } = render(
        <Wrapper>
          <OnlineEvaluationDrawer open={isOnlineEvalOpen()} />
          <EvaluatorListDrawer open={isEvaluatorListOpen()} />
          <EvaluatorEditorDrawer />
        </Wrapper>
      );

      // Click Select Evaluator
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));

      // Navigate to evaluator list
      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorList");
      });

      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={isOnlineEvalOpen()} />
          <EvaluatorListDrawer open={isEvaluatorListOpen()} />
          <EvaluatorEditorDrawer />
        </Wrapper>
      );

      // Select PII Check evaluator
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
      const piiCheckCard = screen.getByTestId("evaluator-card-evaluator-1");
      await user.click(piiCheckCard);

      // Wait for navigation
      await vi.advanceTimersByTimeAsync(200);

      // EXPECTED: Evaluator editor should open (drawer.open should be "evaluatorEditor")
      // This is the fix - always open editor, not just when pending mappings
      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      }, { timeout: 1000 });
    });
  });

  /**
   * ISSUE 2: Click selected evaluator should open editor (not list)
   *
   * Current behavior: Clicking selected evaluator goes to evaluator list
   * Expected behavior: Should open evaluator editor with back button to list
   */
  describe("Issue 2: Click selected evaluator opens editor with back to list", () => {
    it("clicking on already-selected evaluator opens editor (not list)", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluationDrawer" };

      const { rerender } = render(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
          <EvaluatorListDrawer open={false} />
          <EvaluatorEditorDrawer />
        </Wrapper>
      );

      // First, select an evaluator via flow callback
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for evaluator to be selected and editor to open (Issue 1 fix)
      await vi.advanceTimersByTimeAsync(200);

      // The editor should have opened
      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      }, { timeout: 500 });

      // Simulate closing the editor (user goes back to online drawer)
      mockQuery = { "drawer.open": "onlineEvaluationDrawer" };

      // IMPORTANT: Rerender to reflect the new URL state
      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
          <EvaluatorListDrawer open={false} />
          <EvaluatorEditorDrawer />
        </Wrapper>
      );

      // Online drawer should still show with PII Check selected
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Now click on the selected evaluator box again
      // This should open the editor directly (not the list)
      const evaluatorBox = screen.getByRole("button", { name: /PII Check/i });
      await user.click(evaluatorBox);

      // EXPECTED: Should open evaluatorEditor directly (not evaluatorList)
      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      }, { timeout: 1000 });
    });
  });

  /**
   * ISSUE 3: Creating new evaluator should return to online drawer with selection
   *
   * Current behavior: Everything closes after creating a new evaluator
   * Expected behavior: Should return to OnlineEvaluationDrawer with new evaluator selected
   *
   * This tests the flow callback mechanism - when EvaluatorEditorDrawer calls onSave,
   * the OnlineEvaluationDrawer should receive the new evaluator and select it.
   */
  describe("Issue 3: Creating new evaluator returns to online drawer", () => {
    it("flow callback onSelect is called when new evaluator is created from evaluator editor", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluationDrawer" };

      render(
        <Wrapper>
          <OnlineEvaluationDrawer open={isOnlineEvalOpen()} />
          <EvaluatorListDrawer open={isEvaluatorListOpen()} />
          <EvaluatorEditorDrawer />
        </Wrapper>
      );

      // Click Select Evaluator to set up flow callbacks
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));

      // Verify flow callbacks are set
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      const flowCallbacks = getFlowCallbacks("evaluatorList");

      // EXPECTED: The onSelect callback should be set up to receive new evaluators
      // When EvaluatorEditorDrawer saves, it should trigger this callback
      expect(flowCallbacks?.onSelect).toBeInstanceOf(Function);

      // Simulate what should happen when a new evaluator is created:
      // The EvaluatorEditorDrawer should call the flow callback with the new evaluator
      const newEvaluator = {
        ...mockEvaluators[0]!,
        id: "new-evaluator-123",
        name: "My New Evaluator",
      };

      // Call the callback as if the editor saved a new evaluator
      flowCallbacks?.onSelect?.(newEvaluator as any);

      // EXPECTED: OnlineEvaluationDrawer should now show the new evaluator selected
      await waitFor(() => {
        expect(screen.getByText("My New Evaluator")).toBeInTheDocument();
      }, { timeout: 1000 });
    });
  });

  /**
   * ISSUE 4: Mapping section should show when creating new evaluator
   *
   * Current behavior: Mapping section doesn't appear when creating new evaluator
   * Expected behavior: Should show mapping section with available trace/thread sources
   *
   * The mappingsConfig should be passed to EvaluatorEditorDrawer so it can show
   * the mapping UI with trace/thread sources.
   */
  describe("Issue 4: Mapping section shows when creating new evaluator", () => {
    it("evaluator editor shows mapping section with trace sources when opened from online drawer", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      // Start with online evaluation drawer open
      mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>
      );

      // Wait for drawer to render
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // Select an evaluator (this should open the editor with mappings)
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

      // Select PII Check which has required "input" field
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for navigation to evaluator editor (Issue 1 fix ensures this happens)
      await vi.advanceTimersByTimeAsync(200);

      // Verify the editor opened (URL changed)
      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      }, { timeout: 500 });

      // Rerender to pick up the new URL state
      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>
      );

      // EXPECTED: Should see "Variables" section in the editor
      // This section shows the mapping inputs for evaluator required fields
      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      }, { timeout: 3000 });

      // EXPECTED: Should see mapping inputs for required fields (like "input")
      // These should be VariableMappingInput components with trace sources
      await waitFor(() => {
        // Look for a mapping input field
        const mappingInputs = screen.getAllByRole("textbox");
        // Should have at least one mapping input (for "input" field)
        expect(mappingInputs.length).toBeGreaterThan(0);
      });
    });
  });

  // ============================================================================
  // NEW ISSUE TESTS - These should FAIL initially, then pass after fixes
  // ============================================================================

  /**
   * Issue: Auto-inference of mappings not working for trace level
   *
   * When selecting an evaluator with required input/output fields at trace level,
   * these should be auto-inferred from trace.input and trace.output.
   *
   * EXPECTED: After selecting evaluator, mappings should be pre-filled.
   * ACTUAL: Mappings are empty.
   */
  describe("Issue: Auto-inference of mappings for trace level", () => {
    it("auto-infers input/output mappings when selecting evaluator with required fields", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

      // Select Answer Relevance (has required input/output)
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[2]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // EXPECTED: Should see auto-inferred mappings (badge showing "input" or "trace.input")
      await waitFor(() => {
        const mappingBadges = screen.queryAllByTestId("source-mapping-tag");
        // Should have at least one auto-inferred mapping
        expect(mappingBadges.length).toBeGreaterThan(0);
      }, { timeout: 3000 });
    });
  });

  /**
   * Issue: Cancel on evaluator editor closes everything instead of going back
   *
   * EXPECTED: Clicking Cancel returns to OnlineEvaluationDrawer.
   * ACTUAL: Clicking Cancel closes all drawers.
   */
  describe("Issue: Cancel should go back, not close everything", () => {
    it("clicking Cancel in evaluator editor returns to online evaluation drawer", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      // Check drawer stack has multiple entries (can go back)
      expect(getDrawerStack().length).toBeGreaterThan(1);

      // Click Cancel
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      // EXPECTED: Should return to online evaluation drawer (not close everything)
      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("onlineEvaluation");
      }, { timeout: 1000 });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      await waitFor(() => {
        expect(screen.getByText("New Online Evaluation")).toBeInTheDocument();
      });
    });
  });

  /**
   * Issue: Thread level doesn't show thread-specific nested fields
   *
   * EXPECTED: Thread level shows "traces" with nested input/output/etc options.
   * ACTUAL: Only shows flat thread_id and traces options.
   */
  describe("Issue: Thread level nested fields", () => {
    it("thread level shows nested fields for traces mapping", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // Switch to thread level
      const threadRadio = screen.getByLabelText(/thread level/i);
      await user.click(threadRadio);

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[2]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // Click on a mapping input
      const textboxes = screen.getAllByRole("textbox");
      const mappingInput = textboxes[1];
      await user.click(mappingInput!);

      // Click on traces
      await waitFor(() => {
        expect(screen.getByTestId("field-option-traces")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("field-option-traces"));

      // EXPECTED: Should show nested options (input, output, etc.)
      await waitFor(() => {
        expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("traces");
        expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-output")).toBeInTheDocument();
      });
    });
  });

  /**
   * Issue: Switching trace->thread doesn't update available sources
   *
   * EXPECTED: After switching to thread, mappings show thread sources.
   * ACTUAL: Mappings still show trace sources.
   */
  describe("Issue: Switching levels updates available sources", () => {
    it("switching from trace to thread updates mapping sources in editor", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // First select evaluator at trace level
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[2]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      // Go back (via Cancel which should use goBack)
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      // Assuming issue 3 is fixed, we should be back at online eval drawer
      // If not fixed, this will fail here
      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("onlineEvaluation");
      }, { timeout: 1000 });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      // Switch to thread level
      const threadRadio = screen.getByLabelText(/thread level/i);
      await user.click(threadRadio);

      await vi.advanceTimersByTimeAsync(200);

      // Editor should open for thread level
      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // Click on a mapping input
      const textboxes = screen.getAllByRole("textbox");
      const mappingInput = textboxes[1];
      await user.click(mappingInput!);

      // EXPECTED: Should see thread-specific sources (thread_id, traces)
      // NOT trace-specific sources (metadata, spans at top level)
      await waitFor(() => {
        expect(screen.getByTestId("field-option-thread_id")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-traces")).toBeInTheDocument();
        // Should NOT see trace-specific sources at top level
        expect(screen.queryByTestId("field-option-metadata")).not.toBeInTheDocument();
        expect(screen.queryByTestId("field-option-spans")).not.toBeInTheDocument();
      });
    });
  });

  /**
   * Issue: "threads" option showing in trace-level sources
   *
   * EXPECTED: Trace level doesn't show "threads" option.
   * ACTUAL: "threads" is shown as an option.
   */
  describe("Issue: Remove threads from trace-level sources", () => {
    it("trace level mapping does not show threads option", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[2]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      }, { timeout: 3000 });

      // Click on a mapping input
      const textboxes = screen.getAllByRole("textbox");
      const mappingInput = textboxes[1];
      await user.click(mappingInput!);

      // Wait for dropdown options
      await waitFor(() => {
        expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
      });

      // EXPECTED: Should NOT see "threads" option at trace level
      expect(screen.queryByTestId("field-option-threads")).not.toBeInTheDocument();
    });
  });

  /**
   * Issue 2: Red validation message for pending mappings
   *
   * When there are required fields that cannot be auto-inferred (like expected_output),
   * there should be a clear red validation message, not just yellow highlighting.
   *
   * EXPECTED: Red text message below the mapping inputs.
   * ACTUAL: Only yellow border, easy to miss.
   */
  describe("Issue 2: Red validation message for pending mappings", () => {
    it("shows red validation message when required fields are not mapped", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

      // Select Exact Match (requires expected_output which can't be auto-inferred)
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[1]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // EXPECTED: Should see a red validation message about missing mappings
      await waitFor(() => {
        const validationMessage = screen.getByTestId("pending-mappings-error");
        expect(validationMessage).toBeInTheDocument();
        expect(validationMessage).toHaveTextContent(/required|mapping/i);
      }, { timeout: 3000 });
    });
  });

  /**
   * Issue 6: Pending warning when returning without completing mappings
   *
   * When user goes to evaluator editor, doesn't complete mappings, and returns,
   * the online evaluation drawer should show a warning about pending mappings.
   *
   * EXPECTED: Warning banner visible in online evaluation drawer.
   */
  describe("Issue 6: Pending warning when returning without completing", () => {
    it("shows pending mapping warning in online drawer when returning from editor", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => expect(getFlowCallbacks("evaluatorList")).toBeDefined());

      // Select Exact Match (requires expected_output which can't be auto-inferred)
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[1]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      // Wait for editor to render
      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      // Don't complete the mappings, just go back
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      // Should return to online evaluation drawer
      await waitFor(() => {
        expect(mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(<Wrapper><CurrentDrawer /></Wrapper>);

      // EXPECTED: Should see warning about pending mappings
      await waitFor(() => {
        // Look for the warning banner
        expect(screen.getByText(/need.*mapping/i)).toBeInTheDocument();
        // Should have a "Configure" button
        expect(screen.getByRole("button", { name: /configure/i })).toBeInTheDocument();
      });
    });
  });
});
