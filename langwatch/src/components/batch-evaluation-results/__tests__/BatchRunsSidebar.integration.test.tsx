/**
 * Integration tests for BatchRunsSidebar component
 *
 * Verifies that experiment runs are displayed newest-first in the sidebar
 * while preserving chronological "Run #N" numbering (Run #1 = oldest).
 *
 * Regression test for: https://github.com/langwatch/langwatch/issues/2418
 *
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BatchRunSummary,
  BatchRunsSidebar,
} from "../BatchRunsSidebar";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const createRun = ({
  runId,
  createdAt,
  commitMessage,
}: {
  runId: string;
  createdAt: number;
  commitMessage?: string;
}): BatchRunSummary => ({
  runId,
  workflowVersion: commitMessage
    ? { id: `wv-${runId}`, version: "1", commitMessage }
    : null,
  timestamps: {
    createdAt,
    finishedAt: createdAt + 10_000,
  },
  summary: {
    datasetCost: null,
    evaluationsCost: null,
    evaluations: {},
  },
});

const noop = () => {};

describe("BatchRunsSidebar", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers({ now: new Date("2025-06-01T12:00:00Z") });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("when runs are provided in oldest-first order", () => {
    const runs = [
      createRun({ runId: "run-old", createdAt: 1_000_000 }),
      createRun({ runId: "run-mid", createdAt: 2_000_000 }),
      createRun({ runId: "run-new", createdAt: 3_000_000 }),
    ];

    it("displays runs newest-first", () => {
      render(
        <Wrapper>
          <BatchRunsSidebar
            runs={runs}
            onSelectRun={noop}
          />
        </Wrapper>,
      );

      const items = screen.getAllByRole("button");
      // Newest run (Run #3) appears first, oldest (Run #1) last
      expect(items[0]).toHaveTextContent("Run #3");
      expect(items[1]).toHaveTextContent("Run #2");
      expect(items[2]).toHaveTextContent("Run #1");
    });

    it("preserves chronological Run # numbering (Run #1 = oldest)", () => {
      render(
        <Wrapper>
          <BatchRunsSidebar
            runs={runs}
            onSelectRun={noop}
          />
        </Wrapper>,
      );

      // The oldest run should always be Run #1 regardless of display order
      const oldestItem = screen.getByTestId("run-item-run-old");
      expect(oldestItem).toHaveTextContent("Run #1");

      const newestItem = screen.getByTestId("run-item-run-new");
      expect(newestItem).toHaveTextContent("Run #3");
    });
  });

  describe("when runs are provided in newest-first order", () => {
    const runs = [
      createRun({ runId: "run-new", createdAt: 3_000_000 }),
      createRun({ runId: "run-mid", createdAt: 2_000_000 }),
      createRun({ runId: "run-old", createdAt: 1_000_000 }),
    ];

    it("still displays runs newest-first with correct numbering", () => {
      render(
        <Wrapper>
          <BatchRunsSidebar
            runs={runs}
            onSelectRun={noop}
          />
        </Wrapper>,
      );

      const items = screen.getAllByRole("button");
      expect(items[0]).toHaveTextContent("Run #3");
      expect(items[2]).toHaveTextContent("Run #1");
    });
  });

  describe("when runs have commit messages", () => {
    const runs = [
      createRun({
        runId: "run-old",
        createdAt: 1_000_000,
        commitMessage: "Initial baseline",
      }),
      createRun({ runId: "run-new", createdAt: 2_000_000 }),
    ];

    it("uses commit message instead of Run # when available", () => {
      render(
        <Wrapper>
          <BatchRunsSidebar
            runs={runs}
            onSelectRun={noop}
          />
        </Wrapper>,
      );

      // Newest run (no commit message) appears first as "Run #2"
      const items = screen.getAllByRole("button");
      expect(items[0]).toHaveTextContent("Run #2");
      // Oldest run uses commit message
      expect(items[1]).toHaveTextContent("Initial baseline");
    });
  });
});
