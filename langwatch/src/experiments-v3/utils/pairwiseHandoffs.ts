/**
 * Pairwise compare handoffs (#5100, step F).
 *
 * Three pure functions that turn pairwise verdict data into the
 * payloads the AggregateHeaderBar and RowVerdictStrip use:
 *
 *   - buildBugReport      — markdown for a single losing row.
 *   - buildExportReport   — markdown for the whole run.
 *   - buildPromotePayload — clipboard string for promoting a winning
 *                            variant (full prompt-versioning wiring is
 *                            issue #5104; MVP ships markdown only).
 *
 * Kept pure (no DOM / clipboard side effects) so they are trivially
 * testable. Callers wire them to clipboard via navigator.clipboard
 * or to a download via a Blob + anchor in the table component.
 */

export type PairwiseRowVerdict = {
  rowIndex: number;
  /** "A", "B", or "tie" — verdict label from the pairwise evaluator. */
  label: "A" | "B" | "tie";
  /** Judge reasoning text. */
  reasoning?: string;
  /** Raw dataset entry for the row (column name -> value). */
  datasetEntry: Record<string, unknown>;
  /** Output produced by variantA on this row. */
  outputA: unknown;
  /** Output produced by variantB on this row. */
  outputB: unknown;
  /** Pairwise cost for the row (sum of judge calls), in USD. */
  cost?: number;
};

export type PairwiseRunMeta = {
  variantAName: string;
  variantBName: string;
  goldenField: string;
  biasCorrected: boolean;
};

const fenced = (s: unknown): string => {
  const text =
    typeof s === "string" ? s : s === undefined ? "" : JSON.stringify(s);
  return "```\n" + text + "\n```";
};

/**
 * Markdown bug report for a single losing row. "Losing" is defined
 * relative to a baseline variant the caller picks (typically variant
 * A = current production). The function itself doesn't assume which
 * is the baseline — the caller decides what counts as a regression
 * and passes the row through.
 */
export function buildBugReport(
  row: PairwiseRowVerdict,
  meta: PairwiseRunMeta,
): string {
  const winnerName =
    row.label === "tie"
      ? "Tie"
      : row.label === "A"
        ? meta.variantAName
        : meta.variantBName;

  const inputValue =
    row.datasetEntry.input !== undefined
      ? row.datasetEntry.input
      : Object.values(row.datasetEntry)[0];

  return [
    `# Pairwise regression — row ${row.rowIndex}`,
    "",
    `**Winner:** ${winnerName}`,
    "",
    "## Input",
    fenced(inputValue),
    "",
    `## Golden (\`${meta.goldenField}\`)`,
    fenced(row.datasetEntry[meta.goldenField]),
    "",
    `## ${meta.variantAName} output`,
    fenced(row.outputA),
    "",
    `## ${meta.variantBName} output`,
    fenced(row.outputB),
    "",
    "## Judge reasoning",
    row.reasoning ?? "_(no reasoning recorded)_",
  ].join("\n");
}

/**
 * Markdown export for the whole run — tally header + a section per
 * row. Use as the body of a downloadable .md blob.
 */
export function buildExportReport(
  rows: PairwiseRowVerdict[],
  meta: PairwiseRunMeta,
): string {
  const counts = { a: 0, b: 0, tie: 0 };
  let totalCost = 0;
  for (const r of rows) {
    counts[r.label === "A" ? "a" : r.label === "B" ? "b" : "tie"]++;
    totalCost += r.cost ?? 0;
  }

  const header = [
    `# Pairwise compare — ${meta.variantAName} vs ${meta.variantBName}`,
    "",
    `**Tally:** ${meta.variantAName} wins ${counts.a} · ${meta.variantBName} wins ${counts.b} · Ties ${counts.tie}`,
    "",
    `**Bias-corrected:** ${meta.biasCorrected ? "yes (swap-and-confirm)" : "no"}`,
    `**Judge cost:** $${totalCost.toFixed(4)}`,
    "",
    "---",
    "",
  ].join("\n");

  const body = rows
    .map((r) => {
      const winnerName =
        r.label === "tie"
          ? "Tie"
          : r.label === "A"
            ? meta.variantAName
            : meta.variantBName;
      return [
        `## Row ${r.rowIndex} — winner: ${winnerName}`,
        "",
        `**Golden (\`${meta.goldenField}\`):** ${stringifyInline(r.datasetEntry[meta.goldenField])}`,
        "",
        `**${meta.variantAName} output:**`,
        fenced(r.outputA),
        "",
        `**${meta.variantBName} output:**`,
        fenced(r.outputB),
        "",
        r.reasoning ? `**Reasoning:** ${r.reasoning}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return header + body + "\n";
}

/**
 * Clipboard string for "Promote A" / "Promote B" — MVP-only. The full
 * promote-to-prompt-versioning flow is tracked in #5104; this just
 * gives the user a markdown reference they can paste anywhere.
 */
export function buildPromotePayload(
  variant: "A" | "B",
  rows: PairwiseRowVerdict[],
  meta: PairwiseRunMeta,
): string {
  const name = variant === "A" ? meta.variantAName : meta.variantBName;
  const wins = rows.filter((r) => r.label === variant).length;
  const losses = rows.filter(
    (r) => r.label !== variant && r.label !== "tie",
  ).length;
  const ties = rows.filter((r) => r.label === "tie").length;

  return [
    `# Promote ${name}`,
    "",
    `Outcome across ${rows.length} rows: ${wins} wins · ${losses} losses · ${ties} ties.`,
    "",
    `_Wired clipboard hand-off only; full prompt-versioning promotion is tracked in #5104._`,
  ].join("\n");
}

function stringifyInline(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
