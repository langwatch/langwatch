/**
 * @vitest-environment jsdom
 *
 * Unit tests for RunSummaryFooter component.
 *
 * Tests display of total runs (with pluralization),
 * passed/failed counts, and conditional stalled/cancelled counts.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunSummaryFooter } from "../RunSummaryFooter";
import { makeSummary } from "./test-helpers";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<RunSummaryFooter/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when totalCount is 1", () => {
    it("displays singular 'run'", () => {
      render(
        <RunSummaryFooter
          summary={makeSummary({ totalCount: 1, passedCount: 1 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("1 run")).toBeInTheDocument();
    });
  });

  describe("when totalCount is greater than 1", () => {
    it("displays plural 'runs'", () => {
      render(
        <RunSummaryFooter
          summary={makeSummary({ totalCount: 3, passedCount: 2, failedCount: 1 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("3 runs")).toBeInTheDocument();
    });
  });

  describe("when displaying passed and failed counts", () => {
    it("renders both counts", () => {
      render(
        <RunSummaryFooter
          summary={makeSummary({ passedCount: 5, failedCount: 2 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("5 passed")).toBeInTheDocument();
      expect(screen.getByText("2 failed")).toBeInTheDocument();
    });
  });

  describe("when stalledCount is 0", () => {
    it("does not display stalled count", () => {
      render(
        <RunSummaryFooter
          summary={makeSummary({ stalledCount: 0 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText(/stalled/)).not.toBeInTheDocument();
    });
  });

  describe("when stalledCount is greater than 0", () => {
    it("displays stalled count", () => {
      render(
        <RunSummaryFooter
          summary={makeSummary({ stalledCount: 3 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("3 stalled")).toBeInTheDocument();
    });
  });

  describe("when cancelledCount is 0", () => {
    it("does not display cancelled count", () => {
      render(
        <RunSummaryFooter
          summary={makeSummary({ cancelledCount: 0 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText(/cancelled/)).not.toBeInTheDocument();
    });
  });

  describe("when cancelledCount is greater than 0", () => {
    it("displays cancelled count", () => {
      render(
        <RunSummaryFooter
          summary={makeSummary({ cancelledCount: 4 })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("4 cancelled")).toBeInTheDocument();
    });
  });
});
