/**
 * CSV Export utilities for batch evaluation results
 *
 * Generates CSV files from BatchEvaluationData with the new V3-style layout:
 * - Dataset columns
 * - Target output columns (one per target)
 * - Cost and duration per target
 * - Evaluator results per target (score, passed, details)
 * - Comparison verdicts per comparison evaluator (winner, candidates, reasoning)
 */

import numeral from "numeral";
import Parse from "papaparse";

import type {
  BatchComparisonColumn,
  BatchComparisonVerdict,
  BatchEvaluationData,
  BatchResultRow,
} from "./types";

/**
 * Stringify a value for CSV output
 */
const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/**
 * Format a number value for CSV output
 */
const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  return numeral(value).format("0.[0000]");
};

/**
 * Format a boolean value for CSV output
 */
const formatBoolean = (value: boolean | null | undefined): string => {
  if (value === null || value === undefined) return "";
  return value ? "true" : "false";
};

/**
 * Written to a comparison's winner column when the judge called the row a tie.
 */
const TIE_WINNER = "tie";

/**
 * Written when the judge answered but named a candidate this run does not
 * know. Kept apart from a tie on purpose: a tie is evidence shared between the
 * candidates, an unplaceable answer is no evidence at all, and reporting it as
 * a tie hands the reader a result nobody produced.
 */
const UNRESOLVED_WINNER = "unresolved";

/**
 * Written when a comparison produced no winner: the two judge passes named
 * different winners, the judge answered without naming one, or the row had too
 * few candidate outputs to compare at all.
 *
 * One token for all of them because the stored row cannot tell them apart: the
 * SDKs report `inconclusive` and `skipped` as distinct verdicts but record both
 * under the same batch status, so naming either one here would be a guess. The
 * reasoning cell beside it says which happened, in the judge's own words.
 *
 * These used to export as three empty cells, which read exactly like a row with
 * no comparison result at all, and dropped the explanation with them.
 */
const NO_VERDICT_WINNER = "no_verdict";

/**
 * Name of one comparison candidate, resolved the way the results page resolves
 * it: the variant's display name, falling back to the raw identifier for a
 * candidate the run has dropped since it was judged.
 */
const comparisonVariantName = (
  column: BatchComparisonColumn,
  variantId: string,
): string =>
  column.variants.find((variant) => variant.id === variantId)?.name ?? variantId;

/**
 * The winning candidate for one row, by name.
 */
const formatComparisonWinner = (
  column: BatchComparisonColumn,
  verdict: BatchComparisonVerdict,
): string => {
  if (verdict.winnerId === null) {
    if (verdict.isUnsettled) return NO_VERDICT_WINNER;
    return verdict.isUnresolved ? UNRESOLVED_WINNER : TIE_WINNER;
  }
  return comparisonVariantName(column, verdict.winnerId);
};

/**
 * The candidates the judge actually compared on this row, which can be a
 * strict subset of the comparison's variants when a target produced no output
 * for the row. Empty when the verdict carries no candidates: naming the
 * column-wide variant list instead would assert a matchup that may never have
 * happened.
 */
const formatComparisonCandidates = (
  column: BatchComparisonColumn,
  verdict: BatchComparisonVerdict,
): string =>
  (verdict.candidateIds ?? [])
    .map((candidateId) => comparisonVariantName(column, candidateId))
    .join(", ");

/**
 * Build CSV headers for the new layout
 */
export const buildCsvHeaders = (data: BatchEvaluationData): string[] => {
  const headers: string[] = [];

  // Row index first - useful for debugging and cross-referencing
  headers.push("index");

  // Dataset columns
  for (const col of data.datasetColumns) {
    headers.push(col.name);
  }

  // Target columns with their outputs, cost, duration, and evaluator results
  for (const target of data.targetColumns) {
    // Target metadata columns (model, prompt info, custom metadata)
    if (target.model) {
      headers.push(`${target.name}_model`);
    }
    if (target.promptId) {
      headers.push(`${target.name}_prompt_id`);
      headers.push(`${target.name}_prompt_version`);
    }
    // Custom metadata keys
    if (target.metadata) {
      for (const key of Object.keys(target.metadata)) {
        headers.push(`${target.name}_${key}`);
      }
    }

    // Target output (may have multiple fields)
    for (const field of target.outputFields) {
      headers.push(`${target.name}_${field}`);
    }
    // If no output fields detected, add a generic output column
    if (target.outputFields.length === 0) {
      headers.push(`${target.name}_output`);
    }

    // Cost and duration for this target
    headers.push(`${target.name}_cost`);
    headers.push(`${target.name}_duration_ms`);

    // Error column
    headers.push(`${target.name}_error`);

    // Trace ID
    headers.push(`${target.name}_trace_id`);

    // Evaluator results for this target
    // Get unique evaluator IDs used by this target
    const evaluatorIds = new Set<string>();
    for (const row of data.rows) {
      const targetOutput = row.targets[target.id];
      if (targetOutput) {
        for (const evalResult of targetOutput.evaluatorResults) {
          evaluatorIds.add(evalResult.evaluatorId);
        }
      }
    }

    for (const evalId of evaluatorIds) {
      const evalName = data.evaluatorNames[evalId] ?? evalId;
      headers.push(`${target.name}_${evalName}_score`);
      headers.push(`${target.name}_${evalName}_passed`);
      headers.push(`${target.name}_${evalName}_label`);
      headers.push(`${target.name}_${evalName}_details`);
      headers.push(`${target.name}_${evalName}_cost`);
      headers.push(`${target.name}_${evalName}_duration_ms`);
    }
  }

  // Comparison verdicts, after every target block so the existing column order
  // is untouched for anything reading the export by position. A comparison
  // grades the row as a whole rather than any single target, so it gets a block
  // of its own instead of living inside one target's columns. Named from the
  // comparison so a run with several of them keeps them apart.
  for (const comparison of data.comparisonColumns ?? []) {
    headers.push(`${comparison.name}_winner`);
    headers.push(`${comparison.name}_candidates`);
    headers.push(`${comparison.name}_reasoning`);
  }

  // Normalize headers: lowercase, replace spaces with underscores
  return headers.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
};

