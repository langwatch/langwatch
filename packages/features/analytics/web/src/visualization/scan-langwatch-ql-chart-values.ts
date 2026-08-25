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

import { JSON_POINTER_ROOT, joinPointer, visitJsonObjects } from "./vega-lite-structure";
import type {
  LangWatchQLDataset,
  LangWatchQLDatasetColumn,
  VegaValidationWarning,
} from "./visualization-types";

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
  columnsByDataset: Readonly<Record<string, readonly LangWatchQLDatasetColumn[]>>;
}): Record<string, string[]> {
  const referenced = new Set<string>();
  for (const { node } of visitJsonObjects(spec)) {
    if (typeof node.field !== "string") continue;
    referenced.add(node.field);
    // Vega-Lite escapes a literal `.` in a column name as `\.`, so a column
    // named `a.b` reaches the spec as `a\.b` while the response still carries
    // `a.b`. Without the unescaped form the column drops out of the scan set
    // and its non-finite and wide-integer warnings are never reported.
    // `vegaLiteFields.ts` applies the same rule when it matches a field.
    referenced.add(node.field.replace(/\\(.)/g, "$1"));
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

export interface ScanLangWatchQLChartValuesInput {
  /** Fields the specification encodes, per dataset name. */
  readonly encodedFieldsByDataset: Readonly<Record<string, readonly string[]>>;
  readonly datasets: Readonly<Record<string, LangWatchQLDataset>>;
  readonly columnsByDataset: Readonly<
    Record<string, readonly LangWatchQLDatasetColumn[]>
  >;
}

export interface LangWatchQLChartValueScan {
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

export function scanLangWatchQLChartValues({
  encodedFieldsByDataset,
  datasets,
  columnsByDataset,
}: ScanLangWatchQLChartValuesInput): LangWatchQLChartValueScan {
  const warnings: VegaValidationWarning[] = [];
  let scannedFields = 0;
  let fieldsWithValues = 0;

  for (const [dataset, fields] of Object.entries(encodedFieldsByDataset)) {
    const rows = datasets[dataset] ?? [];
    const types = columnTypes(columnsByDataset[dataset] ?? []);

    for (const field of fields) {
      scannedFields += 1;
      const tally = tallyField({
        rows,
        field,
        isWideNumeric: isWide(types[field]),
      });
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
  columns: readonly LangWatchQLDatasetColumn[],
): Record<string, string> {
  return Object.fromEntries(columns.map((column) => [column.name, column.type]));
}

function isWide(type: string | undefined): boolean {
  return type !== void 0 && WIDE_NUMERIC_TYPE.test(type);
}

/**
 * What one value is worth to a chart.
 *
 * `empty` is nothing to draw; `plottable` is a value an axis can carry as it
 * stands; the other two are the ways a value reaches Vega changed.
 */
type ValueVerdict = "empty" | "plottable" | "non-finite" | "wide-integer";

function classify({
  value,
  isWideNumeric,
}: {
  value: unknown;
  isWideNumeric: boolean;
}): ValueVerdict {
  if (value === null || value === void 0 || value === "") return "empty";

  if (typeof value === "number") {
    return Number.isFinite(value) ? "plottable" : "non-finite";
  }
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? "plottable" : "wide-integer";
  }
  // ClickHouse returns 64-bit and decimal columns as strings so no digits are
  // lost on the wire. Vega parses them to doubles, which is where they are.
  if (isWideNumeric && typeof value === "string" && exceedsSafeInteger(value)) {
    return "wide-integer";
  }
  return "plottable";
}

function tallyField({
  rows,
  field,
  isWideNumeric,
}: {
  rows: LangWatchQLDataset;
  field: string;
  isWideNumeric: boolean;
}): FieldTally {
  const tally: FieldTally = { nonEmpty: 0, nonFinite: 0, wideInteger: 0 };

  for (const row of rows) {
    const verdict = classify({ value: row[field], isWideNumeric });
    if (verdict === "empty") continue;

    tally.nonEmpty += 1;
    if (verdict === "non-finite") tally.nonFinite += 1;
    if (verdict === "wide-integer") tally.wideInteger += 1;
  }

  return tally;
}

// ClickHouse formats a Decimal column with trailing or leading zeros
// ("1.10", "007") that carry no digits a double would drop. Comparing the raw
// wire string against `String(parsed)` would flag that formatting alone as
// lost precision, so both sides are reduced to the same canonical shape
// first: no leading zeros, no trailing fractional zeros, no signed zero.
function canonicalDecimal(value: string): string {
  const isNegative = value.startsWith("-");
  const unsigned = isNegative ? value.slice(1) : value;
  // `split` always yields at least one element, but `noUncheckedIndexedAccess`
  // cannot see that; the default keeps the type honest without changing behaviour.
  const [integerPart = "", fractionPart = ""] = unsigned.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "");
  const fraction = fractionPart.replace(/0+$/, "");
  const magnitude = fraction.length > 0 ? `${integer}.${fraction}` : integer;
  return magnitude === "0" ? "0" : `${isNegative ? "-" : ""}${magnitude}`;
}

function exceedsSafeInteger(value: string): boolean {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return false;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return true;
  // Round-tripping is the honest test: it asks whether the double carries every
  // digit back, which covers both magnitude and decimal precision.
  return String(parsed) !== canonicalDecimal(value);
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
