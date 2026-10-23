import { describe, expect, it } from "vitest";

import {
  ALL_PAGES_MARKER,
  allPagesMarkdown,
  COMMENT_LIMIT,
  indexRuns,
  sectionOf,
  type AllPagesInput,
} from "../all-pages-report.ts";
import type { AuditRun } from "../budgets.ts";

function run(overrides: Partial<AuditRun> = {}): AuditRun {
  return {
    page: "/guide/a",
    path: "/guide/a",
    formFactor: "mobile",
    runtimeError: null,
    scores: { performance: 1, accessibility: 1, "best-practices": 1, seo: 1 },
    metrics: {
      firstContentfulPaint: 900,
      largestContentfulPaint: 1200,
      totalBlockingTime: 0,
      cumulativeLayoutShift: 0,
      speedIndex: 900,
    },
    transferBytes: 200_000,
    requests: 12,
    agentic: { passed: 2, applicable: 2, failed: [] },
    failingAudits: [],
    opportunities: [],
    durationMs: 7000,
    ...overrides,
  };
}

const budgets: AllPagesInput["budgets"] = {
  categories: {
    mobile: { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 },
    desktop: { performance: 0.95, accessibility: 1, "best-practices": 1, seo: 1 },
  },
};

function input(overrides: Partial<AllPagesInput> = {}): AllPagesInput {
  const pages = ["/introduction", "/guide/a", "/guide/b"];
  const runs = pages.flatMap((path) =>
    (["mobile", "desktop"] as const).map((formFactor) => run({ page: path, path, formFactor })),
  );
  return {
    pages,
    runs,
    seo: pages.map((path) => ({ path, issues: [] })),
    siteIssues: [],
    budgets,
    commit: "0123456789abcdef",
    ...overrides,
  };
}

/** @scenario "Report Lighthouse and on-page SEO for every page on the pull request" */
describe("the every-page report", () => {
  it("carries the sticky marker, a headline with budget pass counts, and the commit", () => {
    const runs = input().runs.map((r) =>
      r.path === "/guide/b" && r.formFactor === "mobile"
        ? { ...r, scores: { ...r.scores, performance: 0.8 } }
        : r,
    );
    const { comment } = allPagesMarkdown({ input: input({ runs }) });
    expect(comment.startsWith(ALL_PAGES_MARKER)).toBe(true);
    expect(comment).toContain("| 📱 Mobile | 3/3 | 🟢 93 · 2/3 pass |");
    expect(comment).toContain("| 🖥 Desktop | 3/3 | 🟢 100 · 3/3 pass |");
    expect(comment).toContain("**📱 Mobile budget:** Perf ≥ 90, A11y = 100");
    expect(comment).toContain("Commit `0123456`");
  });

  it("lists the lowest scoring pages per category, worst first, and says when none fall short", () => {
    const scored = { "/guide/a": 0.6, "/guide/b": 0.3 } as Record<string, number>;
    const runs = input().runs.map((r) =>
      r.formFactor === "desktop" && scored[r.path]
        ? { ...r, scores: { ...r.scores, accessibility: scored[r.path] } }
        : r,
    );
    const { comment } = allPagesMarkdown({ input: input({ runs }) });
    const section = comment.slice(comment.indexOf("#### A11y"), comment.indexOf("#### Best practices"));
    expect(section).toContain("2 pages below 100 on a device");
    expect(section.indexOf("/guide/b")).toBeLessThan(section.indexOf("/guide/a"));
    expect(section).toContain("| `/guide/b` | 🔴 30 | 🟢 100 |");
    expect(comment).toContain("#### SEO\n\nEvery audited page scores 100 on both devices.");
  });

  it("counts on-page SEO checks per page and names each page's gaps", () => {
    const seo = [
      { path: "/introduction", issues: ["description-length"] },
      { path: "/guide/a", issues: [] },
      { path: "/guide/b", issues: ["description-length", "missing-from-llms-txt"] },
    ];
    const { comment } = allPagesMarkdown({ input: input({ seo }) });
    expect(comment).toContain("**On-page SEO:** ❌ 1/3 pages pass every check.");
    expect(comment).toContain("| Meta description | ❌ 1/3 |");
    expect(comment).toContain("| In llms.txt | ❌ 2/3 |");
    expect(comment).toContain("| `/guide/b` | `description-length`, `missing-from-llms-txt` |");
  });

  it("groups the every-page table by section and keeps it inline when it fits", () => {
    const { comment, inline } = allPagesMarkdown({ input: input() });
    expect(inline).toBe(true);
    expect(comment).toContain("<details><summary><b>guide</b>: 2 pages");
    expect(comment).toContain("<details><summary><b>Top level</b>: 1 pages");
    expect(sectionOf("/api-reference/traces/get-trace")).toBe("api-reference");
    expect(sectionOf("/introduction")).toBe("Top level");
  });

  it("links the full table instead of inlining it past GitHub's comment limit", () => {
    const pages = Array.from({ length: 900 }, (_, i) => `/api-reference/operation-${i}`);
    const runs = pages.flatMap((path) =>
      (["mobile", "desktop"] as const).map((formFactor) => run({ page: path, path, formFactor })),
    );
    const { comment, full, inline } = allPagesMarkdown({
      input: input({
        pages,
        runs,
        seo: pages.map((path) => ({ path, issues: [] })),
        fullReportUrl: "https://github.com/acme/docs/actions/runs/1",
      }),
    });
    expect(inline).toBe(false);
    expect(comment.length).toBeLessThanOrEqual(COMMENT_LIMIT);
    expect(comment).toContain("[run summary](https://github.com/acme/docs/actions/runs/1)");
    expect(full).toContain("`/api-reference/operation-899`");
  });

  it("reports pages a shard never returned and Lighthouse errors, without scoring them", () => {
    const runs = input()
      .runs.filter((r) => !(r.path === "/guide/a" && r.formFactor === "desktop"))
      .map((r) =>
        r.path === "/guide/b" && r.formFactor === "mobile"
          ? { ...r, runtimeError: "NO_FCP: no paint", scores: {} }
          : r,
      );
    const { comment } = allPagesMarkdown({ input: input({ runs }) });
    expect(comment).toContain("| 🖥 Desktop | 2/3 |");
    expect(comment).toContain("🖥 Desktop: 1 pages not audited");
    expect(comment).toContain("- 📱 `/guide/b`: NO_FCP: no paint");
  });

  it("keeps the last run when two shards report the same page and device", () => {
    const lookup = indexRuns({
      runs: [run({ durationMs: 1 }), run({ durationMs: 2 })],
    });
    expect(lookup("mobile", "/guide/a")?.durationMs).toBe(2);
  });
});
