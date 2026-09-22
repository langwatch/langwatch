// @vitest-environment jsdom
/**
 * A lens round trip keeps the run behind an `eval` chip: the fragment names
 * only the lens, so the run lives in the store and the key is the scope.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { instantEvalRunKey } from "@langwatch/trace-contract";
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const QUESTION = "the user is annoyed";
const CHIP = `eval:"${QUESTION}"`;
const TIME_RANGE = { from: 0, to: 1, label: "Last 30 days", presetId: "30d" } as const;

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

vi.mock("@langwatch/trace-browser-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/trace-browser-kit")>();
  return {
    ...actual,
    getPersistedActiveLensId: () => null,
    useViewStore: (sel: (s: unknown) => unknown) =>
      sel({
        activeLensId: "all-traces",
        allLenses: LENSES,
        draftState: new Map(),
        selectLens: selectLensMock,
      }),
    useFilterStore: (sel: (s: unknown) => unknown) =>
      sel({
        queryText: "",
        timeRange: TIME_RANGE,
        evalRuns: heldRuns,
        applyQueryText: vi.fn(),
        setEvalRuns: setEvalRunsMock,
        setTimeRange: vi.fn(),
        resetPagination: vi.fn(),
      }),
  };
});

import { useURLSync } from "../use-url-sync.ts";

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
