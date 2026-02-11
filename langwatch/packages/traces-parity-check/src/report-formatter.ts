/**
 * Report Formatter
 *
 * Console + JSON report output for trace parity check results.
 */

import type { ParityReport, TraceComparisonResult } from "./types.js";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * Format the full parity report for console output
 */
export function formatConsoleReport(report: ParityReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("TRACES PARITY CHECK RESULTS");
  lines.push("=".repeat(65));

  // Summary box
  const s = report.summary;
  lines.push(`Duration: ${formatDuration(s.totalDurationMs)}`);
  lines.push("");

  const otel = report.otelTraces;
  lines.push(
    `OTEL Traces: ${otel.totalCompared} compared, ${otel.passed} passed, ${otel.failed} failed`,
  );

  if (report.pythonSdk) {
    const py = report.pythonSdk;
    lines.push(
      `Python SDK: ${py.totalValidated} validated (ES: ${py.esOk} ok, CH: ${py.chOk} ok)`,
    );
  }

  if (s.snippets) {
    lines.push(
      `Snippets: ${s.snippets.total} total, ${s.snippets.validated} validated, ${s.snippets.passed} passed, ${s.snippets.issues} issues, ${s.snippets.skipped} skipped`,
    );
  }

  lines.push("");

  // Trace-level fields
  lines.push("TRACE-LEVEL FIELDS");
  const traceFields = otel.fieldSummaries.filter((f) => !f.field.startsWith("spans"));
  for (const field of traceFields) {
    const status = field.failed === 0 ? "[PASS]" : "[FAIL]";
    const padded = field.field.padEnd(32);
    lines.push(`  ${status} ${padded} ${field.passed}/${field.total}`);
  }

  lines.push("");

  // Span-level fields
  lines.push("SPAN-LEVEL FIELDS");
  const spanFields = otel.fieldSummaries.filter((f) => f.field.startsWith("spans"));
  for (const field of spanFields) {
    const status = field.failed === 0 ? "[PASS]" : "[FAIL]";
    const padded = field.field.padEnd(32);
    lines.push(`  ${status} ${padded} ${field.passed}/${field.total}`);
  }

  // Failures detail
  const failedFields = otel.fieldSummaries.filter((f) => f.failed > 0);
  if (failedFields.length > 0) {
    lines.push("");
    lines.push("FAILURES");
    for (const field of failedFields) {
      for (const failure of field.failures.slice(0, 3)) {
        const percentStr = failure.percentDiff !== undefined
          ? ` (${(failure.percentDiff * 100).toFixed(1)}%)`
          : "";
        lines.push(
          `  trace ${failure.traceId.slice(0, 8)}: ${field.field} ES=${formatValue(failure.esValue)} vs CH=${formatValue(failure.chValue)}${percentStr}`,
        );
      }
      if (field.failures.length > 3) {
        lines.push(`  ... and ${field.failures.length - 3} more for ${field.field}`);
      }
    }
  }

  // Python SDK results
  if (report.pythonSdk) {
    lines.push("");
    lines.push("PYTHON SDK EXAMPLES");
    lines.push("-".repeat(65));

    for (const result of report.pythonSdk.results) {
      const status = result.structuralMatch ? "[OK]" : "[ISSUE]";
      lines.push(`  ${status} ${result.exampleName}`);
      if (result.issues.length > 0) {
        for (const issue of result.issues.slice(0, 3)) {
          lines.push(`        ${issue}`);
        }
        if (result.issues.length > 3) {
          lines.push(`        ... and ${result.issues.length - 3} more issues`);
        }
      }
    }
  }

  // Onboarding snippet results
  if (report.snippets) {
    lines.push("");
    lines.push("ONBOARDING SNIPPETS");
    lines.push("-".repeat(65));

    const snip = report.snippets;

    for (const result of snip.results) {
      const status = result.structuralMatch ? "[OK]" : "[ISSUE]";
      const formatBackend = (summary: typeof result.esSummary) => {
        if (!summary) return "no trace";
        const parts: string[] = [];
        parts.push(summary.hasInput ? "in" : "no-in");
        parts.push(summary.hasOutput ? "out" : "no-out");
        if (summary.spanCount > 0) parts.push(`${summary.spanCount} spans`);
        if (summary.model) parts.push(summary.model);
        return parts.join(", ");
      };
      lines.push(`  ${status} ${result.snippetName.padEnd(24)} ES(${formatBackend(result.esSummary)}) CH(${formatBackend(result.chSummary)})`);
      if (result.issues.length > 0) {
        for (const issue of result.issues.slice(0, 3)) {
          lines.push(`        ${issue}`);
        }
        if (result.issues.length > 3) {
          lines.push(`        ... and ${result.issues.length - 3} more issues`);
        }
      }
    }

    if (snip.skipped.length > 0) {
      lines.push("");
      lines.push("  SKIPPED/FAILED:");
      for (const skip of snip.skipped) {
        if (skip.reason === "skipped" && skip.missingEnvVars?.length) {
          lines.push(`  [SKIP] ${skip.snippetName} (missing: ${skip.missingEnvVars.join(", ")})`);
        } else {
          const error = skip.esError ?? skip.chError ?? "";
          const shortError = error.length > 80 ? error.slice(-80) : error;
          lines.push(`  [FAIL] ${skip.snippetName} (${skip.reason})${shortError ? `: ${shortError}` : ""}`);
        }
      }
    }
  }

  lines.push("");
  lines.push("=".repeat(65));
  lines.push(`Overall: ${report.overallPassed ? "PASSED" : "FAILED"}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Format verbose failure details for trace comparisons.
 */
export function formatVerboseFailures(
  traceResults: TraceComparisonResult[],
): string {
  const lines: string[] = [];
  const failed = traceResults.filter((r) => !r.passed);

  lines.push("\nDETAILED FAILURES:");
  lines.push("-".repeat(55));

  for (const result of failed.slice(0, 10)) {
    lines.push(`\nTrace: ${result.traceId}`);
    for (const disc of result.discrepancies.slice(0, 10)) {
      const percentStr =
        disc.percentDiff !== undefined
          ? ` (${(disc.percentDiff * 100).toFixed(1)}% diff)`
          : "";
      lines.push(
        `  ${disc.path}: ES=${formatJsonCompact(disc.esValue)} vs CH=${formatJsonCompact(disc.chValue)}${percentStr}`,
      );
    }
    if (result.discrepancies.length > 10) {
      lines.push(`  ... and ${result.discrepancies.length - 10} more`);
    }
  }

  if (failed.length > 10) {
    lines.push(`\n... and ${failed.length - 10} more failed traces`);
  }

  return lines.join("\n");
}

function formatJsonCompact(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json.length > 100 ? json.slice(0, 100) + "..." : json;
  } catch {
    return String(value);
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(6);
  }
  if (typeof value === "string") {
    return value.length > 50 ? `"${value.slice(0, 50)}..."` : `"${value}"`;
  }
  const json = JSON.stringify(value);
  return json.length > 60 ? json.slice(0, 60) + "..." : json;
}
