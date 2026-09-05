/**
 * Advisory result diagnostics. The validator alone refuses SQL; these describe
 * facts that can make an accepted result easy to misread. Query-shape rules use
 * its one recorded walk, never a second parse; other rules use returned rows or
 * the executor's truncation report. Under-report rather than warn on a fact
 * this module cannot point at.
 */
import type { LangWatchQLDiagnostic } from "@langwatch/analytics-contract";

import {
  type LangWatchQLDiagnosticsInput,
  resolveTableReferences,
} from "../rules/langwatch-ql-diagnostics-shape.rules";
import { LangWatchQLBucketDiagnosticsService } from "./langwatch-ql-bucket-diagnostics.service";
import { LangWatchQLFanoutDiagnosticsService } from "./langwatch-ql-fanout-diagnostics.service";

function truncationDiagnostics({
  truncated,
  limits,
  rowsReturned,
}: LangWatchQLDiagnosticsInput): LangWatchQLDiagnostic[] {
  if (!truncated) {
    return [];
  }

  return [
    {
      code: "RESULT_TRUNCATED",
      message:
        "The result was cut off at this API's response ceiling. Aggregate further, or narrow the query, to see the whole answer.",
      meta: {
        maxRows: limits.maxRows,
        maxResultBytes: limits.maxResultBytes,
        rowsReturned,
      },
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
      if (filtered.has(timeColumn.toLowerCase())) {
        continue;
      }

      if (seen.has(reference.datasetName)) {
        continue;
      }

      seen.add(reference.datasetName);

      diagnostics.push({
        code: "UNBOUNDED_TIME_RANGE",
        message:
          `${reference.datasetName} was read with no condition on ${timeColumn}, so the read ` +
          `covers the whole history this project has rather than a window of it. Add a range ` +
          `on ${timeColumn} to bound the scan.`,
        meta: {
          dataset: reference.datasetName,
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
   * Every diagnostic a finished query earns, in a stable order.
   *
   * Pure. Truncation first because it changes what the other rules are looking
   * at: a cut-off result can be missing the buckets they would have read.
   */
  diagnose(input: LangWatchQLDiagnosticsInput): readonly LangWatchQLDiagnostic[] {
    return [
      ...truncationDiagnostics(input),
      ...this.fanout.diagnose(input),
      ...unboundedTimeRangeDiagnostics(input),
      ...this.buckets.diagnose(input),
    ];
  }
}
