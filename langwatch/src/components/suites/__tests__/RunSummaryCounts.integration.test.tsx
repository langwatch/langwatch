/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunSummaryCounts component.
 *
 * Tests compact icon-based display of status counts.
 * Only non-zero statuses are rendered.
 *
 * @see specs/features/suites/footer-to-header-migration.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunSummaryCounts } from "../RunSummaryCounts";
import { makeSummary } from "./test-helpers";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<RunSummaryCounts/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when only passed counts are non-zero", () => {
    it("displays passed count with check icon and hides failed", () => {
      render(
        <RunSummaryCounts
          summary={makeSummary({ passedCount: 8, failedCount: 0 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("8 ✓")).toBeInTheDocument();
      expect(screen.queryByText(/✗/)).not.toBeInTheDocument();
    });
  });

  describe("when passed and failed counts are non-zero", () => {
    it("displays both with compact icons", () => {
      render(
        <RunSummaryCounts
          summary={makeSummary({ passedCount: 8, failedCount: 2 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("8 ✓")).toBeInTheDocument();
      expect(screen.getByText("2 ✗")).toBeInTheDocument();
    });
  });

  describe("when stalled and cancelled counts are non-zero", () => {
    it("displays all non-zero statuses with icons", () => {
      render(
        <RunSummaryCounts
          summary={makeSummary({
            passedCount: 5,
            failedCount: 1,
            stalledCount: 2,
            cancelledCount: 1,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("5 ✓")).toBeInTheDocument();
      expect(screen.getByText("1 ✗")).toBeInTheDocument();
      expect(screen.getByText("2 ⏸")).toBeInTheDocument();
      expect(screen.getByText("1 ⊘")).toBeInTheDocument();
    });
  });

  describe("when stalled and cancelled counts are zero", () => {
    it("does not display stalled or cancelled counts", () => {
      render(
        <RunSummaryCounts
          summary={makeSummary({
            passedCount: 8,
            failedCount: 2,
            stalledCount: 0,
            cancelledCount: 0,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText(/⏸/)).not.toBeInTheDocument();
      expect(screen.queryByText(/⊘/)).not.toBeInTheDocument();
    });
  });

  describe("when all counts are zero", () => {
    it("renders empty container with no status items", () => {
      const { container } = render(
        <RunSummaryCounts
          summary={makeSummary({
            passedCount: 0,
            failedCount: 0,
            stalledCount: 0,
            cancelledCount: 0,
          })}
        />,
        { wrapper: Wrapper },
      );

      const countsEl = container.querySelector(
        '[data-testid="run-summary-counts"]',
      );
      expect(countsEl).toBeInTheDocument();
      expect(screen.queryByText(/✓/)).not.toBeInTheDocument();
      expect(screen.queryByText(/✗/)).not.toBeInTheDocument();
    });
  });
});
