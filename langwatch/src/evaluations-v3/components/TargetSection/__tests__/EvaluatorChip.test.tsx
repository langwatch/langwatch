/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvaluatorConfig } from "../../../types";
import { EvaluatorChip } from "../EvaluatorChip";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const createEvaluator = (
  overrides: Partial<EvaluatorConfig> = {},
): EvaluatorConfig => ({
  id: "eval-1",
  name: "Exact Match",
  evaluatorType: "langevals/exact_match",
  dbEvaluatorId: "db-eval-1",
  mappings: {},
  inputs: [],
  settings: {},
  ...overrides,
});

describe("EvaluatorChip", () => {
  afterEach(() => {
    cleanup();
  });

  describe("Status Display", () => {
    it("shows gray circle for pending status when target has no output", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={undefined}
          targetHasOutput={false}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should show the evaluator name
      expect(screen.getByText("Exact Match")).toBeInTheDocument();
      // Should NOT show spinner (pending state = gray circle)
      // Chakra spinner has class "chakra-spinner"
      expect(container.querySelector(".chakra-spinner")).toBeNull();
    });

    it("shows spinner when target has output but evaluator result is undefined and execution is running", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={undefined}
          targetHasOutput={true}
          isExecutionRunning={true}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should show spinner (running state)
      // Chakra spinner has class "chakra-spinner"
      expect(container.querySelector(".chakra-spinner")).not.toBeNull();
    });

    it("shows pending (gray circle) when target has output but execution is stopped", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={undefined}
          targetHasOutput={true}
          isExecutionRunning={false}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should NOT show spinner - execution has stopped
      expect(container.querySelector(".chakra-spinner")).toBeNull();
    });

    it("shows spinner when result indicates running status", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result="running"
          targetHasOutput={true}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should show spinner
      expect(container.querySelector(".chakra-spinner")).not.toBeNull();
    });

    it("shows result when evaluator completes successfully", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={{ passed: true, score: 1.0 }}
          targetHasOutput={true}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should show score, no spinner
      expect(screen.getByText("1.00")).toBeInTheDocument();
      expect(container.querySelector(".chakra-spinner")).toBeNull();
    });

    it("shows error icon when evaluator has error", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={{ error: "API timeout" }}
          targetHasOutput={true}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should show the evaluator name and no spinner
      expect(screen.getByText("Exact Match")).toBeInTheDocument();
      expect(container.querySelector(".chakra-spinner")).toBeNull();
    });
  });
});
