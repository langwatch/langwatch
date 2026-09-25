/**
 * @vitest-environment jsdom
 *
 * A round trip through a lens keeps the run behind an `eval` chip.
 *
 * A fragment naming only a lens (`#my-lens`) carries no `q`, and the lens
 * brings its own filter back. That filter can hold an `eval` chip, and the
 * run behind it lives in the store rather than in the fragment. Dropping the
 * runs there left the chip pending: the table showed nothing, the empty state
 * offered "Judge these results", and taking it would have started a second
 * run over rows the first one had already judged and charged for it again.
 *
 * The key is the scope, so a run is only carried over when the question, the
 * unit judged, the other chips and the window all still match.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A lens round trip keeps
 * the run behind a restored chip").
 */
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instantEvalRunKey } from "~/server/app-layer/traces/query-language/instantEvalChips";

const QUESTION = "the user is annoyed";
const CHIP = `eval:"${QUESTION}"`;
const TIME_RANGE = {
  from: 0,
  to: 1,
  label: "Last 30 days",
  presetId: "30d",
} as const;

/** The key the chip computes under the lens's own filter and this window. */
const RUN_KEY = instantEvalRunKey({
  question: QUESTION,
  target: "traces",
  otherQuery: "",
  window: { from: 0, to: 1, presetId: "30d" },
});

const setEvalRunsMock = vi.fn();
const selectLensMock = vi.fn();

const LENSES = [
  { id: "all-traces", name: "All", filterText: "" },
  { id: "judged", name: "Judged", filterText: CHIP },
];

/** The runs the page holds when the fragment is applied. */
let heldRuns: Record<string, string> = {};

vi.mock("../../stores/viewSlice", () => ({
  getPersistedActiveLensId: () => null,
}));

vi.mock("../../stores/explorerStore", () => ({
  useExplorerStore: (sel: (s: unknown) => unknown) =>
    sel({
      activeLensId: "all-traces",
      allLenses: LENSES,
      draftState: new Map(),
      selectLens: selectLensMock,
      queryText: "",
      timeRange: TIME_RANGE,
      evalRuns: heldRuns,
      applyQueryText: vi.fn(),
      setTimeRange: vi.fn(),
      setEvalRuns: setEvalRunsMock,
      resetPagination: vi.fn(),
    }),
}));

import { useURLSync } from "../useURLSync";

function HookMount() {
  useURLSync();
  return null;
}

function mountAt(fragment: string): void {
  window.history.replaceState(null, "", `/${fragment}`);
  render(
    <BrowserRouter>
      <HookMount />
    </BrowserRouter>,
  );
}

/** The map the apply handed the store. */
function appliedRuns(): Record<string, string> {
  const call = setEvalRunsMock.mock.calls.at(-1);
  if (!call) throw new Error("setEvalRuns was not called");
  return call[0] as Record<string, string>;
}

beforeEach(() => {
  setEvalRunsMock.mockClear();
  selectLensMock.mockClear();
  heldRuns = {};
  window.history.replaceState(null, "", "/");
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("given a lens whose filter carries an eval chip", () => {
  describe("when the fragment names only that lens and a run is held for the chip", () => {
    /** @scenario "A lens round trip keeps the run behind a restored chip" */
    it("keeps the run, so the chip is not offered for judging a second time", () => {
      heldRuns = { [RUN_KEY]: "run-1" };
      mountAt("#judged");
      expect(appliedRuns()).toEqual({ [RUN_KEY]: "run-1" });
    });
  });

  describe("when the run the page holds was judged under another scope", () => {
    it("keeps none of it, because a different key is a different set of rows", () => {
      heldRuns = { "0000dead": "run-1" };
      mountAt("#judged");
      expect(appliedRuns()).toEqual({});
    });
  });

  describe("when the fragment names a query with no eval chip", () => {
    it("carries no run, because there is no chip for one to stand behind", () => {
      heldRuns = { [RUN_KEY]: "run-1" };
      mountAt("#all-traces?q=status%3Aerror");
      expect(appliedRuns()).toEqual({});
    });
  });
});
