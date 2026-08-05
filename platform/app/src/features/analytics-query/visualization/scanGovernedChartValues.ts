/**
 * What the data will look like once Vega has it — checked before it gets there.
 *
 * Two questions, both answerable from the rows and the column types alone:
 *
 *   1. Is there anything to draw? A chart over rows that are all empty in every
 *      encoded column is not a chart, and an empty plotting area explains
 *      nothing. It gets its own state instead.
 *   2. Is there anything Vega cannot carry faithfully? Vega's scales are
 *      IEEE-754 doubles. `NaN` and the infinities have no position on an axis,
 *      and a 64-bit integer past 2^53 has no exact one. Vega will draw
 *      *something* for each — a gap, a clamp, a rounded value — and none of
 *      those says "this number did not survive". So they are reported as
 *      warnings and nothing is coerced: the rows Vega receives are the rows the
 *      query returned.
 *
 * Zero, null, and missing are none of that. They are representable, they mean
 * different things, and they are left alone.
 */

import {
  joinPointer,
  JSON_POINTER_ROOT,
  visitJsonObjects,
} from "./vegaLiteStructure";
import type {
  GovernedDataset,
  GovernedDatasetColumn,
  VegaValidationWarning,
} from "./visualization.types";

/** ClickHouse types whose values can outrun a double's exact integer range. */
const WIDE_NUMERIC_TYPE = /\b(U?Int(64|128|256)|Decimal\d*)\b/;

/**
 * Which columns of which dataset the specification reads.
 *
 * Every `field` in the document is collected and then intersected with each
 * read dataset's own columns, rather than re-deriving which dataset feeds which
 * branch — `validateFieldReferences` already did that walk and already refused
 * anything that does not resolve. Two datasets sharing a column name means one
 * extra column is scanned; scanning a column that is genuinely there costs a
 * pass over rows already bounded by the row ceiling, and reports nothing false.
 */
export function encodedFieldsByDataset({
  spec,
  datasetNames,
  columnsByDataset,
}: {
  spec: unknown;
  datasetNames: readonly string[];
  columnsByDataset: Readonly<
    Record<string, readonly GovernedDatasetColumn[]>
  >;
}): Record<string, string[]> {
  const referenced = new Set<string>();
  for (const { node } of visitJsonObjects(spec)) {
    if (typeof node.field === "string") referenced.add(node.field);
  }

  return Object.fromEntries(
    datasetNames.map((name) => [
      name,
      (columnsByDataset[name] ?? [])
        .map((column) => column.name)
        .filter((column) => referenced.has(column)),
    ]),
  );
}

export interface ScanGovernedChartValuesInput {
  /** Fields the specification encodes, per dataset name. */
  readonly encodedFieldsByDataset: Readonly<Record<string, readonly string[]>>;
  readonly datasets: Readonly<Record<string, GovernedDataset>>;
  readonly columnsByDataset: Readonly<
    Record<string, readonly GovernedDatasetColumn[]>
  >;
}

export interface GovernedChartValueScan {
  /**
   * True when every encoded column of every read dataset holds nothing to
   * draw — no rows at all, or only null, undefined and empty strings.
   */
  readonly allEncodedValuesEmpty: boolean;
  readonly warnings: readonly VegaValidationWarning[];
}

interface FieldTally {
  nonEmpty: number;
  nonFinite: number;
  wideInteger: number;
}

export function scanGovernedChartValues({
  encodedFieldsByDataset,
  datasets,
  columnsByDataset,
}: ScanGovernedChartValuesInput): GovernedChartValueScan {
  const warnings: VegaValidationWarning[] = [];
  let scannedFields = 0;
  let fieldsWithValues = 0;

  for (const [dataset, fields] of Object.entries(encodedFieldsByDataset)) {
    const rows = datasets[dataset] ?? [];
    const types = columnTypes(columnsByDataset[dataset] ?? []);

    for (const field of fields) {
      scannedFields += 1;
      const tally = tallyField({ rows, field, wide: isWide(types[field]) });
      if (tally.nonEmpty > 0) fieldsWithValues += 1;
      warnings.push(...warningsFor({ dataset, field, tally }));
    }
  }

  return {
    allEncodedValuesEmpty: scannedFields > 0 && fieldsWithValues === 0,
    warnings,
  };
}

function columnTypes(
  columns: readonly GovernedDatasetColumn[],
): Record<string, string> {
  return Object.fromEntries(
    columns.map((column) => [column.name, column.type]),
  );
}

function isWide(type: string | undefined): boolean {
  return type !== undefined && WIDE_NUMERIC_TYPE.test(type);
}

function tallyField({
  rows,
  field,
  wide,
}: {
  rows: GovernedDataset;
  field: string;
  wide: boolean;
}): FieldTally {
  const tally: FieldTally = { nonEmpty: 0, nonFinite: 0, wideInteger: 0 };

  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined || value === "") continue;
    tally.nonEmpty += 1;

    if (typeof value === "number" && !Number.isFinite(value)) {
      tally.nonFinite += 1;
      continue;
    }
    if (typeof value === "bigint") {
      if (!Number.isSafeInteger(Number(value))) tally.wideInteger += 1;
      continue;
    }
    // ClickHouse returns 64-bit and decimal columns as strings so no digits are
    // lost on the wire. Vega parses them to doubles, which is where they are.
    if (wide && typeof value === "string" && exceedsSafeInteger(value)) {
      tally.wideInteger += 1;
    }
  }

  return tally;
}

function exceedsSafeInteger(value: string): boolean {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return false;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return true;
  // Round-tripping is the honest test: it asks whether the double carries every
  // digit back, which covers both magnitude and decimal precision.
  return String(parsed) !== value.replace(/^\+/, "");
}

function warningsFor({
  dataset,
  field,
  tally,
}: {
  dataset: string;
  field: string;
  tally: FieldTally;
}): VegaValidationWarning[] {
  const at = joinPointer(JSON_POINTER_ROOT, field);
  const warnings: VegaValidationWarning[] = [];

  if (tally.nonFinite > 0) {
    warnings.push({
      code: "unrepresentable-value",
      path: at,
      message: `"${field}" has ${tally.nonFinite.toLocaleString()} value${tally.nonFinite === 1 ? "" : "s"} that are not a finite number, which no axis can place. They are left out of the chart rather than drawn as zero — read them in the table.`,
      meta: { dataset, field, kind: "non-finite", count: tally.nonFinite },
    });
  }

  if (tally.wideInteger > 0) {
    warnings.push({
      code: "unrepresentable-value",
      path: at,
      message: `"${field}" has ${tally.wideInteger.toLocaleString()} value${tally.wideInteger === 1 ? "" : "s"} too precise for a chart to plot exactly, so the chart rounds them. The table shows every digit.`,
      meta: { dataset, field, kind: "precision", count: tally.wideInteger },
    });
  }

  return warnings;
}
