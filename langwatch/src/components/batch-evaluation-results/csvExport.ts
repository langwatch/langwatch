/**
 * CSV Export utilities for batch evaluation results
 *
 * Generates CSV files from BatchEvaluationData with the new V3-style layout:
 * - Dataset columns
 * - Target output columns (one per target)
 * - Cost and duration per target
 * - Evaluator results per target (score, passed, details)
 */

import numeral from "numeral";
import Parse from "papaparse";

import type {
  BatchEvaluationData,
  BatchResultRow,
  BatchTargetOutput,
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

  // Normalize headers: lowercase, replace spaces with underscores
  return headers.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
};

/**
 * Build CSV row data for a single row
 */
const buildCsvRow = (
  row: BatchResultRow,
  data: BatchEvaluationData,
): string[] => {
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
      values.push(
        target.promptVersion != null ? String(target.promptVersion) : "",
      );
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
export const downloadCsv = (
  data: BatchEvaluationData,
  experimentName: string,
): void => {
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

export const createCsvDownloader = ({
  data,
  experimentName,
}: CsvDownloadOptions) => {
  const isEnabled = !!data && data.rows.length > 0;

  const download = () => {
    if (!data) {
      throw new Error("No data to export");
    }
    downloadCsv(data, experimentName);
  };

  return { download, isEnabled };
};
