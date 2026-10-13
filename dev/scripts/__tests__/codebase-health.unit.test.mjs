import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHealth,
  compareHealth,
  parseArchitectureReport,
  planIssue,
  renderMarkdown,
} from "../codebase-health.mjs";

function health({ programs = [], depth = 17, declarations = [], architecture = {} } = {}) {
  return buildHealth({
    date: "2026-10-10",
    commit: "0123456789abcdef",
    programs: programs.map(([config, instantiations]) => ({
      config,
      instantiations,
      hotFiles: [["a.ts", 5]],
      hotGenerics: [],
    })),
    chain: { depth, path: ["a/tsconfig.json"] },
    declarations: declarations.map(([file, bytes]) => ({ file, bytes })),
    architecture,
    typecheck: { wallSeconds: 600, peakRssKb: 4_000_000 },
  });
}

const metrics = (breaches) => breaches.map((breach) => breach.metric);

void describe("the first run", () => {
  /** @scenario "The first run has nothing to compare with" */
  void it("reports no breach and says there is no previous run", () => {
    const current = health({ programs: [["p", 1_000_000]] });
    const breaches = compareHealth({ previous: null, current });
    assert.deepEqual(breaches, []);
    assert.match(
      renderMarkdown({ previous: null, current, breaches }),
      /No previous run to compare with/,
    );
  });
});

void describe("program instantiations", () => {
  /** @scenario "A program whose instantiations rise past both thresholds is a breach" */
  void it("flags a rise over 25% and 100k, not one under the floor", () => {
    const previous = health({
      programs: [
        ["big", 400_000],
        ["small", 1_000],
        ["rest", 10_000_000],
      ],
    });
    const current = health({
      programs: [
        ["big", 600_000],
        ["small", 90_000],
        ["rest", 10_000_000],
      ],
    });
    assert.deepEqual(metrics(compareHealth({ previous, current })), ["instantiations big"]);
  });

  /** @scenario "Total instantiations up more than ten per cent is a breach" */
  void it("flags the total rising more than 10%", () => {
    const previous = health({
      programs: [
        ["a", 500_000],
        ["b", 500_000],
      ],
    });
    const current = health({
      programs: [
        ["a", 575_000],
        ["b", 575_000],
      ],
    });
    assert.deepEqual(metrics(compareHealth({ previous, current })), ["instantiations total"]);
  });
});

void describe("reference chain", () => {
  /** @scenario "A longer reference chain is a breach" */
  void it("flags a chain one config longer", () => {
    assert.deepEqual(
      metrics(compareHealth({ previous: health({ depth: 17 }), current: health({ depth: 18 }) })),
      ["reference chain depth"],
    );
  });
});

void describe("architecture findings", () => {
  /** @scenario "Any new architecture finding is a breach" */
  void it("flags a policy that rose from zero and one that rose at all, not one that fell", () => {
    const report =
      "architecture-enforcer: 5 findings across 2 policies, exit 1 (x)\n      1  peer-cycles\n      4  cycles\n\n--- peer-cycles ---";
    const previous = health({ architecture: { cycles: 3, manifests: 2 } });
    const current = health({
      architecture: { ...parseArchitectureReport({ text: report }), manifests: 1 },
    });
    assert.deepEqual(metrics(compareHealth({ previous, current })), [
      "architecture peer-cycles",
      "architecture cycles",
    ]);
  });
});

void describe("declaration size", () => {
  /** @scenario "Declaration size up more than ten per cent, or a new large file, is a breach" */
  void it("flags the total rising more than 10% and a new file over 200 KB", () => {
    const previous = health({ declarations: [["a.d.ts", 10_000_000]] });
    const current = health({
      declarations: [
        ["a.d.ts", 11_250_000],
        ["b.d.ts", 250 * 1024],
      ],
    });
    assert.deepEqual(metrics(compareHealth({ previous, current })), [
      ".d.ts total bytes",
      ".d.ts over 200 KB b.d.ts",
    ]);
  });
});

void describe("the issue", () => {
  const breaches = [{ metric: "reference chain depth", previous: 17, now: 18 }];

  /** @scenario "A breach opens an issue when none is open" */
  void it("opens a dated, labelled issue", () => {
    assert.deepEqual(planIssue({ breaches, openIssues: [], date: "2026-10-10", body: "table" }), {
      kind: "open",
      title: "Codebase health: 2026-10-10 regressions",
      label: "codebase-health",
      body: "table",
    });
  });

  /** @scenario "A breach comments on the open issue" */
  void it("comments on the open issue instead", () => {
    assert.deepEqual(planIssue({ breaches, openIssues: [42], date: "2026-10-10", body: "table" }), {
      kind: "comment",
      issue: 42,
      body: "table",
    });
  });

  /** @scenario "No breach does nothing" */
  void it("does nothing without a breach", () => {
    assert.deepEqual(
      planIssue({ breaches: [], openIssues: [42], date: "2026-10-10", body: "table" }),
      { kind: "none" },
    );
  });
});
