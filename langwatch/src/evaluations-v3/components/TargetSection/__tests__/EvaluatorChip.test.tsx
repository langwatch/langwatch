/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  evaluatorType: "langevals/exact_match",
  dbEvaluatorId: "db-eval-1",
  mappings: {},
  inputs: [],
  ...overrides,
});

describe("EvaluatorChip", () => {
  afterEach(() => {
    cleanup();
  });

  describe("Status Display", () => {
    it("shows gray circle for pending status when not running", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={undefined}
          isRunning={false}
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

    it("shows spinner when isRunning is true and no result yet", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={undefined}
          isRunning={true}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should show spinner (running state)
      // Chakra spinner has class "chakra-spinner"
      expect(container.querySelector(".chakra-spinner")).not.toBeNull();
    });

    it("shows pending (gray circle) when isRunning is false", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={undefined}
          isRunning={false}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should NOT show spinner - not running
      expect(container.querySelector(".chakra-spinner")).toBeNull();
    });

    it("shows spinner when result indicates running status", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result="running"
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

  describe("rerun functionality", () => {
    it("shows Rerun option in menu when evaluator has completed and onRerun provided", async () => {
      const onRerun = vi.fn();
      const user = userEvent.setup();

      render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={{ status: "processed", passed: true, score: 1 }}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onRerun={onRerun}
        />,
        { wrapper: Wrapper },
      );

      // Open the menu by clicking the chip
      const chip = screen.getByText("Exact Match");
      await user.click(chip);

      // Should show Rerun option
      const rerunOption = screen.getByText("Rerun");
      expect(rerunOption).toBeInTheDocument();

      // Click Rerun should trigger callback
      await user.click(rerunOption);
      expect(onRerun).toHaveBeenCalledTimes(1);
    });

    it("does not show Rerun option when status is pending", async () => {
      const onRerun = vi.fn();
      const user = userEvent.setup();

      render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={undefined}
          isRunning={false}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onRerun={onRerun}
        />,
        { wrapper: Wrapper },
      );

      // Open the menu
      const chip = screen.getByText("Exact Match");
      await user.click(chip);

      // Should NOT show Rerun option
      expect(screen.queryByText("Rerun")).not.toBeInTheDocument();
    });

    it("does not show Rerun option when status is running", async () => {
      const onRerun = vi.fn();
      const user = userEvent.setup();

      render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={{ status: "running" }}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onRerun={onRerun}
        />,
        { wrapper: Wrapper },
      );

      // Open the menu
      const chip = screen.getByText("Exact Match");
      await user.click(chip);

      // Should NOT show Rerun option
      expect(screen.queryByText("Rerun")).not.toBeInTheDocument();
    });

    it("does not show Rerun option when onRerun is not provided", async () => {
      const user = userEvent.setup();

      render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={{ status: "processed", passed: true, score: 1 }}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Open the menu
      const chip = screen.getByText("Exact Match");
      await user.click(chip);

      // Should NOT show Rerun option
      expect(screen.queryByText("Rerun")).not.toBeInTheDocument();
    });

    it("shows spinner when isRunning is true", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={undefined}
          isRunning={true}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onRerun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should show the evaluator name
      expect(screen.getByText("Exact Match")).toBeInTheDocument();

      // Should show a spinner (running indicator)
      expect(container.querySelector(".chakra-spinner")).toBeInTheDocument();
    });

    it("shows running status in chip when result has running status object", () => {
      const { container } = render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={{ status: "running" }}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should show spinner for running state
      expect(container.querySelector(".chakra-spinner")).toBeInTheDocument();

      // The colored status circle should NOT be visible (spinner replaces it)
      // In the component, when status is "running", it renders Spinner instead of Circle
      expect(screen.getByText("Exact Match")).toBeInTheDocument();
    });
  });
});
