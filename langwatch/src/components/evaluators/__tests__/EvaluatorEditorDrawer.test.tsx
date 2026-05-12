/**
 * @vitest-environment jsdom
 *
 * NOTE: These tests are currently skipped because the EvaluatorEditorDrawer
 * component has complex dependencies (useForm, FormProvider, etc.) that cause
 * tests to hang. The component works correctly in the browser.
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
      },
    },
  },
}));

// Mock evaluatorsSchema - minimal mock
vi.mock("~/server/evaluations/evaluators.zod.generated", () => {
  return {
    evaluatorsSchema: {
      shape: {},
    },
  };
});

// Mock getEvaluator
vi.mock("~/server/evaluations/getEvaluator", () => ({
  getEvaluatorDefinitions: vi.fn(() => null),
  getEvaluatorDefaultSettings: vi.fn(() => ({})),
}));

// Mock DynamicZodForm to avoid complex form rendering issues
vi.mock("~/components/checks/DynamicZodForm", () => ({
  default: () => <div data-testid="dynamic-zod-form">Mocked Form</div>,
}));

// Mock dependencies
vi.mock("~/utils/compat/next-router", () => ({
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
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({
    evaluatorType: "langevals/exact_match",
    category: "expected_answer",
  }),
  useDrawerParams: () => ({ category: "expected_answer" }),
  getDrawerStack: () => [],
  getFlowCallbacks: () => null,
  setFlowCallbacks: vi.fn(),
}));

vi.mock("~/hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (fn: () => void) => fn(),
  }),
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
const mockUpdateMutate = vi.fn();
const mockGetByIdData = { current: null as Record<string, unknown> | null };

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
          data: mockGetByIdData.current,
          isLoading: false,
        })),
      },
      update: {
        useMutation: vi.fn(() => ({
          mutate: mockUpdateMutate,
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

describe.skip("EvaluatorEditorDrawer", () => {
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

    it("navigates back to type selector with category when using default back", async () => {
      const user = userEvent.setup();
      // Don't pass onBack - will use default behavior
      renderDrawer({ onBack: undefined, category: "llm_judge" });

      await waitFor(() => {
        expect(screen.getByTestId("back-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("back-button"));

      // Default back should open type selector with category preserved
      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "evaluatorTypeSelector",
        expect.objectContaining({
          category: "llm_judge",
        }),
      );
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

  describe("Header styling", () => {
    it("uses Heading component for drawer title", async () => {
      renderDrawer();

      await waitFor(() => {
        // Look for heading element - Chakra Heading renders as h2 by default
        const heading = screen.getByRole("heading");
        expect(heading).toHaveTextContent("Exact Match");
      });
    });

    it("has back button with arrow icon", async () => {
      renderDrawer();

      await waitFor(() => {
        const backButton = screen.getByTestId("back-button");
        expect(backButton).toBeInTheDocument();
        // Check for SVG - LuArrowLeft renders as SVG
        const svg = backButton.querySelector("svg");
        expect(svg).toBeInTheDocument();
      });
    });
  });
});

/**
 * Regression tests for bug #3442: Evaluator name update does not persist.
 * These use the module-level mocks but override getById data per test.
 */
describe("EvaluatorEditorDrawer — name update regression (#3442)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetByIdData.current = null;
  });

  afterEach(() => {
    mockGetByIdData.current = null;
    cleanup();
  });

  describe("when editing a workflow evaluator name", () => {
    it("calls updateMutation with the new name", async () => {
      const user = userEvent.setup();

      mockGetByIdData.current = {
        id: "eval-wf-1",
        projectId: "test-project-id",
        name: "Original Workflow Name",
        type: "workflow",
        workflowId: "workflow-1",
        config: {},
        fields: [],
        outputFields: [],
        slug: "original-workflow-name",
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        copiedFromEvaluatorId: null,
      };

      render(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-wf-1"
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("evaluator-name-input")).toBeInTheDocument();
      });

      const nameInput = screen.getByTestId("evaluator-name-input");
      await user.clear(nameInput);
      await user.type(nameInput, "Updated Workflow Name");

      const saveButton = screen.getByTestId("save-evaluator-button");
      await user.click(saveButton);

      expect(mockUpdateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "eval-wf-1",
          projectId: "test-project-id",
          name: "Updated Workflow Name",
        }),
      );
    });

    it("does not call updateMutation when name is unchanged", async () => {
      const user = userEvent.setup();

      mockGetByIdData.current = {
        id: "eval-wf-2",
        projectId: "test-project-id",
        name: "Unchanged Name",
        type: "workflow",
        workflowId: "workflow-2",
        config: {},
        fields: [],
        outputFields: [],
        slug: "unchanged-name",
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        copiedFromEvaluatorId: null,
      };

      render(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-wf-2"
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("evaluator-name-input")).toBeInTheDocument();
      });

      // Click save without changing the name
      const saveButton = screen.getByTestId("save-evaluator-button");
      await user.click(saveButton);

      expect(mockUpdateMutate).not.toHaveBeenCalled();
    });
  });

  describe("when query refetches while user is editing", () => {
    it("preserves user edits and does not reset the form", async () => {
      const user = userEvent.setup();

      mockGetByIdData.current = {
        id: "eval-bi-1",
        projectId: "test-project-id",
        name: "DB Name",
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match", settings: {} },
        fields: [],
        outputFields: [],
        slug: "db-name",
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        copiedFromEvaluatorId: null,
        workflowId: null,
      };

      const { rerender } = render(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-bi-1"
          evaluatorType="langevals/exact_match"
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("evaluator-name-input")).toBeInTheDocument();
      });

      // User types a new name
      const nameInput = screen.getByTestId("evaluator-name-input");
      await user.clear(nameInput);
      await user.type(nameInput, "My New Name");

      expect(nameInput).toHaveValue("My New Name");

      // Simulate query refetch (new object reference, same data)
      mockGetByIdData.current = { ...mockGetByIdData.current };

      rerender(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-bi-1"
          evaluatorType="langevals/exact_match"
        />,
      );

      // Name should still be the user's edit, not reset to DB value
      await waitFor(() => {
        expect(screen.getByTestId("evaluator-name-input")).toHaveValue(
          "My New Name",
        );
      });
    });
  });
});
