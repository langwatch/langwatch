/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluatorCategorySelectorDrawer } from "../EvaluatorCategorySelectorDrawer";

// Stub the inline type-selector content so this test suite stays focused on
// category-step behavior without pulling in tRPC-backed dependencies.
vi.mock("../EvaluatorTypeSelectorContent", () => ({
  categoryNames: {
    expected_answer: "Expected Answer",
    llm_judge: "LLM as Judge",
    rag: "RAG Quality",
    quality: "Quality Aspects",
    safety: "Safety",
  },
  EvaluatorTypeSelectorContent: ({
    category,
    onSelect,
  }: {
    category?: string;
    onSelect?: (evaluatorType: string) => void;
  }) => (
    <div data-testid="mock-type-selector-content">
      type-content-for-{category}
      <button
        data-testid="mock-type-pick"
        onClick={() => onSelect?.("langevals/exact_match")}
      >
        pick
      </button>
    </div>
  ),
}));

// The unified drawer now hosts the editor step in the same AnimatePresence as
// the picker steps, so the shared controller/body/footer are imported at parent
// level. Mock them here so the test environment doesn't need tRPC plumbing.
vi.mock("../EvaluatorEditorShared", () => ({
  useEvaluatorEditorController: () => ({
    title: "Mock Editor",
    hasUnsavedChanges: false,
    onLocalConfigChange: undefined,
    handleClose: vi.fn(),
    handleSave: vi.fn(),
    handleDiscard: vi.fn(),
    handleApply: vi.fn(),
    flushLocalConfig: vi.fn(),
  }),
  EvaluatorEditorBody: () => <div data-testid="mock-editor-body" />,
  EvaluatorEditorFooter: () => <div data-testid="mock-editor-footer" />,
  EvaluatorEditorHeading: () => <span data-testid="mock-editor-heading" />,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

const mockOpenDrawer = vi.fn();
const mockCloseDrawer = vi.fn();
const mockGoBack = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: mockGoBack,
  }),
  getComplexProps: () => ({}),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("EvaluatorCategorySelectorDrawer", () => {
  const mockOnSelectCategory = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (props = {}) => {
    return render(
      <EvaluatorCategorySelectorDrawer
        open={true}
        onClose={mockOnClose}
        onSelectCategory={mockOnSelectCategory}
        {...props}
      />,
      { wrapper: Wrapper },
    );
  };

  describe("Basic rendering", () => {
    it("shows Choose Evaluator Category header", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(
          screen.getByText("Choose Evaluator Category"),
        ).toBeInTheDocument();
      });
    });

    it("shows all evaluator categories", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Expected Answer")).toBeInTheDocument();
        expect(screen.getByText("LLM as Judge")).toBeInTheDocument();
        expect(screen.getByText("RAG Quality")).toBeInTheDocument();
        expect(screen.getByText("Quality Aspects")).toBeInTheDocument();
        expect(screen.getByText("Safety")).toBeInTheDocument();
      });
    });

    it("shows Custom (from Workflow) option", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Custom (from Workflow)")).toBeInTheDocument();
      });
    });
  });

  describe("Navigation", () => {
    it("switches to the type view when selecting a category", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Expected Answer")).toBeInTheDocument();
      });

      await user.click(
        screen.getByTestId("evaluator-category-expected_answer"),
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("mock-type-selector-content"),
        ).toHaveTextContent("type-content-for-expected_answer");
      });
      // Old behavior delegated to a second drawer via openDrawer — the unified
      // flow swaps views inline instead.
      expect(mockOpenDrawer).not.toHaveBeenCalledWith(
        "evaluatorTypeSelector",
        expect.anything(),
      );
    });

    it("calls onSelectCategory when selecting a category", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("LLM as Judge")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("evaluator-category-llm_judge"));

      expect(mockOnSelectCategory).toHaveBeenCalledWith("llm_judge");
    });

    it("shows a back button in the type view that returns to the category list", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(screen.getByTestId("evaluator-category-safety"));

      const backButton = await screen.findByTestId("back-button");
      await user.click(backButton);

      await waitFor(() => {
        expect(
          screen.getByText("Choose Evaluator Category"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Close behavior", () => {
    it("calls onClose when cancel button is clicked", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("when the editor step is active", () => {
    it("renders the editor body and footer inline", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(screen.getByTestId("evaluator-category-expected_answer"));
      await user.click(await screen.findByTestId("mock-type-pick"));

      await waitFor(() => {
        expect(screen.getByTestId("mock-editor-body")).toBeInTheDocument();
        expect(screen.getByTestId("mock-editor-footer")).toBeInTheDocument();
        expect(screen.getByTestId("mock-editor-heading")).toBeInTheDocument();
      });
      // Editor step must be hosted inline — no separate drawer opened.
      expect(mockOpenDrawer).not.toHaveBeenCalledWith(
        "evaluatorEditor",
        expect.anything(),
      );
    });
  });

  describe("when the drawer is closed and re-opened", () => {
    it("resets the view back to the category step", async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <EvaluatorCategorySelectorDrawer
          open={true}
          onClose={mockOnClose}
          onSelectCategory={mockOnSelectCategory}
        />,
        { wrapper: Wrapper },
      );

      // Drill into the type step
      await user.click(screen.getByTestId("evaluator-category-safety"));
      await waitFor(() => {
        expect(
          screen.getByTestId("mock-type-selector-content"),
        ).toBeInTheDocument();
      });

      // Close the drawer
      rerender(
        <EvaluatorCategorySelectorDrawer
          open={false}
          onClose={mockOnClose}
          onSelectCategory={mockOnSelectCategory}
        />,
      );

      // Re-open — should start from the category step again, not from the
      // last-visited type step.
      rerender(
        <EvaluatorCategorySelectorDrawer
          open={true}
          onClose={mockOnClose}
          onSelectCategory={mockOnSelectCategory}
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByText("Choose Evaluator Category"),
        ).toBeInTheDocument();
      });
    });
  });
});
