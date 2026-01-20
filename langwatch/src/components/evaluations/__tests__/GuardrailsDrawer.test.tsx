/**
 * @vitest-environment jsdom
 *
 * Integration tests for GuardrailsDrawer.
 * Only tRPC endpoints are mocked - drawer system works naturally.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { GuardrailsDrawer, clearGuardrailsDrawerState } from "../GuardrailsDrawer";
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

// Only mock tRPC API
vi.mock("~/utils/api", () => ({
  api: {
    evaluators: {
      getAll: {
        useQuery: vi.fn(() => ({
          data: mockEvaluators,
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
    useContext: vi.fn(() => ({
      evaluators: {
        getAll: { invalidate: vi.fn() },
      },
    })),
  },
}));

// Mock project hook - needed by drawers
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
 *
 * The bug: When navigating to EvaluatorListDrawer, GuardrailsDrawer's `open` prop
 * becomes false. When returning, it becomes true again. But the useEffect that
 * resets state on open sees `isOpen && !sessionInitializedRef` and RESETS the state.
 */
describe("GuardrailsDrawer + EvaluatorListDrawer Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = {};
    clearDrawerStack();
    clearFlowCallbacks();
    clearGuardrailsDrawerState();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("CRITICAL: evaluator selection persists when returning from EvaluatorListDrawer", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Helper to determine which drawer should be open based on URL
    const isGuardrailsOpen = () => mockQuery["drawer.open"] === "guardrailsDrawer" || mockQuery["drawer.open"] === undefined;
    const isEvaluatorListOpen = () => mockQuery["drawer.open"] === "evaluatorList";

    // Start with guardrails drawer open
    mockQuery = { "drawer.open": "guardrailsDrawer" };

    // Render BOTH drawers - the open prop is controlled by URL state (like real app)
    const { rerender } = render(
      <Wrapper>
        <GuardrailsDrawer open={isGuardrailsOpen()} />
        <EvaluatorListDrawer open={isEvaluatorListOpen()} />
      </Wrapper>
    );

    // Step 1: GuardrailsDrawer is open, shows Select Evaluator
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
    // GuardrailsDrawer.open is now FALSE, EvaluatorListDrawer.open is now TRUE
    rerender(
      <Wrapper>
        <GuardrailsDrawer open={isGuardrailsOpen()} />
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

    // Step 7: After selection, goBack() navigates back to guardrails drawer
    await waitFor(() => {
      expect(mockQuery["drawer.open"]).not.toBe("evaluatorList");
    });

    // Step 8: Re-render with the REAL state - GuardrailsDrawer.open is TRUE again
    rerender(
      <Wrapper>
        <GuardrailsDrawer open={isGuardrailsOpen()} />
        <EvaluatorListDrawer open={isEvaluatorListOpen()} />
      </Wrapper>
    );

    // Step 9: CRITICAL - GuardrailsDrawer should show the selected evaluator
    // THIS IS THE BUG - the state gets reset when open goes true->false->true
    await waitFor(() => {
      // Should show "PII Check" in the selection box (not "Select Evaluator")
      expect(screen.getByText("PII Check")).toBeInTheDocument();
      // Should show the code integration section
      expect(screen.getByText("Integration Code")).toBeInTheDocument();
      // Should NOT show the empty state
      expect(screen.queryByText("Choose an evaluator to use as a guardrail")).not.toBeInTheDocument();
    });
  });
});

