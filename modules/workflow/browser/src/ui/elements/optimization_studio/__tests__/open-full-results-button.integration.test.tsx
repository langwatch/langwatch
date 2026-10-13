/**
 * @vitest-environment jsdom
 *
 * The run summary footer links to full experiment results.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type BatchRunSummary } from "../../../sections/experiment/batch-results/batch-runs-sidebar.tsx";
import { BatchSummaryFooter } from "../../../sections/experiment/batch-results/batch-summary-footer.tsx";
import { OpenFullResultsButton } from "../open-full-results-button.tsx";

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
      renderWithDesignSystem(
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
