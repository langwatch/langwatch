// Coverage: evaluator drilldown verdict rows, label filtering, scoped
// active state, and score range committing.
// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { FacetItem } from "@langwatch/trace-browser-kit";
import { EMPTY_AST, parse } from "@langwatch/trace-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluatorDrilldown } from "../evaluator-drilldown.tsx";

const buildItem = (aggregates?: Partial<NonNullable<FacetItem["aggregates"]>>): FacetItem => ({
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
    // A genuine continuous score (many distinct values) — the slider is
    // meaningful. Override to ≤2 distinct in [0,1] to exercise the
    // binary-verdict suppression path.
    distinctScores: 40,
    hasLabel: false,
    ...aggregates,
  },
});

const renderDrilldown = ({
  item = buildItem(),
  ast = EMPTY_AST,
  toggleSubFilter = vi.fn(),
  setScoreRange = vi.fn(),
  removeScoreRange = vi.fn(),
} = {}) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <EvaluatorDrilldown
        item={item}
        ast={ast}
        toggleSubFilter={toggleSubFilter}
        setScoreRange={setScoreRange}
        removeScoreRange={removeScoreRange}
      />
    </ChakraProvider>,
  );
  return { toggleSubFilter, setScoreRange, removeScoreRange };
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
      it("toggles the 'error' verdict bucket, not 'unknown'", async () => {
        const { toggleSubFilter } = renderDrilldown();
        await userEvent.setup().click(screen.getByText("Errored"));
        expect(toggleSubFilter).toHaveBeenCalledWith({
          field: "evaluatorVerdict",
          value: "error",
        });
      });
    });
  });

  describe("given an evaluator that emits labels", () => {
    const labelItem = () =>
      buildItem({
        hasLabel: true,
        labelValues: [
          { value: "faithful", count: 40 },
          { value: "unfaithful", count: 12 },
        ],
      });

    it("renders a clickable row per label value instead of static text", () => {
      renderDrilldown({ item: labelItem() });
      expect(screen.getByText("faithful")).toBeInTheDocument();
      expect(screen.getByText("unfaithful")).toBeInTheDocument();
      // The old static affordance is gone.
      expect(screen.queryByText("Emits labels")).not.toBeInTheDocument();
    });

    describe("when a label row is clicked", () => {
      it("toggles the evaluatorLabel sub-filter for that value", async () => {
        const { toggleSubFilter } = renderDrilldown({ item: labelItem() });
        await userEvent.setup().click(screen.getByText("unfaithful"));
        expect(toggleSubFilter).toHaveBeenCalledWith({
          field: "evaluatorLabel",
          value: "unfaithful",
        });
      });
    });

    describe("when a label value has a zero count", () => {
      it("renders nothing for that row", () => {
        renderDrilldown({
          item: buildItem({
            hasLabel: true,
            labelValues: [
              { value: "faithful", count: 40 },
              { value: "phantom", count: 0 },
            ],
          }),
        });
        expect(screen.getByText("faithful")).toBeInTheDocument();
        expect(screen.queryByText("phantom")).not.toBeInTheDocument();
      });
    });
  });

  describe("given no emitted labels", () => {
    it("renders no label rows and no 'Emits labels' text", () => {
      renderDrilldown({ item: buildItem({ hasLabel: false }) });
      expect(screen.queryByText("Emits labels")).not.toBeInTheDocument();
    });
  });

  describe("given a verdict pinned on a different evaluator", () => {
    it("does not mark this evaluator's matching verdict row active", () => {
      // `evaluatorVerdict:pass` is scoped to evaluator "other", so the
      // drilldown for "faithfulness" must read its own (empty) group state.
      const ast = parse("(evaluator:other AND evaluatorVerdict:pass)");
      renderDrilldown({ item: buildItem(), ast });
      const passedRow = screen.getByRole("checkbox", { name: /^Passed/ });
      expect(passedRow).not.toBeChecked();
    });
  });

  describe("given a verdict pinned inside this evaluator's group", () => {
    it("marks the matching verdict row active", () => {
      const ast = parse("(evaluator:faithfulness AND evaluatorVerdict:pass)");
      renderDrilldown({ item: buildItem(), ast });
      const passedRow = screen.getByRole("checkbox", { name: /^Passed/ });
      expect(passedRow).toBeChecked();
    });
  });

  describe("when a score endpoint is committed at the full observed range", () => {
    it("clears the range filter instead of pinning a no-op range", () => {
      const { setScoreRange, removeScoreRange } = renderDrilldown();
      // 0.005 is within CLEAR_EPSILON (1% of the [0, 1] span) of the
      // observed min, so the commit snaps to "cleared": the clear path
      // must fire and setScoreRange must not.
      commitEndpoint("Score minimum", "0.005");
      expect(removeScoreRange).toHaveBeenCalled();
      expect(setScoreRange).not.toHaveBeenCalled();
    });
  });

  describe("when a score endpoint is committed inside the observed range", () => {
    it("sets the range with clamped values and does not clear", () => {
      const { setScoreRange, removeScoreRange } = renderDrilldown();
      commitEndpoint("Score maximum", "0.5");
      expect(setScoreRange).toHaveBeenCalledWith({ from: "0", to: "0.5" });
      expect(removeScoreRange).not.toHaveBeenCalled();
    });

    it("clamps a typed value that overshoots the observed max", () => {
      const { setScoreRange } = renderDrilldown();
      commitEndpoint("Score minimum", "0.4");
      expect(setScoreRange).toHaveBeenCalledWith({ from: "0.4", to: "1" });
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

  describe("given a binary 0/1 score that mirrors the pass/fail verdict", () => {
    describe("when the drilldown is rendered", () => {
      it("renders the verdict rows but no score control at all", () => {
        renderDrilldown({
          item: buildItem({ scoreMin: 0, scoreMax: 1, distinctScores: 2 }),
        });
        // Verdict pills still render — they carry the pass/fail signal.
        expect(screen.getByText("Passed")).toBeInTheDocument();
        expect(screen.getByText("Failed")).toBeInTheDocument();
        // No slider, and no "Score" range inputs — the binary score adds
        // nothing the verdict rows don't already say.
        expect(screen.queryAllByRole("slider")).toHaveLength(0);
        expect(screen.queryByLabelText("Score minimum")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Score maximum")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a continuous score with many distinct values", () => {
    describe("when the drilldown is rendered", () => {
      it("keeps the score range control", () => {
        renderDrilldown({
          item: buildItem({ scoreMin: 0, scoreMax: 1, distinctScores: 40 }),
        });
        expect(screen.getByLabelText("Score minimum")).toBeInTheDocument();
        expect(screen.getByLabelText("Score maximum")).toBeInTheDocument();
      });
    });
  });
});
