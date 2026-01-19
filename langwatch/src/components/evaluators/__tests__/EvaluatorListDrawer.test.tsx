/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "~/utils/api";
import { EvaluatorListDrawer } from "../EvaluatorListDrawer";

// Mock dependencies
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
  }),
  getComplexProps: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id" },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
  }),
}));

// Mock evaluators data
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
    name: "Answer Correctness",
    type: "evaluator",
    config: { evaluatorType: "langevals/llm_judge", model: "gpt-4o" },
    workflowId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-05T10:00:00Z"),
    updatedAt: new Date("2025-01-12T10:00:00Z"),
  },
  {
    id: "evaluator-3",
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

// Mock the API
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

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("EvaluatorListDrawer", () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnCreateNew = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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

  describe("Basic rendering", () => {
    it("shows Choose Evaluator header", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Choose Evaluator")).toBeInTheDocument();
      });
    });

    it("shows New Evaluator button at top", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("new-evaluator-button")).toBeInTheDocument();
        expect(screen.getByText("New Evaluator")).toBeInTheDocument();
      });
    });

    it("shows evaluator list with all evaluators", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
        expect(screen.getByText("Answer Correctness")).toBeInTheDocument();
        expect(screen.getByText("Custom Scorer")).toBeInTheDocument();
      });
    });

    it("shows evaluator type labels", async () => {
      renderDrawer();
      await waitFor(() => {
        // Two built-in evaluators
        const builtInLabels = screen.getAllByText("Built-in");
        expect(builtInLabels).toHaveLength(2);
        // One workflow evaluator
        expect(screen.getByText("Workflow")).toBeInTheDocument();
      });
    });
  });

  describe("Selection", () => {
    it("calls onSelect when clicking an evaluator", async () => {
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

    it("closes drawer after selection", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("evaluator-card-evaluator-1"));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Create new evaluator", () => {
    it("calls onCreateNew when clicking New Evaluator button", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("new-evaluator-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("new-evaluator-button"));

      expect(mockOnCreateNew).toHaveBeenCalled();
    });
  });

  describe("Loading state", () => {
    it("shows spinner when loading", async () => {
      vi.mocked(api.evaluators.getAll.useQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof api.evaluators.getAll.useQuery>);

      renderDrawer();

      await waitFor(() => {
        const spinner = document.querySelector(".chakra-spinner");
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe("Empty state", () => {
    it("shows empty message when no evaluators", async () => {
      vi.mocked(api.evaluators.getAll.useQuery).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof api.evaluators.getAll.useQuery>);

      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("No evaluators yet")).toBeInTheDocument();
        expect(
          screen.getByText("Create your first evaluator to get started"),
        ).toBeInTheDocument();
      });
    });

    it("shows create first evaluator button in empty state", async () => {
      vi.mocked(api.evaluators.getAll.useQuery).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof api.evaluators.getAll.useQuery>);

      renderDrawer();

      await waitFor(() => {
        expect(
          screen.getByTestId("create-first-evaluator-button"),
        ).toBeInTheDocument();
      });
    });

    it("calls onCreateNew when clicking create first evaluator", async () => {
      const user = userEvent.setup();
      vi.mocked(api.evaluators.getAll.useQuery).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof api.evaluators.getAll.useQuery>);

      renderDrawer();

      await waitFor(() => {
        expect(
          screen.getByTestId("create-first-evaluator-button"),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("create-first-evaluator-button"));

      expect(mockOnCreateNew).toHaveBeenCalled();
    });
  });
});
