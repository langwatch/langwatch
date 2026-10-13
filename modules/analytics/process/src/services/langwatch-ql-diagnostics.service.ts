/**
 * Advisory result diagnostics. The validator alone refuses SQL; these describe facts that can
 * make an accepted result easy to misread. Query-shape rules use its one recorded walk, never a
 * second parse; the other rules read the returned rows.
 */
import type { LangWatchQLDiagnostic } from "@langwatch/analytics-contract";

import {
  type LangWatchQLDiagnosticsInput,
  resolveTableReferences,
} from "../rules/langwatch-ql-diagnostics-shape.rules.ts";
import { LangWatchQLBucketDiagnosticsService } from "./langwatch-ql-bucket-diagnostics.service.ts";
import { LangWatchQLFanoutDiagnosticsService } from "./langwatch-ql-fanout-diagnostics.service.ts";

/** The project-identifier column, matched however the caller cased it. */
const PROJECT_ID_COLUMN = "tenantid";

/**
 * A key reading several projects gets the union of their rows unless the query narrows to one.
 * Counted from the returned rows, and only when the project column was selected: without it the
 * projects are not in the result to count. Silent for a single-project result.
 */
function multiProjectDiagnostics({
  columns,
  rows,
}: LangWatchQLDiagnosticsInput): LangWatchQLDiagnostic[] {
  const column = columns.find(
    (candidate) => candidate.name.trim().toLowerCase() === PROJECT_ID_COLUMN,
  );
  if (!column) return [];

  const projects = new Set(rows.map((row) => row[column.name]));
  if (projects.size <= 1) return [];

  return [
    {
      code: "MULTI_PROJECT_RESULT",
      message:
        `This result draws rows from ${projects.size} projects this key can read. ` +
        `If you meant one, filter on ${column.name} — for example ` +
        `WHERE ${column.name} = '<project id>'.`,
      meta: { projectCount: projects.size },
    },
  ];
}

/**
 * What hydration has to say about the values it put in the result: one diagnostic per
 * condition rather than per column, the columns riding in `meta`.
 */
function appFunctionDiagnostics({
  appFunctions,
}: LangWatchQLDiagnosticsInput): LangWatchQLDiagnostic[] {
  if (!appFunctions) return [];
  const diagnostics: LangWatchQLDiagnostic[] = [];
  if (appFunctions.valueTruncations.length > 0) {
    diagnostics.push({
      code: "APP_FUNCTION_VALUE_TRUNCATED",
      message:
        "Some values were cut because a single conversation or trace was larger than one value may be. Ask for a smaller token budget to choose what is kept.",
      meta: { columns: appFunctions.valueTruncations },
    });
  }
  if (appFunctions.isTruncatedByBytes) {
    diagnostics.push({
      code: "APP_FUNCTION_RESULT_TRUNCATED",
      message:
        "Trailing rows were dropped because the extracted values reached this API's response ceiling. " +
        "Ask for a smaller token budget per call, or narrow the query, to see the whole answer.",
      meta: {
        maxHydratedBytes: appFunctions.maxHydratedBytes,
        rowsReturned: appFunctions.rowsReturned,
      },
    });
  }
  if (appFunctions.unresolvedKeys.length > 0) {
    diagnostics.push({
      code: "APP_FUNCTION_UNRESOLVED_KEYS",
      message:
        "Some rows are null because their conversation, trace or span key matched nothing. Check the ids, and that the rows are inside the retention window.",
      meta: { columns: appFunctions.unresolvedKeys },
    });
  }
  const skipped = appFunctions.skippedJudgements ?? {};
  const skippedTexts = Object.values(skipped).reduce((total, count) => total + count, 0);
  if (skippedTexts > 0) {
    diagnostics.push({
      code: "INSTANT_EVAL_SKIPPED",
      message:
        "Some rows are null because their text could not be judged. Run the query again, ask for less text per row, " +
        "or check that judging is switched on for this project.",
      meta: { texts: skippedTexts, reasons: skipped },
    });
  }

  return diagnostics;
}

function unboundedTimeRangeDiagnostics({
  validation,
  database,
  views,
}: LangWatchQLDiagnosticsInput): LangWatchQLDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: LangWatchQLDiagnostic[] = [];

  for (const block of validation.blocks) {
    const filtered = new Set(block.filteredColumns);
    for (const reference of resolveTableReferences({
      block,
      database,
      views,
    })) {
      const { timeColumn } = reference.view;
      // A view with no time column has nothing to bound a scan on, so there is
      // no unbounded-range advice to give.
      if (!timeColumn) {
        continue;
      }

      const isFiltered = filtered.has(timeColumn.toLowerCase());
      if (isFiltered) {
        continue;
      }

      if (seen.has(reference.viewName)) {
        continue;
      }

      seen.add(reference.viewName);

      diagnostics.push({
        code: "UNBOUNDED_TIME_RANGE",
        message:
          `${reference.viewName} was read with no condition on ${timeColumn}, so the read ` +
          `covers the whole history this project has rather than a window of it. Add a range ` +
          `on ${timeColumn} to bound the scan.`,
        meta: {
          view: reference.viewName,
          /** Filter on this column to bound the read. */
          timeColumn,
        },
      });
    }
  }

  return diagnostics;
}

/** Advisory notes about a result: what the query did that the caller may not have meant. */
export class LangWatchQLDiagnosticsService {
  static create(): LangWatchQLDiagnosticsService {
    return new LangWatchQLDiagnosticsService();
  }

  private constructor(
    private readonly fanout = LangWatchQLFanoutDiagnosticsService.create(),
    private readonly buckets = LangWatchQLBucketDiagnosticsService.create(),
  ) {}

  /**
   * Every diagnostic a finished query earns, in a stable order. Pure. Truncation first because
   * it changes what the other rules are looking at: a cut-off result can be missing the buckets
   * they would have read.
   */
  diagnose(input: LangWatchQLDiagnosticsInput): readonly LangWatchQLDiagnostic[] {
    return [
      ...appFunctionDiagnostics(input),
      ...multiProjectDiagnostics(input),
      ...this.fanout.diagnose(input),
      ...unboundedTimeRangeDiagnostics(input),
      ...this.buckets.diagnose(input),
    ];
  }
}
