/**
 * @vitest-environment jsdom
 *
 * Unit tests for RunSummaryCounts component.
 *
 * Tests conditional display of stalled and cancelled counts.
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

  describe("when passed and failed counts are provided", () => {
    it("displays passed and failed counts", () => {
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

  describe("when stalled and cancelled counts are non-zero", () => {
    it("displays stalled and cancelled counts", () => {
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

      expect(screen.getByText("2 stalled")).toBeInTheDocument();
      expect(screen.getByText("1 cancelled")).toBeInTheDocument();
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

      expect(screen.queryByText(/stalled/)).not.toBeInTheDocument();
      expect(screen.queryByText(/cancelled/)).not.toBeInTheDocument();
    });
  });
});
