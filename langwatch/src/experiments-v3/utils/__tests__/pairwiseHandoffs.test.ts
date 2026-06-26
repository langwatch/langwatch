/**
 * Unit tests for the pairwise handoff string builders (#5100).
 * Pure functions, so the tests are pure too — no jsdom, no clipboard.
 */
import { describe, expect, it } from "vitest";

import {
  buildBugReport,
  buildExportReport,
  buildPromotePayload,
  type PairwiseRowVerdict,
  type PairwiseRunMeta,
} from "../pairwiseHandoffs";

const meta: PairwiseRunMeta = {
  variantAName: "variant_a",
  variantBName: "variant_b",
  goldenField: "expected_output",
  biasCorrected: true,
};

const makeRow = (
  overrides: Partial<PairwiseRowVerdict> = {},
): PairwiseRowVerdict => ({
  rowIndex: 0,
  label: "A",
  reasoning: "A is closer to the golden answer.",
  datasetEntry: {
    input: "What is the capital of France?",
    expected_output: "Paris",
  },
  outputA: "The capital of France is Paris.",
  outputB: "It's Paris.",
  cost: 0.0002,
  ...overrides,
});

describe("buildBugReport", () => {
  it("includes input, golden, both outputs, winner, and reasoning", () => {
    const md = buildBugReport(makeRow({ label: "B" }), meta);
    expect(md).toContain("# Pairwise regression — row 0");
    expect(md).toContain("**Winner:** variant_b");
    expect(md).toContain("What is the capital of France?");
    expect(md).toContain("Paris");
    expect(md).toContain("The capital of France is Paris.");
    expect(md).toContain("It's Paris.");
    expect(md).toContain("A is closer to the golden answer.");
  });

  it("renders 'Tie' as winner when label is tie", () => {
    const md = buildBugReport(makeRow({ label: "tie" }), meta);
    expect(md).toContain("**Winner:** Tie");
  });

  it("renders a no-reasoning placeholder when reasoning missing", () => {
    const md = buildBugReport(makeRow({ reasoning: undefined }), meta);
    expect(md).toContain("_(no reasoning recorded)_");
  });
});

describe("buildExportReport", () => {
  it("emits the tally and a per-row section", () => {
    const md = buildExportReport(
      [
        makeRow({ rowIndex: 0, label: "A" }),
        makeRow({ rowIndex: 1, label: "B" }),
        makeRow({ rowIndex: 2, label: "tie" }),
      ],
      meta,
    );
    expect(md).toContain(
      "**Tally:** variant_a wins 1 · variant_b wins 1 · Ties 1",
    );
    expect(md).toContain("## Row 0 — winner: variant_a");
    expect(md).toContain("## Row 1 — winner: variant_b");
    expect(md).toContain("## Row 2 — winner: Tie");
  });

  it("sums per-row cost into the header", () => {
    const md = buildExportReport(
      [makeRow({ cost: 0.001 }), makeRow({ cost: 0.002 })],
      meta,
    );
    expect(md).toContain("**Judge cost:** $0.0030");
  });

  it("marks bias-corrected when meta.biasCorrected is true", () => {
    const md = buildExportReport([makeRow()], meta);
    expect(md).toContain("**Bias-corrected:** yes (swap-and-confirm)");
  });

  it("marks bias-corrected as no when meta.biasCorrected is false", () => {
    const md = buildExportReport([makeRow()], {
      ...meta,
      biasCorrected: false,
    });
    expect(md).toContain("**Bias-corrected:** no");
  });
});

describe("buildPromotePayload", () => {
  it("counts wins / losses / ties for the promoted variant", () => {
    const rows = [
      makeRow({ rowIndex: 0, label: "A" }),
      makeRow({ rowIndex: 1, label: "A" }),
      makeRow({ rowIndex: 2, label: "B" }),
      makeRow({ rowIndex: 3, label: "tie" }),
    ];
    const md = buildPromotePayload("A", rows, meta);
    expect(md).toContain("# Promote variant_a");
    expect(md).toContain("Outcome across 4 rows: 2 wins · 1 losses · 1 ties.");
  });

  it("includes the #5104 follow-up note", () => {
    const md = buildPromotePayload("B", [makeRow()], meta);
    expect(md).toContain("#5104");
  });
});
