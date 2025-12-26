/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluatorTypeSelectorDrawer } from "../EvaluatorTypeSelectorDrawer";

// Mock AVAILABLE_EVALUATORS
vi.mock("~/server/evaluations/evaluators.generated", () => ({
  AVAILABLE_EVALUATORS: {
    "langevals/exact_match": {
      name: "Exact Match",
      description: "Check if output exactly matches expected",
    },
    "langevals/llm_answer_match": {
      name: "LLM Answer Match",
      description: "Check if output matches semantically",
    },
    "langevals/llm_boolean": {
      name: "LLM Boolean",
      description: "LLM returns true/false",
    },
    "langevals/llm_score": {
      name: "LLM Score",
      description: "LLM returns a score",
    },
    "langevals/llm_category": {
      name: "LLM Category",
      description: "LLM returns a category",
    },
    "ragas/faithfulness": {
      name: "Ragas Faithfulness",
      description: "Check faithfulness to context",
    },
    "ragas/factual_correctness": {
      name: "Factual Correctness",
      description: "Check factual correctness",
    },
    "ragas/rouge_score": {
      name: "Rouge Score",
      description: "ROUGE scoring",
    },
    "ragas/bleu_score": {
      name: "BLEU Score",
      description: "BLEU scoring",
    },
    "ragas/response_relevancy": {
      name: "Response Relevancy",
      description: "Check response relevancy",
    },
    "ragas/response_context_recall": {
      name: "Response Context Recall",
      description: "Check context recall",
    },
    "ragas/response_context_precision": {
      name: "Response Context Precision",
      description: "Check context precision",
    },
    "ragas/context_f1": {
      name: "Context F1",
      description: "F1 score for context",
    },
    "lingua/language_detection": {
      name: "Language Detection",
      description: "Detect language",
    },
    "ragas/summarization_score": {
      name: "Summarization Score",
      description: "Score summarization",
    },
    "langevals/valid_format": {
      name: "Valid Format",
      description: "Check valid format",
    },
    "presidio/pii_detection": {
      name: "PII Detection",
      description: "Detect PII",
    },
    "azure/prompt_injection": {
      name: "Prompt Injection Detection",
      description: "Detect prompt injection",
    },
    "azure/content_safety": {
      name: "Content Safety",
      description: "Check content safety",
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
  getComplexProps: () => ({}),
  useDrawerParams: () => ({}),
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("EvaluatorTypeSelectorDrawer", () => {
  const mockOnSelect = vi.fn();
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
      <EvaluatorTypeSelectorDrawer
        open={true}
        onClose={mockOnClose}
        category="expected_answer"
        {...props}
      />,
      { wrapper: Wrapper },
    );
  };

  describe("Basic rendering", () => {
    it("shows header with category name", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(
          screen.getByText(/expected answer/i),
        ).toBeInTheDocument();
      });
    });

    it("shows back button", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("back-button")).toBeInTheDocument();
      });
    });

    it("shows evaluators for the selected category", async () => {
      renderDrawer({ category: "expected_answer" });

      await waitFor(() => {
        // Expected Answer category evaluators
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
      });
    });

    it("shows evaluator descriptions", async () => {
      renderDrawer({ category: "expected_answer" });

      await waitFor(() => {
        // Look for description text
        expect(
          screen.getByText(/Check if output exactly matches/i),
        ).toBeInTheDocument();
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

    it("opens evaluator editor when selecting an evaluator", async () => {
      const user = userEvent.setup();
      renderDrawer({ onSelect: mockOnSelect });

      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Exact Match"));

      // Should open evaluator editor drawer
      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "evaluatorEditor",
        expect.objectContaining({
          evaluatorType: expect.stringContaining("exact_match"),
        }),
      );
    });
  });

  describe("Different categories", () => {
    it("shows LLM Judge evaluators for llm_judge category", async () => {
      renderDrawer({ category: "llm_judge" });

      expect(await screen.findByText("LLM Boolean")).toBeInTheDocument();
    });

    it("shows RAG evaluators for rag category", async () => {
      renderDrawer({ category: "rag" });

      // Use exact name from mock
      expect(await screen.findByText("Ragas Faithfulness")).toBeInTheDocument();
    });

    it("shows Safety evaluators for safety category", async () => {
      renderDrawer({ category: "safety" });

      expect(await screen.findByText("PII Detection")).toBeInTheDocument();
    });
  });

  describe("Close behavior", () => {
    it("calls onClose when cancel button is clicked", async () => {
      const user = userEvent.setup();
      renderDrawer({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