describe("GuardrailsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = {};
    clearDrawerStack();
    clearFlowCallbacks();
    clearGuardrailsDrawerState();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("Initial state - click-to-select pattern", () => {
    it("shows Select Evaluator button initially", async () => {
      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
    });

    it("shows New Guardrail header", async () => {
      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("New Guardrail")).toBeInTheDocument();
      });
    });

    it("shows Evaluator field label", async () => {
      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Evaluator")).toBeInTheDocument();
      });
    });

    it("shows placeholder description", async () => {
      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Choose an evaluator to use as a guardrail")).toBeInTheDocument();
      });
    });

    it("does not show code integration before selection", async () => {
      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      expect(screen.queryByText("Integration Code")).not.toBeInTheDocument();
    });

    it("opens evaluator list when clicking Select Evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

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

    it("sets flow callback when clicking Select Evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

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
  });

  describe("After evaluator selection - code integration display", () => {
    const selectEvaluator = async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // Click to open evaluator list
      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      // Simulate evaluator selection
      const callbacks = getFlowCallbacks("evaluatorList");
      callbacks?.onSelect?.(mockEvaluators[0]!);
    };

    it("shows New Guardrail header after selection", async () => {
      await selectEvaluator();

      await waitFor(() => {
        expect(screen.getByText("New Guardrail")).toBeInTheDocument();
      });
    });

    it("displays selected evaluator name", async () => {
      await selectEvaluator();

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
    });

    it("displays evaluator slug", async () => {
      await selectEvaluator();

      await waitFor(() => {
        expect(screen.getByText("pii-check-abc12")).toBeInTheDocument();
      });
    });

    it("shows Change button to select different evaluator", async () => {
      await selectEvaluator();

      await waitFor(() => {
        expect(screen.getByText("Change")).toBeInTheDocument();
      });
    });

    it("shows integration code section", async () => {
      await selectEvaluator();

      await waitFor(() => {
        expect(screen.getByText("Integration Code")).toBeInTheDocument();
      });
    });

    it("shows Python tab active by default", async () => {
      await selectEvaluator();

      await waitFor(() => {
        expect(screen.getByText("Python")).toBeInTheDocument();
        // Check for Python-specific content (async def is Python-only)
        expect(screen.getByText(/async def check_guardrail/)).toBeInTheDocument();
      });
    });

    it("shows TypeScript and cURL tabs", async () => {
      await selectEvaluator();

      await waitFor(() => {
        expect(screen.getByText("TypeScript")).toBeInTheDocument();
        expect(screen.getByText("cURL")).toBeInTheDocument();
      });
    });

    it("shows Copy button", async () => {
      await selectEvaluator();

      await waitFor(() => {
        expect(screen.getByText("Copy")).toBeInTheDocument();
      });
    });

    it("shows API key replacement note", async () => {
      await selectEvaluator();

      await waitFor(() => {
        expect(
          screen.getByText(/Replace.*with your actual LangWatch API key/i)
        ).toBeInTheDocument();
      });
    });

    it("code contains evaluator slug path", async () => {
      await selectEvaluator();

      await waitFor(() => {
        // Check that the code block contains the evaluator slug (Python-specific pattern)
        expect(screen.getByText(/evaluator="evaluators\/pii-check-abc12"/)).toBeInTheDocument();
      });
    });
  });

  describe("Tab switching", () => {
    const selectEvaluatorAndWait = async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      const callbacks = getFlowCallbacks("evaluatorList");
      callbacks?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("Integration Code")).toBeInTheDocument();
      });

      return user;
    };

    it("switches to TypeScript tab when clicked", async () => {
      const user = await selectEvaluatorAndWait();

      await user.click(screen.getByText("TypeScript"));

      await waitFor(() => {
        expect(screen.getByText(/new LangWatch/)).toBeInTheDocument();
      });
    });

    it("switches to cURL tab when clicked", async () => {
      const user = await selectEvaluatorAndWait();

      await user.click(screen.getByText("cURL"));

      await waitFor(() => {
        expect(screen.getByText(/curl -X POST/)).toBeInTheDocument();
      });
    });
  });

  describe("Copy functionality", () => {
    it("shows Copied! after clicking copy button", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      // Mock clipboard API properly
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });

      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("Copy")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Copy"));

      await waitFor(() => {
        expect(screen.getByText("Copied!")).toBeInTheDocument();
      });

      expect(mockWriteText).toHaveBeenCalled();
    });
  });

  describe("Change evaluator", () => {
    it("shows Change button after evaluator selection", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // After selection, Change button should be visible
      await waitFor(() => {
        expect(screen.getByText("Change")).toBeInTheDocument();
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
    });
  });

  describe("Clear evaluator", () => {
    it("clears evaluator and shows selection box when clicking X", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<GuardrailsDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
        expect(screen.getByText("Integration Code")).toBeInTheDocument();
      });

      // Click the X button (clear button) - it has the lucide-x class
      const closeButtons = screen.getAllByRole("button");
      const clearButton = closeButtons.find((btn) =>
        btn.querySelector("svg.lucide-x")
      );
      expect(clearButton).toBeDefined();
      await user.click(clearButton!);

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
        expect(screen.queryByText("Integration Code")).not.toBeInTheDocument();
      });
    });
  });

  describe("Close behavior", () => {
    it("calls onClose when clicking Close button", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockOnClose = vi.fn();

      render(<GuardrailsDrawer open={true} onClose={mockOnClose} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Close")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Close"));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Drawer closed state", () => {
    it("does not render content when open is false", () => {
      render(<GuardrailsDrawer open={false} />, { wrapper: Wrapper });

      expect(screen.queryByText("New Guardrail")).not.toBeInTheDocument();
    });
  });

  describe("Full flow with EvaluatorListDrawer", () => {
    it("GuardrailsDrawer registers flow callback when clicking Select Evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      // Render GuardrailsDrawer
      render(
        <GuardrailsDrawer open={true} />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // Click to select evaluator
      await user.click(screen.getByText("Select Evaluator"));

      // Wait for flow callbacks to be set
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      // The flow callback should be set correctly
      const flowCallbacks = getFlowCallbacks("evaluatorList");
      expect(flowCallbacks?.onSelect).toBeInstanceOf(Function);

      // Simulate what happens when evaluator is selected via the callback
      // (This tests the actual integration - the callback updates GuardrailsDrawer state)
      flowCallbacks?.onSelect?.(mockEvaluators[0]!);

      // GuardrailsDrawer should now show code integration
      await waitFor(() => {
        expect(screen.getByText("Integration Code")).toBeInTheDocument();
        expect(screen.getByText(/evaluator="evaluators\/pii-check-abc12"/)).toBeInTheDocument();
      });
    });

    it("EvaluatorListDrawer calls onSelect callback when evaluator is clicked", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockOnSelect = vi.fn();

      render(
        <EvaluatorListDrawer open={true} onSelect={mockOnSelect} />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText("Choose Evaluator")).toBeInTheDocument();
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Click evaluator card
      await user.click(screen.getByTestId("evaluator-card-evaluator-1"));

      // Should have called onSelect with the evaluator data
      expect(mockOnSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "evaluator-1",
          name: "PII Check",
          slug: "pii-check-abc12",
        })
      );
    });
  });
});
