import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildReport,
  compareReports,
  parseArchitecture,
  parseChecks,
  parseGolangci,
  parseOxlint,
  parseTypecheck,
  renderHygiene,
  type HygieneReport,
  type ToolResult,
} from "./nightly-hygiene.ts";

const night = ({
  results,
  checks,
}: {
  results: Record<string, ToolResult>;
  checks?: string[];
}): HygieneReport =>
  buildReport({ date: "2026-10-20", commit: "0123456789abcdef", results, checks });

const findings = (rule: string, count: number) => ({
  reported: true,
  findings: Array.from({ length: count }, (_, index) => ({ rule, file: `f${index % 2}.ts` })),
});

void describe("given the findings of tonight's tools", () => {
  void describe("when the oxlint output is counted", () => {
    /** @scenario "Lint findings are counted per rule with the files that carry most of them" */
    void it("counts each rule with its heaviest file first and names unused directives", () => {
      const result = parseOxlint({
        text: [
          "src/a.ts:1:1: Nested ternary. [eslint(no-nested-ternary)]",
          "  help: use if",
          "src/a.ts:9:1: Nested ternary. [eslint(no-nested-ternary)]",
          "src/b.ts:2:3: Nested ternary: again. [eslint(no-nested-ternary)]",
          "src/c.ts:4:1: Unused eslint-disable directive (no problems were reported).",
          "",
          "4 problem(s)",
        ].join("\n"),
      });
      const report = night({ results: { oxlint: result } });
      assert.equal(result.reported, true);
      assert.deepEqual(report.categories["oxlint/eslint/no-nested-ternary"]?.files, [
        ["src/a.ts", 2],
        ["src/b.ts", 1],
      ]);
      assert.equal(report.categories["oxlint/eslint/no-nested-ternary"]?.count, 3);
      assert.equal(report.categories["oxlint/unused-directive"]?.count, 1);
    });
  });

  void describe("when the architecture enforcer's summary is counted", () => {
    /** @scenario "Architecture findings are counted per policy from the enforcer's summary" */
    void it("counts each policy's findings, reads a clean run as zero and a crash as no report", () => {
      const result = parseArchitecture({
        text: [
          "architecture-enforcer: 3 findings across 2 policies, exit 1 (findings)",
          "      2  cycles",
          "      1  manifests",
          "",
          "--- cycles: 2 findings ---",
        ].join("\n"),
      });
      const report = night({ results: { architecture: result } });
      assert.equal(result.reported, true);
      assert.equal(report.categories["architecture/cycles"]?.count, 2);
      assert.equal(report.categories["architecture/manifests"]?.count, 1);
      assert.deepEqual(
        parseArchitecture({ text: "architecture-enforcer: package boundaries are sealed\n" }),
        { reported: true, findings: [] },
      );
      assert.equal(parseArchitecture({ text: "pnpm: command not found\n" }).reported, false);
      assert.equal(
        parseArchitecture({ text: "architecture-enforcer: the run crashed\n  boom\n" }).reported,
        false,
      );
    });
  });

  void describe("when the typecheck output is counted", () => {
    /** @scenario "Typecheck errors are counted per error code in both compiler formats" */
    void it("reads the parenthesised and the colon form", () => {
      const result = parseTypecheck({
        exitCode: 1,
        text: [
          "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
          "@langwatch/api:typecheck: src/b.tsx:10:2 - error TS2322: Nope.",
          "src/c.ts(1,1): error TS7006: Parameter 'x' implicitly has an 'any' type.",
        ].join("\n"),
      });
      const report = night({ results: { typecheck: result } });
      assert.equal(report.categories["typecheck/TS2322"]?.count, 2);
      assert.deepEqual(report.categories["typecheck/TS7006"]?.files, [["src/c.ts", 1]]);
    });
  });

  void describe("when the golangci-lint output is counted", () => {
    /** @scenario "Go lint findings are counted per linter" */
    void it("counts issues per linter", () => {
      const result = parseGolangci({
        text: JSON.stringify({
          Issues: [
            { FromLinter: "misspell", Pos: { Filename: "a.go" } },
            { FromLinter: "misspell", Pos: { Filename: "b.go" } },
            { FromLinter: "gosec", Pos: { Filename: "a.go" } },
          ],
        }),
      });
      const report = night({ results: { golangci: result } });
      assert.equal(report.categories["golangci/misspell"]?.count, 2);
      assert.equal(report.categories["golangci/gosec"]?.count, 1);
    });
  });
});

