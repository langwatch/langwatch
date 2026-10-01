/**
 * CSV Export utilities for batch evaluation results
 */

import { neutralizeFormula, neutralizeRows } from "@langwatch/csv";
import {
  readableDate,
  type BatchComparisonColumn,
  type BatchComparisonVerdict,
  type BatchEvaluationData,
  type BatchEvaluatorResult,
  type BatchResultRow,
  type BatchTargetColumn,
  type BatchTargetOutput,
} from "@langwatch/experiment-browser-kit";
import numeral from "numeral";
import Parse from "papaparse";
import { z } from "zod";

const jsonRecordSchema = z.record(z.string(), z.unknown());

/**
 * Stringify a value for CSV output
 */
const stringify = (value: unknown): string => {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

/**
 * Format a number value for CSV output
 */
const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === void 0) return "";
  return numeral(value).format("0.[0000]");
};

/**
 * Format a boolean value for CSV output
 */
const formatBoolean = (value: boolean | null | undefined): string => {
  if (value === null || value === void 0) return "";
  return value ? "true" : "false";
};

/**
 * Written to a comparison's winner column when the judge called the row a tie.
 */
const TIE_WINNER = "tie";

/**
 * Written when the judge answered but named a candidate this run does not know.
 */
const UNRESOLVED_WINNER = "unresolved";

/**
 * Written when a comparison produced no winner: the two judge passes named different
 * winners, the judge answered without naming one, or the row had too few candidate
 * outputs to compare at all.
 */
const NO_VERDICT_WINNER = "no_verdict";

/**
 * Name of one comparison candidate, resolved the way the results page resolves
 * it: the variant's display name, falling back to the raw identifier for a
 * candidate the run has dropped since it was judged.
 */
const comparisonVariantName = (column: BatchComparisonColumn, variantId: string): string =>
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
 * The candidates the judge actually compared on this row, which can be a strict subset
 * of the comparison's variants when a target produced no output for the row.
 */
const formatComparisonCandidates = (
  column: BatchComparisonColumn,
  verdict: BatchComparisonVerdict,
): string =>
  (verdict.candidateIds ?? [])
    .map((candidateId) => comparisonVariantName(column, candidateId))
    .join(", ");

/** Every evaluator any row ran against `targetId`, in first-seen order. */
const targetEvaluatorIds = (data: BatchEvaluationData, targetId: string): Set<string> =>
  new Set(
    data.rows.flatMap(
      (row) => row.targets[targetId]?.evaluatorResults.map((result) => result.evaluatorId) ?? [],
    ),
  );

const EVALUATOR_HEADER_SUFFIXES = ["score", "passed", "label", "details", "cost", "duration_ms"];

/** One target's header block: metadata, outputs, cost, duration, error, trace, evaluators. */
const targetHeaders = (data: BatchEvaluationData, target: BatchTargetColumn): string[] => {
  // The name the reader sees, so two targets stored under one name keep their own block.
  const targetName = target.displayName ?? target.name;
  const outputFields = target.outputFields.length > 0 ? target.outputFields : ["output"];
  const evaluatorHeaders = [...targetEvaluatorIds(data, target.id)].flatMap((evalId) => {
    const evalName = data.evaluatorNames[evalId] ?? evalId;
    return EVALUATOR_HEADER_SUFFIXES.map((suffix) => `${targetName}_${evalName}_${suffix}`);
  });

  return [
    ...(target.model ? [`${targetName}_model`] : []),
    ...(target.promptId ? [`${targetName}_prompt_id`, `${targetName}_prompt_version`] : []),
    ...Object.keys(target.metadata ?? {}).map((key) => `${targetName}_${key}`),
    ...outputFields.map((field) => `${targetName}_${field}`),
    `${targetName}_cost`,
    `${targetName}_duration_ms`,
    `${targetName}_error`,
    `${targetName}_trace_id`,
    ...evaluatorHeaders,
  ];
};

/**
 * Build CSV headers for the new layout
 */
export const buildCsvHeaders = (data: BatchEvaluationData): string[] => {
  // Row index first - useful for debugging and cross-referencing
  const headers: string[] = [
    "index",
    ...data.datasetColumns.map((col) => col.name),
    ...data.targetColumns.flatMap((target) => targetHeaders(data, target)),
  ];

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

/** One evaluator's six cells: score, passed, label, details, cost, duration. */
const evaluatorValues = (evalResult: BatchEvaluatorResult | undefined): string[] => {
  if (!evalResult) return ["", "", "", "", "", ""];
  if (evalResult.status === "error") return ["Error", "", "", evalResult.details ?? "", "", ""];
  if (evalResult.status === "skipped") return ["Skipped", "", "", evalResult.details ?? "", "", ""];

  return [
    formatNumber(evalResult.score),
    formatBoolean(evalResult.passed),
    evalResult.label ?? "",
    evalResult.details ?? "",
    formatNumber(evalResult.cost),
    formatNumber(evalResult.duration),
  ];
};

/** One target's cells for one row, in the order `targetHeaders` names them. */
const targetValues = ({
  data,
  target,
  targetOutput,
}: {
  data: BatchEvaluationData;
  target: BatchTargetColumn;
  targetOutput: BatchTargetOutput | undefined;
}): string[] => {
  const output = targetOutput?.output;
  const parsedOutput = jsonRecordSchema.safeParse(output);
  const outputValues =
    target.outputFields.length > 0
      ? target.outputFields.map((field) =>
          stringify(parsedOutput.success ? parsedOutput.data[field] : void 0),
        )
      : [stringify(output)];
  const evaluatorCells = [...targetEvaluatorIds(data, target.id)].flatMap((evalId) =>
    evaluatorValues(targetOutput?.evaluatorResults.find((e) => e.evaluatorId === evalId)),
  );

  return [
    ...(target.model ? [target.model] : []),
    ...(target.promptId
      ? [target.promptId, target.promptVersion != null ? String(target.promptVersion) : ""]
      : []),
    ...Object.keys(target.metadata ?? {}).map((key) => stringify(target.metadata?.[key])),
    ...outputValues,
    formatNumber(targetOutput?.cost),
    formatNumber(targetOutput?.duration),
    targetOutput?.error ?? "",
    targetOutput?.traceId ?? "",
    ...evaluatorCells,
  ];
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

  for (const target of data.targetColumns) {
    values.push(...targetValues({ data, target, targetOutput: row.targets[target.id] }));
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
 * Generate CSV content string from BatchEvaluationData.
 */
export const generateCsvContent = (data: BatchEvaluationData): string => {
  const { headers, rows } = buildCsvData(data);
  return Parse.unparse({
    fields: headers.map(neutralizeFormula),
    data: neutralizeRows(rows),
  });
};

/**
 * Download CSV file from BatchEvaluationData
 */
export const downloadCsv = (data: BatchEvaluationData, experimentName: string): void => {
  const csvContent = generateCsvContent(data);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);

  const formattedDate = readableDate(data.createdAt).toISOString().split("T")[0];
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
