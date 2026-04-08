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

// Mock name hooks to avoid tRPC queries
vi.mock("../../../hooks/useEvaluatorName", () => ({
  useEvaluatorName: () => "Exact Match",
  useEvaluatorNames: () => new Map(),
}));

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

  describe("Run/Rerun menu items", () => {
    describe("when status is pending", () => {
      describe("when target output exists", () => {
        it("shows 'Run' menu item", async () => {
          const onRerun = vi.fn();
          const user = userEvent.setup();

          render(
            <EvaluatorChip
              evaluator={createEvaluator()}
              result={undefined}
              isRunning={false}
              hasTargetOutput={true}
              onEdit={vi.fn()}
              onRemove={vi.fn()}
              onRerun={onRerun}
            />,
            { wrapper: Wrapper },
          );

          const chip = screen.getByText("Exact Match");
          await user.click(chip);

          expect(screen.getByText("Run")).toBeInTheDocument();
          expect(screen.queryByText("Rerun")).not.toBeInTheDocument();
        });

        it("calls onRerun when 'Run' is clicked", async () => {
          const onRerun = vi.fn();
          const user = userEvent.setup();

          render(
            <EvaluatorChip
              evaluator={createEvaluator()}
              result={undefined}
              isRunning={false}
              hasTargetOutput={true}
              onEdit={vi.fn()}
              onRemove={vi.fn()}
              onRerun={onRerun}
            />,
            { wrapper: Wrapper },
          );

          const chip = screen.getByText("Exact Match");
          await user.click(chip);
          await user.click(screen.getByText("Run"));

          expect(onRerun).toHaveBeenCalledTimes(1);
        });
      });

      describe("when no target output exists", () => {
        it("shows disabled 'Run' menu item", async () => {
          const onRerun = vi.fn();
          const user = userEvent.setup();

          render(
            <EvaluatorChip
              evaluator={createEvaluator()}
              result={undefined}
              isRunning={false}
              hasTargetOutput={false}
              onEdit={vi.fn()}
              onRemove={vi.fn()}
              onRerun={onRerun}
            />,
            { wrapper: Wrapper },
          );

          const chip = screen.getByText("Exact Match");
          await user.click(chip);

          const runItem = screen.getByText("Run").closest("[data-disabled]");
          expect(runItem).toBeInTheDocument();
        });

      });
    });

    describe("when status is completed", () => {
      it("shows 'Rerun' instead of 'Run'", async () => {
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

        const chip = screen.getByText("Exact Match");
        await user.click(chip);

        expect(screen.getByText("Rerun")).toBeInTheDocument();
        expect(screen.queryByText("Run")).not.toBeInTheDocument();
      });

      it("calls onRerun when 'Rerun' is clicked", async () => {
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

        const chip = screen.getByText("Exact Match");
        await user.click(chip);
        await user.click(screen.getByText("Rerun"));

        expect(onRerun).toHaveBeenCalledTimes(1);
      });

      it("does not show 'Rerun' when onRerun is not provided", async () => {
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

        const chip = screen.getByText("Exact Match");
        await user.click(chip);

        expect(screen.queryByText("Rerun")).not.toBeInTheDocument();
      });
    });

    describe("when status is running", () => {
      it("hides both 'Run' and 'Rerun'", async () => {
        const onRerun = vi.fn();
        const user = userEvent.setup();

        render(
          <EvaluatorChip
            evaluator={createEvaluator()}
            result={{ status: "running" }}
            hasTargetOutput={true}
            onEdit={vi.fn()}
            onRemove={vi.fn()}
            onRerun={onRerun}
          />,
          { wrapper: Wrapper },
        );

        const chip = screen.getByText("Exact Match");
        await user.click(chip);

        expect(screen.queryByText("Run")).not.toBeInTheDocument();
        expect(screen.queryByText("Rerun")).not.toBeInTheDocument();
      });
    });
  });

  describe("Run on all rows menu item", () => {
    describe("when target outputs exist for at least one row", () => {
      it("shows 'Run on all rows' menu item", async () => {
        const onRunOnAllRows = vi.fn();
        const user = userEvent.setup();

        render(
          <EvaluatorChip
            evaluator={createEvaluator()}
            result={{ status: "processed", passed: true, score: 1 }}
            hasAnyTargetOutputs={true}
            onEdit={vi.fn()}
            onRemove={vi.fn()}
            onRerun={vi.fn()}
            onRunOnAllRows={onRunOnAllRows}
          />,
          { wrapper: Wrapper },
        );

        const chip = screen.getByText("Exact Match");
        await user.click(chip);

        expect(screen.getByText("Run on all rows")).toBeInTheDocument();
      });

      it("calls onRunOnAllRows when clicked", async () => {
        const onRunOnAllRows = vi.fn();
        const user = userEvent.setup();

        render(
          <EvaluatorChip
            evaluator={createEvaluator()}
            result={{ status: "processed", passed: true, score: 1 }}
            hasAnyTargetOutputs={true}
            onEdit={vi.fn()}
            onRemove={vi.fn()}
            onRerun={vi.fn()}
            onRunOnAllRows={onRunOnAllRows}
          />,
          { wrapper: Wrapper },
        );

        const chip = screen.getByText("Exact Match");
        await user.click(chip);
        await user.click(screen.getByText("Run on all rows"));

        expect(onRunOnAllRows).toHaveBeenCalledTimes(1);
      });
    });

    describe("when no rows have target outputs", () => {
      it("shows disabled 'Run on all rows'", async () => {
        const onRunOnAllRows = vi.fn();
        const user = userEvent.setup();

        render(
          <EvaluatorChip
            evaluator={createEvaluator()}
            result={undefined}
            hasAnyTargetOutputs={false}
            onEdit={vi.fn()}
            onRemove={vi.fn()}
            onRerun={vi.fn()}
            onRunOnAllRows={onRunOnAllRows}
          />,
          { wrapper: Wrapper },
        );

        const chip = screen.getByText("Exact Match");
        await user.click(chip);

        const item = screen
          .getByText("Run on all rows")
          .closest("[data-disabled]");
        expect(item).toBeInTheDocument();
      });

    });

    describe("when evaluator is running", () => {
      it("does not show 'Run on all rows'", async () => {
        const onRunOnAllRows = vi.fn();
        const user = userEvent.setup();

        render(
          <EvaluatorChip
            evaluator={createEvaluator()}
            result={{ status: "running" }}
            hasAnyTargetOutputs={true}
            onEdit={vi.fn()}
            onRemove={vi.fn()}
            onRerun={vi.fn()}
            onRunOnAllRows={onRunOnAllRows}
          />,
          { wrapper: Wrapper },
        );

        const chip = screen.getByText("Exact Match");
        await user.click(chip);

        expect(screen.queryByText("Run on all rows")).not.toBeInTheDocument();
      });
    });
  });

  describe("when evaluator has missing mappings", () => {
    it("redirects Rerun click to onEdit", async () => {
      const onEdit = vi.fn();
      const onRerun = vi.fn();
      const user = userEvent.setup();

      render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={{ status: "processed", passed: true, score: 1 }}
          hasMissingMappings={true}
          hasTargetOutput={true}
          hasAnyTargetOutputs={true}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onRerun={onRerun}
          onRunOnAllRows={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const chip = screen.getByText("Exact Match");
      await user.click(chip);
      await user.click(screen.getByText("Rerun"));

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onRerun).not.toHaveBeenCalled();
    });

    it("redirects Run on all rows click to onEdit", async () => {
      const onEdit = vi.fn();
      const onRunOnAllRows = vi.fn();
      const user = userEvent.setup();

      render(
        <EvaluatorChip
          evaluator={createEvaluator()}
          result={{ status: "processed", passed: true, score: 1 }}
          hasMissingMappings={true}
          hasTargetOutput={true}
          hasAnyTargetOutputs={true}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onRerun={vi.fn()}
          onRunOnAllRows={onRunOnAllRows}
        />,
        { wrapper: Wrapper },
      );

      const chip = screen.getByText("Exact Match");
      await user.click(chip);
      await user.click(screen.getByText("Run on all rows"));

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onRunOnAllRows).not.toHaveBeenCalled();
    });
  });

  describe("rerun functionality (legacy)", () => {
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
