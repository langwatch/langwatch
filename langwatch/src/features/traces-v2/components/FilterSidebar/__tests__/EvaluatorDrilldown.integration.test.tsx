/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the evaluator drilldown:
 * - the Errored verdict row must toggle `evaluatorVerdict: error` (it
 *   previously emitted "unknown", the Passed-is-null-but-not-errored
 *   bucket, so clicking the pill filtered the wrong rows);
 * - score endpoint commits route through commitRange, which clears the
 *   filter at the full observed range and clamps in-range commits;
 * - degenerate score ranges (max <= min) render a mono value line
 *   instead of mounting a slider zag-js would reject.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { EMPTY_AST } from "~/server/app-layer/traces/query-language/parse";
import { EvaluatorDrilldown } from "../EvaluatorDrilldown";
import type { FacetItem } from "../types";

const buildItem = (
  aggregates?: Partial<NonNullable<FacetItem["aggregates"]>>,
): FacetItem => ({
  value: "faithfulness",
  label: "Faithfulness",
  count: 64,
  aggregates: {
    passedCount: 30,
    failedCount: 10,
    erroredCount: 24,
    scoreMin: 0,
    scoreMax: 1,
    hasScore: true,
    hasLabel: false,
    ...aggregates,
  },
});

const renderDrilldown = ({
  item = buildItem(),
  toggleFacet = vi.fn(),
  setRange = vi.fn(),
  removeRange = vi.fn(),
} = {}) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <EvaluatorDrilldown
        item={item}
        ast={EMPTY_AST}
        toggleFacet={toggleFacet}
        setRange={setRange}
        removeRange={removeRange}
      />
    </ChakraProvider>,
  );
  return { toggleFacet, setRange, removeRange };
};

const commitEndpoint = (ariaLabel: string, typed: string) => {
  const input = screen.getByLabelText(ariaLabel);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: typed } });
  fireEvent.blur(input);
};

describe("EvaluatorDrilldown", () => {
  afterEach(() => cleanup());

  describe("given aggregates with passed, failed, and errored counts", () => {
    it("renders a verdict row per bucket", () => {
      renderDrilldown();
      expect(screen.getByText("Passed")).toBeInTheDocument();
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("Errored")).toBeInTheDocument();
    });

    describe("when the Errored row is clicked", () => {
      it("toggles the 'error' verdict bucket, not 'unknown'", () => {
        const { toggleFacet } = renderDrilldown();
        fireEvent.click(screen.getByText("Errored"));
        expect(toggleFacet).toHaveBeenCalledWith({
          field: "evaluatorVerdict",
          value: "error",
        });
      });
    });
  });

  describe("when a score endpoint is committed at the full observed range", () => {
    it("clears the range filter instead of pinning a no-op range", () => {
      const { setRange, removeRange } = renderDrilldown();
      // 0.005 is within CLEAR_EPSILON (1% of the [0, 1] span) of the
      // observed min, so the commit snaps to "cleared": the clear path
      // must fire and setRange must not.
      commitEndpoint("Score minimum", "0.005");
      expect(removeRange).toHaveBeenCalledWith({ field: "evaluatorScore" });
      expect(setRange).not.toHaveBeenCalled();
    });
  });

  describe("when a score endpoint is committed inside the observed range", () => {
    it("sets the range with clamped values and does not clear", () => {
      const { setRange, removeRange } = renderDrilldown();
      commitEndpoint("Score maximum", "0.5");
      expect(setRange).toHaveBeenCalledWith({
        field: "evaluatorScore",
        from: "0",
        to: "0.5",
      });
      expect(removeRange).not.toHaveBeenCalled();
    });

    it("clamps a typed value that overshoots the observed max", () => {
      const { setRange } = renderDrilldown();
      commitEndpoint("Score minimum", "0.4");
      expect(setRange).toHaveBeenCalledWith({
        field: "evaluatorScore",
        from: "0.4",
        to: "1",
      });
    });
  });

  describe("given a degenerate score range where max <= min", () => {
    it("renders a single mono score line without a slider", () => {
      renderDrilldown({
        item: buildItem({ scoreMin: 0.75, scoreMax: 0.75 }),
      });
      expect(screen.queryAllByRole("slider")).toHaveLength(0);
      expect(screen.getByText("score 0.75")).toBeInTheDocument();
    });
  });
});
