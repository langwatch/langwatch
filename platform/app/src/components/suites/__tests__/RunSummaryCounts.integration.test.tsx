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

  describe("given a summary with only passed counts non-zero", () => {
    it("displays passed count with check icon and hides failed", () => {
      render(
        <RunSummaryCounts
          summary={makeSummary({ passedCount: 8, failedCount: 0 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("8 passed")).toBeInTheDocument();
      expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
    });
  });

  describe("given a summary with passed and failed counts non-zero", () => {
    it("displays both as word labels", () => {
      render(
        <RunSummaryCounts
          summary={makeSummary({ passedCount: 8, failedCount: 2 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("8 passed")).toBeInTheDocument();
      expect(screen.getByText("2 failed")).toBeInTheDocument();
    });
  });

  describe("given a summary with all status counts non-zero", () => {
    it("displays all statuses as word labels", () => {
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

      expect(screen.getByText("5 passed")).toBeInTheDocument();
      expect(screen.getByText("1 failed")).toBeInTheDocument();
      expect(screen.getByText("2 stalled")).toBeInTheDocument();
      expect(screen.getByText("1 cancelled")).toBeInTheDocument();
    });
  });

  describe("given a summary with stalled and cancelled counts at zero", () => {
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

      expect(screen.queryByText(/stalled/)).not.toBeInTheDocument();
      expect(screen.queryByText(/cancelled/)).not.toBeInTheDocument();
    });
  });

  describe("given a summary with all counts at zero", () => {
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
      expect(screen.queryByText(/passed/)).not.toBeInTheDocument();
      expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
      expect(screen.queryByText(/stalled/)).not.toBeInTheDocument();
      expect(screen.queryByText(/cancelled/)).not.toBeInTheDocument();
    });
  });
});
