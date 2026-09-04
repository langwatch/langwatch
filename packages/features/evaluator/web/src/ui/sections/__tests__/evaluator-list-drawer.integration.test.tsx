/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluatorListDrawer } from "../evaluator-list-drawer";

const mockEvaluators = [
  {
    id: "evaluator-1",
    name: "Exact Match",
    type: "evaluator",
    config: { evaluatorType: "langevals/exact_match", caseSensitive: false },
    workflowId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-10T10:00:00Z"),
    updatedAt: new Date("2025-01-15T10:00:00Z"),
  },
  {
    id: "evaluator-2",
    name: "Custom Scorer",
    type: "workflow",
    config: {},
    workflowId: "workflow-scorer-123",
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-01T10:00:00Z"),
    updatedAt: new Date("2025-01-08T10:00:00Z"),
  },
];

let evaluatorsQueryData: typeof mockEvaluators | [] = mockEvaluators;

vi.mock("../../../model/evaluator-host", () => ({
  useEvaluatorHost: () => ({
    scope: () => ({ projectId: "test-project-id", projectSlug: "test-project" }),
  }),
}));

vi.mock("../../../behavior/evaluator-api", () => ({
  evaluatorApi: {
    useUtils: () => ({
      evaluators: { getAll: { invalidate: vi.fn() } },
    }),
    evaluators: {
      getAll: {
        useQuery: () => ({ data: evaluatorsQueryData, isLoading: false }),
      },
      delete: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

const mockOpenDrawer = vi.fn();
const mockCloseDrawer = vi.fn();

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => undefined,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("EvaluatorListDrawer", () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnCreateNew = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    evaluatorsQueryData = mockEvaluators;
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (props = {}) => {
    return render(
      <EvaluatorListDrawer
        open={true}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        onCreateNew={mockOnCreateNew}
        {...props}
      />,
      { wrapper: Wrapper },
    );
  };

  describe("given evaluators exist", () => {
    /** @scenario EvaluatorListDrawer shows available evaluators */
    it("shows evaluator list with all evaluators", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
        expect(screen.getByText("Custom Scorer")).toBeInTheDocument();
      });
    });
  });

  describe("when selecting an evaluator", () => {
    /** @scenario Select evaluator from drawer */
    it("calls onSelect with the chosen evaluator", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("evaluator-card-evaluator-1"));

      expect(mockOnSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "evaluator-1",
          name: "Exact Match",
          type: "evaluator",
        }),
      );
    });
  });

  describe("when clicking New Evaluator", () => {
    /** @scenario Create new evaluator from drawer flow */
    it("calls onCreateNew", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("new-evaluator-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("new-evaluator-button"));

      expect(mockOnCreateNew).toHaveBeenCalled();
    });
  });

  describe("given no evaluators exist", () => {
    /** @scenario EvaluatorListDrawer empty state */
    it("shows the empty state with a create-first-evaluator action", async () => {
      evaluatorsQueryData = [];
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("No evaluators yet")).toBeInTheDocument();
        expect(screen.getByTestId("create-first-evaluator-button")).toBeInTheDocument();
      });
    });
  });
});
