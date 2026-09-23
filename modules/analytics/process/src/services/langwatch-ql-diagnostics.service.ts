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
      ...multiProjectDiagnostics(input),
      ...this.fanout.diagnose(input),
      ...unboundedTimeRangeDiagnostics(input),
      ...this.buckets.diagnose(input),
    ];
  }
}
