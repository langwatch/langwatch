/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunHistoryFooter component.
 *
 * Tests the footer totals display: X runs, Y passed, Z failed.
 *
 * @see specs/suites/suite-workflow.feature - "Run history footer shows totals"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunHistoryFooter } from "../RunHistoryFooter";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<RunHistoryFooter/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when given totals with multiple runs", () => {
    it("displays run count, passed, and failed", () => {
      render(
        <RunHistoryFooter
          totals={{ runCount: 3, passedCount: 21, failedCount: 3 }}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("3 runs")).toBeInTheDocument();
      expect(screen.getByText("21 passed")).toBeInTheDocument();
      expect(screen.getByText("3 failed")).toBeInTheDocument();
    });
  });

  describe("when given a single run", () => {
    it("displays singular form for run count", () => {
      render(
        <RunHistoryFooter
          totals={{ runCount: 1, passedCount: 5, failedCount: 0 }}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("1 run")).toBeInTheDocument();
    });
  });

  describe("when given zero totals", () => {
    it("displays zeros", () => {
      render(
        <RunHistoryFooter
          totals={{ runCount: 0, passedCount: 0, failedCount: 0 }}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("0 runs")).toBeInTheDocument();
      expect(screen.getByText("0 passed")).toBeInTheDocument();
      expect(screen.getByText("0 failed")).toBeInTheDocument();
    });
  });
});
