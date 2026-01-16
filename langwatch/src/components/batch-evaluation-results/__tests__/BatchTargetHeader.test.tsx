/**
 * Tests for BatchTargetHeader component
 *
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { BatchTargetHeader } from "../BatchTargetHeader";
import type { BatchTargetAggregate } from "../computeBatchAggregates";
import type { BatchTargetColumn } from "../types";

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Helper to create target column
const createTargetColumn = (
  overrides: Partial<BatchTargetColumn> = {}
): BatchTargetColumn => ({
  id: "target-1",
  name: "Test Target",
  type: "prompt",
  outputFields: ["output"],
  ...overrides,
});

// Helper to create aggregates
const createAggregate = (
  overrides: Partial<BatchTargetAggregate> = {}
): BatchTargetAggregate => ({
  targetId: "target-1",
  completedRows: 5,
  totalRows: 10,
  errorRows: 0,
  evaluators: [],
  overallPassRate: null,
  overallAverageScore: null,
  averageCost: null,
  totalCost: null,
  averageLatency: null,
  totalDuration: null,
  latencyStats: null,
  costStats: null,
  ...overrides,
});

describe("BatchTargetHeader", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Basic Rendering", () => {
    it("renders target name", () => {
      const target = createTargetColumn({ name: "My Prompt Target" });

      render(
        <BatchTargetHeader target={target} aggregates={null} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("My Prompt Target")).toBeInTheDocument();
    });

    it("renders prompt icon for prompt type", () => {
      const target = createTargetColumn({ type: "prompt" });

      render(
        <BatchTargetHeader target={target} aggregates={null} />,
        { wrapper: Wrapper }
      );

      // Just verify the header renders without error
      expect(screen.getByText(target.name)).toBeInTheDocument();
    });

    it("renders agent icon for agent type", () => {
      const target = createTargetColumn({ type: "agent" });

      render(
        <BatchTargetHeader target={target} aggregates={null} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText(target.name)).toBeInTheDocument();
    });

    it("renders legacy icon for legacy type", () => {
      const target = createTargetColumn({ type: "legacy" });

      render(
        <BatchTargetHeader target={target} aggregates={null} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText(target.name)).toBeInTheDocument();
    });
  });

  describe("Summary Badge", () => {
    it("does not render summary when aggregates is null", () => {
      const target = createTargetColumn();

      render(
        <BatchTargetHeader target={target} aggregates={null} />,
        { wrapper: Wrapper }
      );

      expect(screen.queryByTestId("target-summary-badge")).not.toBeInTheDocument();
    });

    it("does not render summary when no results", () => {
      const target = createTargetColumn();
      const aggregates = createAggregate({
        completedRows: 0,
        errorRows: 0,
        totalCost: null,
      });

      render(
        <BatchTargetHeader target={target} aggregates={aggregates} />,
        { wrapper: Wrapper }
      );

      expect(screen.queryByTestId("target-summary-badge")).not.toBeInTheDocument();
    });

    it("renders summary badge when there are completed rows", () => {
      const target = createTargetColumn();
      const aggregates = createAggregate({
        completedRows: 5,
        totalRows: 10,
        overallPassRate: 80,
      });

      render(
        <BatchTargetHeader target={target} aggregates={aggregates} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByTestId("target-summary-badge")).toBeInTheDocument();
    });

    it("renders pass rate in summary badge", () => {
      const target = createTargetColumn();
      const aggregates = createAggregate({
        completedRows: 5,
        overallPassRate: 75,
      });

      render(
        <BatchTargetHeader target={target} aggregates={aggregates} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    it("renders average score in summary badge", () => {
      const target = createTargetColumn();
      const aggregates = createAggregate({
        completedRows: 5,
        overallAverageScore: 0.85,
      });

      render(
        <BatchTargetHeader target={target} aggregates={aggregates} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("0.85")).toBeInTheDocument();
    });

    it("renders error count in summary badge", () => {
      const target = createTargetColumn();
      const aggregates = createAggregate({
        completedRows: 5,
        errorRows: 2,
      });

      render(
        <BatchTargetHeader target={target} aggregates={aggregates} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("2 errors")).toBeInTheDocument();
    });

    it("renders singular error for single error", () => {
      const target = createTargetColumn();
      const aggregates = createAggregate({
        completedRows: 5,
        errorRows: 1,
      });

      render(
        <BatchTargetHeader target={target} aggregates={aggregates} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("1 error")).toBeInTheDocument();
    });

    it("renders total cost when no evaluators", () => {
      const target = createTargetColumn();
      const aggregates = createAggregate({
        completedRows: 5,
        totalCost: 0.0125,
        overallPassRate: null,
        overallAverageScore: null,
      });

      render(
        <BatchTargetHeader target={target} aggregates={aggregates} />,
        { wrapper: Wrapper }
      );

      // Cost is formatted with more precision
      expect(screen.getByText("$0.0125")).toBeInTheDocument();
    });
  });
});
