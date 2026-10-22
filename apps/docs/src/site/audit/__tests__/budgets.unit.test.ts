import { describe, expect, it } from "vitest";

import { budgetsSchema, evaluateBudgets, readBudgets, type AuditRun } from "../budgets.ts";
import { summaryMarkdown } from "../report.ts";

const budgets = budgetsSchema.parse({
  categories: {
    mobile: { performance: 0.95, accessibility: 0.95, "best-practices": 0.95, seo: 1 },
    desktop: { performance: 0.95, accessibility: 0.95, "best-practices": 0.95, seo: 1 },
  },
  maxCumulativeLayoutShift: 0.02,
  maxTransferBytes: 500_000,
  maxRequests: 20,
  gatedAuditCategories: ["accessibility", "best-practices", "seo"],
  pages: [
    { id: "home", path: "/", why: "home", categories: { mobile: { performance: 0.85 } } },
    {
      id: "guide",
      path: "/guide",
      why: "guide",
      maxTransferBytes: 100_000,
      knownFailures: { "heading-order": "authored", "color-contrast": "carousel" },
    },
  ],
  seo: { title: { min: 10, max: 70 }, description: { min: 50, max: 160 } },
  agentReadiness: { pageTokens: 8000, integration: { groups: [] }, crawlers: ["GPTBot"] },
});

function run(overrides: Partial<AuditRun> = {}): AuditRun {
  return {
    page: "home",
    path: "/",
    formFactor: "mobile",
    runtimeError: null,
    scores: { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 },
    metrics: {
      firstContentfulPaint: 1000,
      largestContentfulPaint: 1500,
      totalBlockingTime: 0,
      cumulativeLayoutShift: 0.01,
      speedIndex: 1000,
    },
    transferBytes: 90_000,
    requests: 10,
    failingAudits: [],
    opportunities: [],
    durationMs: 5000,
    ...overrides,
  };
}

describe("evaluateBudgets", () => {
  describe("when every run meets its budgets", () => {
    it("passes, applying the page's own category floor", () => {
      expect(evaluateBudgets({ runs: [run()], budgets })).toEqual({ failures: [], notes: [] });
    });
  });

  describe("when runs exceed their budgets", () => {
    /** @scenario "Hold Lighthouse results to the committed budgets" */
    it("fails each score, metric, byte, request and audit over budget", () => {
      const { failures } = evaluateBudgets({
        budgets,
        runs: [
          run({
            formFactor: "desktop",
            scores: { performance: 0.9, accessibility: 0.9, "best-practices": 1, seo: 0.92 },
            metrics: { ...run().metrics, cumulativeLayoutShift: 0.15 },
            transferBytes: 600_000,
            requests: 30,
            failingAudits: [
              { id: "image-alt", category: "accessibility", title: "Images have alt", score: 0 },
            ],
          }),
          run({
            page: "guide",
            path: "/guide",
            transferBytes: 150_000,
            scores: { performance: 1, accessibility: 0.98, "best-practices": 1, seo: 1 },
            failingAudits: [
              { id: "heading-order", category: "accessibility", title: "Heading order", score: 0 },
            ],
          }),
          run({
            page: "guide",
            path: "/guide",
            formFactor: "desktop",
            runtimeError: "NO_FCP: no paint",
          }),
        ],
      });
      expect(
        failures.map(
          (finding) => `${finding.page} ${finding.formFactor} ${finding.code}: ${finding.detail}`,
        ),
      ).toEqual([
        "home desktop category-below-budget: performance 90 < 95",
        "home desktop category-below-budget: accessibility 90 < 95",
        "home desktop category-below-budget: seo 92 < 100",
        "home desktop layout-shift-over-budget: CLS 0.150 > 0.02",
        "home desktop transfer-over-budget: 600000 bytes > 500000",
        "home desktop requests-over-budget: 30 requests > 20",
        "home desktop audit-failing: accessibility: image-alt (Images have alt)",
        "guide mobile transfer-over-budget: 150000 bytes > 100000",
        "guide desktop lighthouse-error: NO_FCP: no paint",
      ]);
    });
  });

  describe("when a known failure passes on every device", () => {
    it("notes it so the entry can be removed, without failing", () => {
      const guide = { page: "guide", path: "/guide", scores: { ...run().scores, performance: 1 } };
      const heading = {
        id: "heading-order",
        category: "accessibility" as const,
        title: "Heading order",
        score: 0,
      };
      const { failures, notes } = evaluateBudgets({
        budgets,
        runs: [
          run({ ...guide, failingAudits: [heading] }),
          run({ ...guide, formFactor: "desktop" }),
        ],
      });
      expect(failures).toEqual([]);
      expect(notes.map((note) => note.detail)).toEqual([
        "color-contrast passes now; remove it from knownFailures",
      ]);
    });
  });

  describe("when only one device was audited", () => {
    it("notes nothing, since the known failure may belong to the other device", () => {
      const scores = { ...run().scores, performance: 1 };
      const { notes } = evaluateBudgets({
        budgets,
        runs: [run({ page: "guide", path: "/guide", scores })],
      });
      expect(notes).toEqual([]);
    });
  });

  describe("when the committed budgets are read", () => {
    it("parses them and names every page once", () => {
      const committed = readBudgets();
      const ids = committed.pages.map((page) => page.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(committed.categories.mobile.seo).toBe(1);
    });
  });
});

describe("summaryMarkdown", () => {
  describe("when the audit has runs and failures", () => {
    /** @scenario "Summarise the audit for the pull request" */
    it("tabulates each page and device and lists every failure", () => {
      const markdown = summaryMarkdown({
        runs: [run(), run({ formFactor: "desktop", transferBytes: null })],
        failures: [
          {
            page: "home",
            formFactor: "desktop",
            code: "requests-over-budget",
            detail: "30 requests > 20",
          },
        ],
        notes: [],
        seo: {
          pages: 2,
          failures: [{ page: "/a", code: "h1-count", detail: "2 <h1> elements" }],
          fixed: [],
          known: 0,
        },
        wallClockMs: 42_000,
      });
      expect(markdown).toContain("## Docs audit: failed");
      expect(markdown).toContain(
        "| `/` | mobile | 90 | 100 | 100 | 100 | 1000 ms | 1500 ms | 0 ms | 0.010 | 1000 ms | 88 KB | 10 |",
      );
      expect(markdown).toContain(
        "| `/` | desktop | 90 | 100 | 100 | 100 | 1000 ms | 1500 ms | 0 ms | 0.010 | 1000 ms | n/a | 10 |",
      );
      expect(markdown).toContain("- `home` desktop: requests-over-budget, 30 requests > 20");
      expect(markdown).toContain("- `/a`: h1-count, 2 <h1> elements");
    });
  });
});
