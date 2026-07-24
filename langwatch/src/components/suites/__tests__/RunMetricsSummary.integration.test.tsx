/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunMetricsSummary component.
 *
 * Tests the display logic for pass rate, progress indicators,
 * and status categorization in run accordion headers.
 *
 * @see specs/features/suites/sidebar-summary-status.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunMetricsSummary } from "../RunMetricsSummary";
import { makeSummary } from "./test-helpers";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<RunMetricsSummary/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when all runs passed", () => {
    it("displays Pass label with 100% and green circle", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({ passRate: 100, passedCount: 3, totalCount: 3, completedCount: 3 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("100%")).toBeInTheDocument();
    });
  });

  describe("when some runs failed", () => {
    it("displays pass rate reflecting failures", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({ passRate: 50, passedCount: 3, failedCount: 3, totalCount: 6, completedCount: 6 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("50%")).toBeInTheDocument();
    });
  });

  describe("when all runs are stalled (no verdicts)", () => {
    it("displays dash with no red color", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: null,
            passedCount: 0,
            failedCount: 0,
            stalledCount: 3,
            completedCount: 0,
            totalCount: 3,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
    });
  });

  describe("when all runs failed (0% with verdicts)", () => {
    it("displays 0% not dash", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: 0,
            passedCount: 0,
            failedCount: 2,
            completedCount: 2,
            totalCount: 2,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("0%")).toBeInTheDocument();
      expect(screen.queryByText("-")).not.toBeInTheDocument();
    });
  });

  describe("when runs are in progress with no completed runs", () => {
    it("displays lightning progress indicator only", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: null,
            passedCount: 0,
            failedCount: 0,
            completedCount: 0,
            totalCount: 3,
            inProgressCount: 3,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("0/3")).toBeInTheDocument();
      expect(screen.queryByText("Pass")).not.toBeInTheDocument();
    });
  });

  describe("when runs are in progress with partial results", () => {
    it("displays both progress and partial pass rate", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: 33,
            passedCount: 1,
            failedCount: 0,
            completedCount: 1,
            totalCount: 3,
            inProgressCount: 2,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("1/3")).toBeInTheDocument();
      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("33%")).toBeInTheDocument();
    });
  });

  describe("when a single run is queued", () => {
    it("displays lightning progress with 0/1", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: null,
            passedCount: 0,
            failedCount: 0,
            completedCount: 0,
            totalCount: 1,
            queuedCount: 1,
            inProgressCount: 0,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("0/1")).toBeInTheDocument();
      expect(screen.queryByText("Pass")).not.toBeInTheDocument();
    });
  });
});
