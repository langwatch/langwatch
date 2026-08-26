import "@testing-library/jest-dom/vitest";

/**
 * Tests for BatchTargetCell component
 *
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BatchTargetCell } from "../../src/batch-results/batch-target-cell";
import type { BatchEvaluatorResult, BatchTargetOutput } from "@langwatch/experiment-web";

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Helper to create target output data
const createTargetOutput = (
  overrides: Partial<BatchTargetOutput> = {},
): BatchTargetOutput => ({
  targetId: "target-1",
  output: { response: "Test output" },
  cost: null,
  duration: null,
  error: null,
  traceId: null,
  evaluatorResults: [],
  ...overrides,
});

describe("BatchTargetCell", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Output Display", () => {
    /** @scenario Display target output with cost and duration */
    it("renders string output", () => {
      const targetOutput = createTargetOutput({
        output: { message: "Hello world" },
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText(/Hello world/)).toBeInTheDocument();
    });

    it("renders object output as JSON", () => {
      const targetOutput = createTargetOutput({
        output: { key: "value", nested: { foo: "bar" } },
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText(/key/)).toBeInTheDocument();
      expect(screen.getByText(/value/)).toBeInTheDocument();
    });

    it("shows 'No output' when output is null", () => {
      const targetOutput = createTargetOutput({ output: null });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("No output")).toBeInTheDocument();
    });

    /** @scenario Display error state in target cell */
    it("displays error state with error message", () => {
      const targetOutput = createTargetOutput({
        output: null,
        error: "Connection timeout",
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Connection timeout")).toBeInTheDocument();
    });

    describe("when the error message is long and clamped", () => {
      const longError =
        "gateway chat/completions: provider_error: the upstream model " +
        "returned an error after exhausting all retries. " +
        "Detail: rate limit exceeded for organization on requests per minute.";

      /** @scenario Reveal full error message on hover */
      it("shows the full error in a tooltip on hover", async () => {
        const user = userEvent.setup();
        const targetOutput = createTargetOutput({
          output: null,
          error: longError,
        });

        render(<BatchTargetCell targetOutput={targetOutput} />, {
          wrapper: Wrapper,
        });

        await user.hover(screen.getByTestId("error-output-target-1"));

        expect(await screen.findByTestId("error-tooltip-target-1")).toHaveTextContent(
          longError,
        );
      });

      /** @scenario Expand full error message on click */
      it("expands the full error into the overlay on click", async () => {
        const user = userEvent.setup();
        const targetOutput = createTargetOutput({
          output: null,
          error: longError,
        });

        render(<BatchTargetCell targetOutput={targetOutput} />, {
          wrapper: Wrapper,
        });

        await user.click(screen.getByTestId("error-output-target-1"));

        expect(screen.getByTestId("expanded-cell-backdrop")).toBeInTheDocument();
      });

      // The backdrop covers the viewport and swallows every pointer event, so
      // an overlay that ignores Escape leaves the toolbar above the table dead
      // until the reader happens to click the backdrop.
      /** @scenario Expand full error message on click */
      it("closes the expanded error on Escape, taking the backdrop with it", async () => {
        const user = userEvent.setup();
        const targetOutput = createTargetOutput({
          output: null,
          error: longError,
        });

        render(<BatchTargetCell targetOutput={targetOutput} />, {
          wrapper: Wrapper,
        });

        await user.click(screen.getByTestId("error-output-target-1"));
        expect(screen.getByTestId("expanded-cell-backdrop")).toBeInTheDocument();

        await user.keyboard("{Escape}");

        expect(screen.queryByTestId("expanded-cell-backdrop")).toBeNull();
      });
    });

    /** @scenario Expand long target output */
    /** @scenario Truncate long text in dataset cells */
    it("truncates very long output with indicator", () => {
      const longText = "A".repeat(15000);
      const targetOutput = createTargetOutput({
        output: { text: longText },
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("(truncated)")).toBeInTheDocument();
    });
  });

  describe("Evaluator Results", () => {
    /** @scenario Display evaluator chips below target output */
    /** @scenario Evaluator chip shows pass status */
    /** @scenario Evaluator chip shows fail status */
    it("renders evaluator chips for each result", () => {
      const targetOutput = createTargetOutput({
        evaluatorResults: [
          {
            evaluatorId: "eval-1",
            evaluatorName: "Exact Match",
            status: "processed",
            score: 1.0,
            passed: true,
          },
          {
            evaluatorId: "eval-2",
            evaluatorName: "LLM Judge",
            status: "processed",
            score: 0.85,
            passed: true,
          },
        ],
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Exact Match")).toBeInTheDocument();
      expect(screen.getByText("LLM Judge")).toBeInTheDocument();
    });

    it("shows score in evaluator chip", () => {
      const targetOutput = createTargetOutput({
        evaluatorResults: [
          {
            evaluatorId: "eval-1",
            evaluatorName: "Test Eval",
            status: "processed",
            score: 0.75,
            passed: true,
          },
        ],
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("0.75")).toBeInTheDocument();
    });

    /** @scenario Evaluator chip shows error status */
    it("handles error status in evaluator", () => {
      const targetOutput = createTargetOutput({
        evaluatorResults: [
          {
            evaluatorId: "eval-1",
            evaluatorName: "Failed Eval",
            status: "error",
            details: "API error",
          },
        ],
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Failed Eval")).toBeInTheDocument();
    });

    it("renders evaluator results through the supplied port", () => {
      const targetOutput = createTargetOutput({
        evaluatorResults: [
          {
            evaluatorId: "eval-1",
            evaluatorName: "Exact Match",
            status: "processed",
            score: 1,
            passed: true,
          },
        ],
      });
      const renderEvaluatorResult = vi.fn((input: { result: BatchEvaluatorResult }) => (
        <span>Rendered evaluator: {input.result.evaluatorName}</span>
      ));

      render(
        <BatchTargetCell
          targetOutput={targetOutput}
          renderEvaluatorResult={renderEvaluatorResult}
        />,
        { wrapper: Wrapper },
      );

      expect(renderEvaluatorResult).toHaveBeenCalledWith({
        result: targetOutput.evaluatorResults[0],
      });
      expect(screen.getByText("Rendered evaluator: Exact Match")).toBeInTheDocument();
    });
  });

  describe("Controlled ports", () => {
    it("renders a described failure instead of the raw fallback", () => {
      const describeFailure = vi.fn(() => ({
        title: "A useful failure",
        description: "The provider declined this request.",
        raw: "provider_error",
      }));

      render(
        <BatchTargetCell
          targetOutput={createTargetOutput({ error: "provider_error", output: null })}
          describeFailure={describeFailure}
        />,
        { wrapper: Wrapper },
      );

      expect(describeFailure).toHaveBeenCalledWith({
        error: "provider_error",
        domainError: undefined,
      });
      expect(screen.getByText("A useful failure")).toBeInTheDocument();
      expect(screen.getByText("The provider declined this request.")).toBeInTheDocument();
    });

    it("calls the trace action with the target trace id", async () => {
      const user = userEvent.setup();
      const onOpenTrace = vi.fn();

      render(
        <BatchTargetCell
          targetOutput={createTargetOutput({ traceId: "trace-123" })}
          onOpenTrace={onOpenTrace}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("trace-link-target-1"));

      expect(onOpenTrace).toHaveBeenCalledWith("trace-123");
    });

    it("hides the trace action when no trace opener is supplied", () => {
      render(
        <BatchTargetCell targetOutput={createTargetOutput({ traceId: "trace-123" })} />,
        {
          wrapper: Wrapper,
        },
      );

      expect(screen.queryByTestId("trace-link-target-1")).not.toBeInTheDocument();
    });
  });

  describe("Metadata Display", () => {
    it("displays latency when duration is present", () => {
      const targetOutput = createTargetOutput({
        duration: 1500,
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      // Latency is shown in action buttons on hover, check data-testid
      expect(screen.getByTestId("latency-target-1")).toBeInTheDocument();
      expect(screen.getByText("1.5s")).toBeInTheDocument();
    });

    it("displays cost when present", () => {
      const targetOutput = createTargetOutput({ cost: 0.05 });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("cost-target-1")).toBeInTheDocument();
      expect(screen.getByText("$0.0500")).toBeInTheDocument();
    });

    /** @scenario Hide cost and latency to reduce clutter */
    it("hides cost and latency when showCostAndLatency is false", () => {
      const targetOutput = createTargetOutput({ cost: 0.05, duration: 1500 });

      render(<BatchTargetCell targetOutput={targetOutput} showCostAndLatency={false} />, {
        wrapper: Wrapper,
      });

      expect(screen.queryByTestId("cost-target-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("latency-target-1")).not.toBeInTheDocument();
      // Output stays — cost/latency is independent of the output toggle.
      expect(screen.getByText(/Test output/)).toBeInTheDocument();
    });

    /** @scenario Increase row height to see more of a long output before expanding */
    it("applies the row-height tier to the collapsed output box", () => {
      const targetOutput = createTargetOutput();

      render(<BatchTargetCell targetOutput={targetOutput} rowHeight="l" />, {
        wrapper: Wrapper,
      });

      expect(
        screen.getByText(/Test output/).closest("[data-row-height]"),
      ).toHaveAttribute("data-row-height", "l");
    });
  });

  describe("Output Unwrapping", () => {
    it("unwraps single output field when object has only 'output' key", () => {
      const targetOutput = createTargetOutput({
        output: { output: "The actual answer is 42" },
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      // Should display the unwrapped content, not the JSON
      expect(screen.getByText("The actual answer is 42")).toBeInTheDocument();
      // Should NOT show as JSON with "output" key visible
      expect(screen.queryByText(/"output"/)).not.toBeInTheDocument();
    });

    it("does not unwrap when object has multiple keys", () => {
      const targetOutput = createTargetOutput({
        output: { output: "answer", metadata: "extra info" },
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      // Should display as JSON since there are multiple keys
      expect(screen.getByText(/output/)).toBeInTheDocument();
      expect(screen.getByText(/metadata/)).toBeInTheDocument();
    });

    it("does not unwrap when object has different single key", () => {
      const targetOutput = createTargetOutput({
        output: { response: "This is the response" },
      });

      render(<BatchTargetCell targetOutput={targetOutput} />, {
        wrapper: Wrapper,
      });

      // Should display as JSON since the key is not "output"
      expect(screen.getByText(/response/)).toBeInTheDocument();
    });
  });
});
