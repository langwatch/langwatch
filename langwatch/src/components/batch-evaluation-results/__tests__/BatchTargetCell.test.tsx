/**
 * Tests for BatchTargetCell component
 *
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { BatchTargetCell } from "../BatchTargetCell";
import type { BatchTargetOutput } from "../types";

// Mock the drawer hook
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
  }),
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Helper to create target output data
const createTargetOutput = (
  overrides: Partial<BatchTargetOutput> = {}
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
      expect(
        screen.getByTestId("latency-target-1")
      ).toBeInTheDocument();
      expect(screen.getByText("1.5s")).toBeInTheDocument();
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
