/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluatorEditorDrawer } from "../EvaluatorEditorDrawer";

// Mock AVAILABLE_EVALUATORS
vi.mock("~/server/evaluations/evaluators.generated", () => ({
  AVAILABLE_EVALUATORS: {
    "langevals/exact_match": {
      name: "Exact Match",
      description: "Check if output exactly matches expected",
      settings: {
        case_sensitive: {
          description: "Whether the comparison is case-sensitive",
          default: true,
        },
        trim_whitespace: {
          description: "Whether to trim whitespace before comparison",
          default: true,
        },
      },
    },
    "langevals/llm_boolean": {
      name: "LLM Boolean",
      description: "LLM returns true/false",
      settings: {
        model: {
          description: "The model to use for evaluation",
          default: "openai/gpt-4o",
        },
        prompt: {
          description: "The prompt template for evaluation",
          default: "Evaluate the following response:",
        },
      },
    },
  },
}));

// Mock dependencies
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

const mockOpenDrawer = vi.fn();
const mockCloseDrawer = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    drawerOpen: vi.fn(() => false),
  }),
  getComplexProps: () => ({ evaluatorType: "langevals/exact_match" }),
  useDrawerParams: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id" },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
    modelProviders: {},
  }),
}));

// Mock the tRPC API
const mockCreateMutate = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    evaluators: {
      create: {
        useMutation: vi.fn(() => ({
          mutate: mockCreateMutate,
          isPending: false,
        })),
      },
      getById: {
        useQuery: vi.fn(() => ({
          data: null,
          isLoading: false,
        })),
      },
      update: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isPending: false,
        })),
      },
    },
    useContext: vi.fn(() => ({
      evaluators: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    })),
  },
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("EvaluatorEditorDrawer", () => {
  const mockOnSave = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (props = {}) => {
    return render(
      <EvaluatorEditorDrawer
        open={true}
        onClose={mockOnClose}
        evaluatorType="langevals/exact_match"
        {...props}
      />,
      { wrapper: Wrapper },
    );
  };

  describe("Basic rendering - New Evaluator", () => {
    it("shows evaluator name in header", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
      });
    });

    it("shows back button", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("back-button")).toBeInTheDocument();
      });
    });

    it("shows name input field", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("evaluator-name-input")).toBeInTheDocument();
      });
    });

    it("shows Save button", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("save-evaluator-button")).toBeInTheDocument();
      });
    });
  });

  describe("Navigation", () => {
    it("calls onBack when clicking back button", async () => {
      const user = userEvent.setup();
      renderDrawer({ onBack: mockOnBack });

      await waitFor(() => {
        expect(screen.getByTestId("back-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("back-button"));

      expect(mockOnBack).toHaveBeenCalled();
    });
  });

  describe("Form submission", () => {
    it("calls create mutation when saving new evaluator", async () => {
      const user = userEvent.setup();
      renderDrawer({ onSave: mockOnSave });

      await waitFor(() => {
        expect(screen.getByTestId("evaluator-name-input")).toBeInTheDocument();
      });

      // Enter name
      const nameInput = screen.getByTestId("evaluator-name-input");
      await user.clear(nameInput);
      await user.type(nameInput, "My Exact Match");

      // Click save
      await user.click(screen.getByTestId("save-evaluator-button"));

      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "test-project-id",
          name: "My Exact Match",
          type: "evaluator",
          config: expect.objectContaining({
            evaluatorType: "langevals/exact_match",
          }),
        }),
      );
    });
  });

  describe("Validation", () => {
    it("disables save button when name is empty", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("evaluator-name-input")).toBeInTheDocument();
      });

      // Clear name
      const nameInput = screen.getByTestId("evaluator-name-input");
      await user.clear(nameInput);

      // Save button should be disabled
      expect(screen.getByTestId("save-evaluator-button")).toBeDisabled();
    });
  });
});
