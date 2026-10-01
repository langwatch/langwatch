import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { excerptRanges, renderFindings, toFindings } from "../lint-findings.mjs";

function diagnostic({ rule, file = "a.ts", line }) {
  return {
    code: rule,
    filename: file,
    message: `fix for ${rule} at ${line}`,
    labels: [{ span: { line } }],
  };
}

const source = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
const readSource = () => source;

void describe("rendering one finding", () => {
  /** @scenario "Each finding prints its rule, line, fix and the code around it" */
  void it("names the rule and line and shows the marked excerpt", () => {
    const findings = toFindings({
      diagnostics: [diagnostic({ rule: "langwatch(no-inline-dynamic-import)", line: 24 })],
      rules: [],
    });
    const out = renderFindings({ findings, readSource, context: 2, max: 40 });
    assert.match(out, /L24 langwatch\/no-inline-dynamic-import: fix for/);
    assert.match(out, /^ {4}22│ line 22$/m);
    assert.match(out, /^> {3}24│ line 24$/m);
    assert.match(out, /^ {4}26│ line 26$/m);
    assert.doesNotMatch(out, /│ line 27$/m);
  });
});

void describe("two findings close together", () => {
  /** @scenario "Findings close together in one file share one excerpt" */
  void it("merges their excerpts into one range", () => {
    assert.deepEqual(excerptRanges({ lines: [12, 10], context: 2 }), [{ from: 8, to: 14 }]);
    const findings = toFindings({
      diagnostics: [10, 12].map((line) => diagnostic({ rule: "x(r)", line })),
      rules: [],
    });
    const out = renderFindings({ findings, readSource, context: 2, max: 40 });
    assert.equal(out.match(/│ line 11$/gm).length, 1);
  });
});

void describe("a capped render", () => {
  /** @scenario "The summary counts every finding per rule, before any cap" */
  void it("counts all findings and names how many were left out", () => {
    const diagnostics = [1, 5, 9, 13, 17].map((line) => diagnostic({ rule: "x(many)", line }));
    diagnostics.push(diagnostic({ rule: "x(one)", file: "b.ts", line: 3 }));
    const out = renderFindings({
      findings: toFindings({ diagnostics, rules: [] }),
      readSource,
      context: 1,
      max: 2,
    });
    assert.match(out, /^6 findings in 2 files: x\/many 5, x\/one 1$/m);
    assert.match(out, /4 more findings not shown/);
  });
});

void describe("a rule filter", () => {
  /** @scenario "A rule filter keeps only the named rules" */
  void it("keeps only the named rule", () => {
    const diagnostics = [
      diagnostic({ rule: "x(keep)", line: 2 }),
      diagnostic({ rule: "x(drop)", line: 30 }),
    ];
    const out = renderFindings({
      findings: toFindings({ diagnostics, rules: ["keep"] }),
      readSource,
      context: 1,
      max: 40,
    });
    assert.match(out, /^1 findings in 1 files: x\/keep 1$/m);
    assert.doesNotMatch(out, /drop/);
  });
});
