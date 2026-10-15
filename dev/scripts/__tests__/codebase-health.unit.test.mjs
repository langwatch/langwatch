import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildHealth,
  compareHealth,
  measureBundle,
  parseArchitectureReport,
  parseTypecheckLog,
  planDashboard,
  planIssue,
  renderDashboard,
  renderMarkdown,
} from "../codebase-health.mjs";

function health({
  programs = [],
  depth = 17,
  declarations = [],
  architecture = {},
  typecheckResult,
  bundle,
} = {}) {
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
    typecheckResult,
    bundle,
    testRepoSeconds: 90,
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

const failedTypecheck = parseTypecheckLog({
  text: "a.ts(1,1): error TS2322: x\nok\nb.ts(2,2): error TS2304: y\nc.ts(3,3): error TS1005: z\n",
  exitCode: 2,
});

void describe("a failing typecheck", () => {
  /** @scenario "A failing typecheck is a breach and the other metrics are still compared" */
  void it("is a breach with the first error lines and the rest is still compared", () => {
    const previous = health({ architecture: { cycles: 0 } });
    const current = health({ architecture: { cycles: 2 }, typecheckResult: failedTypecheck });
    const breaches = compareHealth({ previous, current });
    assert.equal(breaches[0].metric, "typecheck failed on main: 3 errors");
    assert.equal(breaches[0].offenders.length, 3);
    assert.ok(metrics(breaches).includes("architecture cycles"));
  });

  /** @scenario "Time and memory from a failed typecheck are not compared" */
  void it("records time and memory as unavailable", () => {
    const previous = health();
    const current = health({ typecheckResult: failedTypecheck });
    assert.equal(current.typecheck.wallSeconds, null);
    assert.equal(current.typecheck.peakRssKb, null);
    assert.match(renderMarkdown({ previous, current, breaches: [] }), /not compared/);
    assert.match(
      renderMarkdown({ previous, current, breaches: [] }),
      /\| typecheck wall seconds \| 600 \| n\/a \| {2}\|/,
    );
  });

  /** @scenario "A passing typecheck reports no typecheck breach" */
  void it("reports no typecheck breach on exit 0", () => {
    const breaches = compareHealth({ previous: health(), current: health() });
    assert.deepEqual(breaches, []);
  });
});

const bundleOf = ({ js, gzip, over = [] }) => ({
  failed: false,
  totalJsBytes: js,
  totalCssBytes: 1000,
  entryGzipBytes: gzip,
  entryFiles: ["assets/index-aaaaaaaa.js"],
  largest: over,
  overLimit: over,
});

void describe("the UI bundle", () => {
  /** @scenario "Total JS or entry gzip up more than ten per cent is a breach" */
  void it("flags total JS and entry gzip growth over 10%", () => {
    const previous = health({ bundle: bundleOf({ js: 10_000_000, gzip: 300_000 }) });
    const grown = health({ bundle: bundleOf({ js: 11_500_000, gzip: 340_000 }) });
    assert.deepEqual(metrics(compareHealth({ previous, current: grown })), [
      "UI JS total bytes",
      "UI entry gzip bytes",
    ]);
    const steady = health({ bundle: bundleOf({ js: 10_500_000, gzip: 310_000 }) });
    assert.deepEqual(compareHealth({ previous, current: steady }), []);
  });

  /** @scenario "A new chunk over 500 KB is a breach, a known large one is not" */
  void it("flags only a new large chunk, matching rehashed names", () => {
    const old = { file: "assets/vendor-AbCd1234.js", bytes: 600_000 };
    const rehashed = { file: "assets/vendor-WxYz9876.js", bytes: 610_000 };
    const fresh = { file: "assets/charts-QwEr5678.js", bytes: 700_000 };
    const previous = health({ bundle: bundleOf({ js: 10_000_000, gzip: 300_000, over: [old] }) });
    const current = health({
      bundle: bundleOf({ js: 10_100_000, gzip: 300_000, over: [fresh, rehashed] }),
    });
    assert.deepEqual(metrics(compareHealth({ previous, current })), [
      "UI chunk over 500 KB assets/charts-QwEr5678.js",
    ]);
  });

  /** @scenario "A failed UI build is a breach" */
  void it("reports a failed build and compares no sizes", () => {
    const previous = health({ bundle: bundleOf({ js: 10_000_000, gzip: 300_000 }) });
    const current = health({ bundle: { failed: true } });
    assert.deepEqual(metrics(compareHealth({ previous, current })), ["UI build failed"]);
    assert.deepEqual(metrics(compareHealth({ previous: null, current })), ["UI build failed"]);
  });

  /** @scenario "Bundle sizes are measured from the built output" */
  void it("measures totals, gzipped entry and largest chunks", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(
      join(dir, "index.html"),
      '<script type="module" src="/assets/index-aaaaaaaa.js"></script>',
    );
    writeFileSync(join(dir, "assets/index-aaaaaaaa.js"), "a".repeat(1000));
    writeFileSync(join(dir, "assets/lazy-bbbbbbbb.js"), "b".repeat(3000));
    writeFileSync(join(dir, "assets/app-cccccccc.css"), "c".repeat(500));
    const bundle = measureBundle({ dir });
    assert.equal(bundle.totalJsBytes, 4000);
    assert.equal(bundle.totalCssBytes, 500);
    assert.deepEqual(bundle.entryFiles, ["assets/index-aaaaaaaa.js"]);
    assert.ok(bundle.entryGzipBytes > 0 && bundle.entryGzipBytes < 1000);
    assert.equal(bundle.largest[0].file, "assets/lazy-bbbbbbbb.js");
  });

  /** @scenario "A missing build output is not a bundle of zero bytes" */
  void it("records no bundle when the directory is absent", () => {
    assert.equal(measureBundle({ dir: join(tmpdir(), "no-such-bundle-dir") }), null);
    const previous = health({ bundle: bundleOf({ js: 10_000_000, gzip: 300_000 }) });
    assert.deepEqual(compareHealth({ previous, current: health({ bundle: null }) }), []);
  });
});

void describe("the dashboard", () => {
  const issues = [{ number: 5, title: "Codebase health: x", url: "https://example/5" }];

  /** @scenario "The dashboard shows tonight, last night and a week ago" */
  void it("has a row per metric with both changes and the breach links", () => {
    const body = renderDashboard({
      current: health({ depth: 20 }),
      previous: health({ depth: 10 }),
      weekAgo: health({ depth: 40 }),
      breachIssues: issues,
    });
    assert.match(body, /\| reference chain depth \| 20 \| 100\.0% \| -50\.0% \|/);
    assert.match(body, /https:\/\/example\/5/);
  });

  /** @scenario "The dashboard copes with no older runs" */
  void it("renders n/a without older runs", () => {
    const body = renderDashboard({
      current: health(),
      previous: null,
      weekAgo: null,
      breachIssues: [],
    });
    assert.match(body, /\| reference chain depth \| 17 \| n\/a \| n\/a \|/);
    assert.match(body, /None\./);
  });

  /** @scenario "The dashboard issue is created when absent and edited when present" */
  void it("creates when absent and edits the body when present", () => {
    assert.equal(planDashboard({ openIssues: [], body: "b" }).kind, "create");
    assert.deepEqual(planDashboard({ openIssues: [7], body: "b" }), {
      kind: "edit",
      issue: 7,
      body: "b",
    });
  });
});
