/**
 * @vitest-environment jsdom
 *
 * The studio evaluations panel links across to the full experiment
 * results page through the run summary footer's actions slot.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { BatchRunSummary } from "~/components/batch-evaluation-results/BatchRunsSidebar";
import { BatchSummaryFooter } from "~/components/batch-evaluation-results/BatchSummaryFooter";
import { OpenFullResultsButton } from "../OpenFullResultsButton";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const runSummary: BatchRunSummary = {
  runId: "run_123",
  timestamps: { createdAt: 1, finishedAt: 2 },
  summary: {
    datasetCost: 0,
    evaluationsCost: 0,
    evaluations: {},
  },
};

describe("OpenFullResultsButton", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when rendered in the run summary footer", () => {
    /** @scenario Opening the full results page for the selected run */
    it("links to the experiment results page for the run in a new tab", () => {
      render(
        <BatchSummaryFooter
          run={runSummary}
          actions={
            <OpenFullResultsButton
              projectSlug="acme-project"
              experimentSlug="branch-routing-demo"
              runId="run_123"
            />
          }
        />,
        { wrapper: Wrapper },
      );

      const link = screen.getByTestId("open-full-results");
      expect(link).toHaveAttribute(
        "href",
        "/acme-project/experiments/branch-routing-demo?runId=run_123",
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveTextContent("Open full results");
    });
  });
});
