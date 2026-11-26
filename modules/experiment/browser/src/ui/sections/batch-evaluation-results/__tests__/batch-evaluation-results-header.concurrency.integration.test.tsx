import "@testing-library/jest-dom/vitest";
/**
 * The selected run's title shows the concurrency the run used.
 * @see modules/experiment/specs/experiment-run-recorded-settings.feature
 *
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExperimentRow } from "../../../../model/experiment-api-map.ts";
import { BatchEvaluationResultsHeader } from "../batch-evaluation-results-header.tsx";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: {}, pathname: "", push: vi.fn(), replace: vi.fn() }),
}));

const experiment = {
  id: "experiment_1",
  slug: "refund-eval",
  name: "Refund eval",
} as ExperimentRow;

const renderHeader = (shownRunConcurrency: number | null) =>
  renderWithDesignSystem(
    <BatchEvaluationResultsHeader
      experiment={experiment}
      shownRunId="cool-bold-fox"
      shownRunConcurrency={shownRunConcurrency}
      data={null}
      charts={{ available: false, visible: false, onChange: () => {} }}
      displayControls={null}
      columnControls={null}
      onDownloadCsv={() => {}}
    />,
  );

afterEach(cleanup);

describe("the results page title", () => {
  describe("given the selected run recorded concurrency 1", () => {
    /** @scenario "The selected run's title shows the concurrency it used" */
    it("shows a Concurrency 1 badge beside the run id", () => {
      renderHeader(1);

      expect(screen.getByTestId("shown-run-concurrency")).toHaveTextContent(/^Concurrency 1$/);
      expect(screen.getByText(/cool-bold-fox/)).toBeInTheDocument();
    });
  });

  describe("given the selected run recorded no concurrency", () => {
    /** @scenario "The selected run's title shows the concurrency it used" */
    it("shows no concurrency", () => {
      renderHeader(null);

      expect(screen.queryByTestId("shown-run-concurrency")).toBeNull();
      expect(screen.getByText(/cool-bold-fox/)).toBeInTheDocument();
    });
  });

  describe("given the selected run recorded concurrency 1 or 10", () => {
    /** @scenario "The concurrency badge explains what it counts" */
    it.each([
      [1, "Ran one cell at a time. A cell is one row against one target."],
      [10, "Ran up to 10 cells at once. A cell is one row against one target."],
    ])("describes the focusable concurrency %i badge", (concurrency, explanation) => {
      renderHeader(concurrency);

      const badge = screen.getByTestId("shown-run-concurrency");
      expect(badge).toHaveAttribute("tabindex", "0");
      expect(badge).toHaveAccessibleDescription(explanation);
    });
  });
});
