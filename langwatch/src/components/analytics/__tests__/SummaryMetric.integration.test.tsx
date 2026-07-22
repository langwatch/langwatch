/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { SummaryMetric } from "../SummaryMetric";

afterEach(cleanup);

function renderMetric(props: React.ComponentProps<typeof SummaryMetric>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SummaryMetric {...props} />
    </ChakraProvider>,
  );
}

// Spec: specs/analytics/model-cost-comparison.feature

describe("<SummaryMetric />", () => {
  describe("when current is a genuine zero and zeroMeansNoData is false", () => {
    it("renders the zero value instead of 'No data yet'", () => {
      renderMetric({
        label: "Current Cost",
        current: 0,
        format: () => "$0.00",
        zeroMeansNoData: false,
      });

      expect(screen.getByText("$0.00")).toBeInTheDocument();
      expect(screen.queryByText(/no data yet/i)).not.toBeInTheDocument();
    });
  });

  describe("when current is zero and zeroMeansNoData is unset (default)", () => {
    it("renders 'No data yet', preserving existing callers' behavior", () => {
      renderMetric({
        label: "Feedbacks",
        current: 0,
      });

      expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
    });
  });

  describe("when current is undefined", () => {
    it("shows the loading skeleton, not a zero value, regardless of zeroMeansNoData", () => {
      renderMetric({
        label: "Current Cost",
        current: undefined,
        format: () => "$0.00",
        zeroMeansNoData: false,
      });

      expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
      expect(screen.queryByText(/no data yet/i)).not.toBeInTheDocument();
    });
  });
});