void describe("given last night's report", () => {
  void describe("when there is none", () => {
    /** @scenario "The first night is the baseline and goes green" */
    void it("reports nothing new and says tonight is the baseline", () => {
      const current = night({ results: { oxlint: findings("a", 5) } });
      const { rows, regressions } = compareReports({ previous: null, current });
      assert.deepEqual(regressions, []);
      assert.match(
        renderHygiene({ current, rows, regressions, baseline: true }),
        /tonight is the baseline/,
      );
    });
  });

  void describe("when one rule rose and another fell", () => {
    /** @scenario "A rule whose count rose goes red, one that held or fell does not" */
    void it("reports only the rule that rose", () => {
      const previous = night({
        results: {
          oxlint: {
            reported: true,
            findings: [...findings("up", 10).findings, ...findings("down", 5).findings],
          },
        },
      });
      const current = night({
        results: {
          oxlint: {
            reported: true,
            findings: [...findings("up", 11).findings, ...findings("down", 2).findings],
          },
        },
      });
      const { regressions, rows } = compareReports({ previous, current });
      assert.deepEqual(regressions, [{ key: "oxlint/up", reason: "rose from 10 to 11" }]);
      assert.match(
        renderHygiene({ current, rows, regressions, baseline: false }),
        /\| oxlint\/down \| 2 \| -3 \|/,
      );
    });
  });

  void describe("when a rule has findings for the first time", () => {
    /** @scenario "A rule that appears for the first time goes red" */
    void it("reports it as new tonight", () => {
      const previous = night({ results: { oxlint: findings("old", 1) } });
      const current = night({
        results: {
          oxlint: {
            reported: true,
            findings: [...findings("old", 1).findings, ...findings("fresh", 2).findings],
          },
        },
      });
      assert.deepEqual(compareReports({ previous, current }).regressions, [
        { key: "oxlint/fresh", reason: "is new tonight with 2" },
      ]);
    });
  });

  void describe("when a pull request check changes state", () => {
    /** @scenario "A check that passed last night and fails tonight goes red" */
    void it("reports a check that started failing, not one that kept failing", () => {
      const checks = ["format", "readmes"];
      const previous = night({
        results: { check: parseChecks({ text: "format\t0\nreadmes\t1\n" }) },
        checks,
      });
      const current = night({
        results: { check: parseChecks({ text: "format\t1\nreadmes\t1\n" }) },
        checks,
      });
      assert.deepEqual(compareReports({ previous, current }).regressions, [
        { key: "check/format", reason: "is new tonight with 1" },
      ]);
    });
  });

  void describe("when a tool crashed before printing its findings", () => {
    /** @scenario "A tool that produced no report goes red rather than reading as clean" */
    void it("reports the tool and compares none of its rules", () => {
      const previous = night({ results: { oxlint: findings("a", 3) } });
      // The lint runner (tools/lintrun) still prints a count after one of its processes failed.
      const crashed = parseOxlint({
        text: "oxlint -c .oxlintrc.native.jsonc exited 2:\nconfig error\n\n0 problem(s)",
      });
      const current = night({ results: { oxlint: crashed } });
      assert.equal(crashed.reported, false);
      assert.deepEqual(compareReports({ previous, current }).regressions, [
        { key: "oxlint", reason: "produced no report, so its findings are unknown" },
      ]);
      assert.equal(parseTypecheck({ text: "nx crashed", exitCode: 1 }).reported, false);
    });
  });
});
