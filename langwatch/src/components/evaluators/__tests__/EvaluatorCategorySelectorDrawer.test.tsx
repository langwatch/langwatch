/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluatorCategorySelectorDrawer } from "../EvaluatorCategorySelectorDrawer";

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

// Wrapper with Chakra provider
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
    it("opens evaluator type selector when selecting a category", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Expected Answer")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("evaluator-category-expected_answer"));

      expect(mockOpenDrawer).toHaveBeenCalledWith("evaluatorTypeSelector", {
        category: "expected_answer",
      });
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
});
