/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluatorListDrawer } from "../evaluator-list-drawer.tsx";

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

vi.mock("../../../model/evaluator-host.ts", () => ({
  useEvaluatorHost: () => ({
    scope: () => ({ projectId: "test-project-id", projectSlug: "test-project" }),
  }),
}));

vi.mock("../../../behavior/evaluator-api.ts", () => ({
  evaluatorApi: {
    useUtils: () => ({
      evaluators: { getAll: { invalidate: vi.fn() } },
    }),
  },
}));
vi.mock("@langwatch/evaluator-client", () => ({
  evaluatorClient: {
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

vi.mock("@langwatch/browser-host/drawer", () => ({
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
    return renderWithDesignSystem(
      <EvaluatorListDrawer
        open={true}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        onCreateNew={mockOnCreateNew}
        {...props}
      />,
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

  describe("when every evaluator the project has is hidden from this list", () => {
    /** @scenario "The empty state distinguishes no evaluators from all hidden" */
    it("says every evaluator is already attached, with no create-first prompt", async () => {
      renderDrawer({ hiddenEvaluatorIds: ["evaluator-1", "evaluator-2"] });

      expect(await screen.findByText("Every evaluator is already attached")).toBeInTheDocument();
      expect(screen.queryByTestId("create-first-evaluator-button")).not.toBeInTheDocument();
    });
  });

  describe("when some evaluators are hidden from this list", () => {
    it("lists only the rest", async () => {
      renderDrawer({ hiddenEvaluatorIds: ["evaluator-1"] });

      await screen.findByText("Custom Scorer");
      expect(screen.queryByText("Exact Match")).not.toBeInTheDocument();
    });
  });
});
