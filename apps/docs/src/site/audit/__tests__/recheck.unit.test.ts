import { describe, expect, it } from "vitest";

import type { AuditRun, PageBudget } from "../budgets.ts";
import { pageMedians, RECHECK_RUNS, recheckPasses } from "../recheck.ts";

const page = (id: string): PageBudget => ({
  id,
  path: `/${id}`,
  why: "test",
  categories: {},
  knownFailures: {},
});

function run({
  id,
  performance,
  runtimeError = null,
  formFactor = "mobile",
}: {
  id: string;
  performance?: number;
  runtimeError?: string | null;
  formFactor?: "mobile" | "desktop";
}): AuditRun {
  return {
    page: id,
    path: `/${id}`,
    formFactor,
    runtimeError,
    scores: performance === undefined ? {} : { performance },
    metrics: {
      firstContentfulPaint: null,
      largestContentfulPaint: null,
      totalBlockingTime: null,
      cumulativeLayoutShift: null,
      speedIndex: null,
    },
    transferBytes: null,
    requests: null,
    agentic: null,
    failingAudits: [],
    opportunities: [],
    durationMs: 0,
  };
}

const pages = [page("fast"), page("slow"), page("broken")];

describe("recheckPasses", () => {
  /** @scenario "Recheck a page that scores under the threshold in the all-pages run" */
  describe("when one page's first run scores under the threshold", () => {
    const medians = pageMedians({
      pages,
      formFactors: ["mobile"],
      runs: [
        run({ id: "fast", performance: 0.99 }),
        run({ id: "slow", performance: 0.6 }),
        run({ id: "broken", runtimeError: "runner exited 1" }),
      ],
    });
    const passes = recheckPasses({ medians, threshold: 0.9, firstAttempt: 1 });

    it("runs only that page again, once per pass, numbering the attempts after the first runs", () => {
      expect(passes).toHaveLength(RECHECK_RUNS);
      expect(passes.map((pass) => pass.map(({ page, attempt }) => [page.id, attempt]))).toEqual([
        [["slow", 1]],
        [["slow", 2]],
      ]);
    });

    it("leaves a page Lighthouse could not load to the report instead of rechecking it", () => {
      expect(passes.flat().some(({ page }) => page.id === "broken")).toBe(false);
    });
  });

  describe("when every page scores at or over the threshold", () => {
    it("plans no rechecks", () => {
      const medians = pageMedians({
        pages: [page("fast")],
        formFactors: ["mobile"],
        runs: [run({ id: "fast", performance: 0.9 })],
      });
      expect(recheckPasses({ medians, threshold: 0.9, firstAttempt: 1 })).toEqual([]);
    });
  });
});

describe("pageMedians", () => {
  /** @scenario "Recheck a page that scores under the threshold in the all-pages run" */
  describe("when a slow first run is rechecked twice", () => {
    it("reports the median of the three runs for that page and device", () => {
      const medians = pageMedians({
        pages: [page("slow")],
        formFactors: ["mobile", "desktop"],
        runs: [
          run({ id: "slow", performance: 0.6 }),
          run({ id: "slow", performance: 0.98 }),
          run({ id: "slow", performance: 0.97 }),
          run({ id: "slow", performance: 1, formFactor: "desktop" }),
        ],
      });
      expect(medians.map(({ formFactor, run }) => [formFactor, run.scores.performance])).toEqual([
        ["mobile", 0.97],
        ["desktop", 1],
      ]);
    });
  });
});