/**
 * Build CSV row data for a single row
 */
const buildCsvRow = (row: BatchResultRow, data: BatchEvaluationData): string[] => {
  const values: string[] = [];

  // Row index first
  values.push(String(row.index));

  // Dataset columns
  for (const col of data.datasetColumns) {
    values.push(stringify(row.datasetEntry[col.name]));
  }

  // Target columns
  for (const target of data.targetColumns) {
    const targetOutput = row.targets[target.id];

    // Target metadata values (must match header order)
    if (target.model) {
      values.push(target.model);
    }
    if (target.promptId) {
      values.push(target.promptId);
      values.push(target.promptVersion != null ? String(target.promptVersion) : "");
    }
    // Custom metadata values
    if (target.metadata) {
      for (const key of Object.keys(target.metadata)) {
        values.push(stringify(target.metadata[key]));
      }
    }

    // Target output fields
    if (target.outputFields.length > 0) {
      for (const field of target.outputFields) {
        const output = targetOutput?.output as Record<string, unknown> | null;
        values.push(stringify(output?.[field]));
      }
    } else {
      // Generic output
      values.push(stringify(targetOutput?.output));
    }

    // Cost and duration
    values.push(formatNumber(targetOutput?.cost));
    values.push(formatNumber(targetOutput?.duration));

    // Error
    values.push(targetOutput?.error ?? "");

    // Trace ID
    values.push(targetOutput?.traceId ?? "");

    // Evaluator results
    const evaluatorIds = new Set<string>();
    for (const r of data.rows) {
      const to = r.targets[target.id];
      if (to) {
        for (const er of to.evaluatorResults) {
          evaluatorIds.add(er.evaluatorId);
        }
      }
    }

    for (const evalId of evaluatorIds) {
      const evalResult = targetOutput?.evaluatorResults.find(
        (e) => e.evaluatorId === evalId,
      );

      if (!evalResult) {
        // Empty values for: score, passed, label, details, cost, duration
        values.push("", "", "", "", "", "");
        continue;
      }

      if (evalResult.status === "error") {
        values.push("Error", "", "", evalResult.details ?? "", "", "");
        continue;
      }

      if (evalResult.status === "skipped") {
        values.push("Skipped", "", "", evalResult.details ?? "", "", "");
        continue;
      }

      values.push(formatNumber(evalResult.score));
      values.push(formatBoolean(evalResult.passed));
      values.push(evalResult.label ?? "");
      values.push(evalResult.details ?? "");
      values.push(formatNumber(evalResult.cost));
      values.push(formatNumber(evalResult.duration));
    }
  }

  // Comparison verdicts (must match header order)
  for (const comparison of data.comparisonColumns ?? []) {
    const verdict = comparison.verdictsByRow[row.index];

    // The judge never ran on this row. Leaving the block empty says that,
    // where any winner value would claim a comparison happened. A row it DID
    // run and could not settle is a different thing and exports as
    // `no_verdict`, carrying the judge's account of it.
    if (!verdict) {
      values.push("", "", "");
      continue;
    }

    values.push(formatComparisonWinner(comparison, verdict));
    values.push(formatComparisonCandidates(comparison, verdict));
    values.push(verdict.reasoning ?? "");
  }

  return values;
};

/**
 * Build complete CSV data from BatchEvaluationData
 */
export const buildCsvData = (
  data: BatchEvaluationData,
): { headers: string[]; rows: string[][] } => {
  const headers = buildCsvHeaders(data);
  const rows = data.rows.map((row) => buildCsvRow(row, data));
  return { headers, rows };
};

/**
 * Generate CSV content string from BatchEvaluationData
 */
export const generateCsvContent = (data: BatchEvaluationData): string => {
  const { headers, rows } = buildCsvData(data);
  return Parse.unparse({
    fields: headers,
    data: rows,
  });
};

/**
 * Download CSV file from BatchEvaluationData
 */
export const downloadCsv = (data: BatchEvaluationData, experimentName: string): void => {
  const csvContent = generateCsvContent(data);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);

  const formattedDate = new Date(data.createdAt).toISOString().split("T")[0];
  const fileName = `${formattedDate}_${experimentName}_${data.runId}.csv`;

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

/**
 * Hook-compatible CSV download function
 */
export type CsvDownloadOptions = {
  data: BatchEvaluationData | null;
  experimentName: string;
};

export const createCsvDownloader = ({ data, experimentName }: CsvDownloadOptions) => {
  const isEnabled = !!data && data.rows.length > 0;

  const download = () => {
    if (!data) {
      throw new Error("No data to export");
    }
    downloadCsv(data, experimentName);
  };

  return { download, isEnabled };
};
