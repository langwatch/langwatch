import type { DatasetColumns, DatasetRecordInput } from "@langwatch/dataset-contract";

const TRUE_VALUES = new Set(["true", "1", "yes", "y", "on", "ok"]);
const FALSE_VALUES = new Set(["false", "0", "null", "undefined", "nan", "inf", "no", "n", "off"]);

type CellValue = DatasetRecordInput[string];

/** A conversion, or null when the cell keeps the value it already carries. */
type Converted = { value: CellValue } | null;

function toNumber(value: CellValue): Converted {
  if (!value) return { value: null };

  const isNumeric = !Number.isNaN(Number(value));
  if (!isNumeric) return null;

  return { value: Number.parseFloat(String(value)) };
}

function toBoolean(value: CellValue): Converted {
  const normalizedValue = String(value ?? "").toLowerCase();
  if (TRUE_VALUES.has(normalizedValue)) return { value: true };
  if (FALSE_VALUES.has(normalizedValue)) return { value: false };

  return null;
}

function toDate(value: CellValue): Converted {
  const dateAttempt = new Date(String(value));
  const isRealDate = !Number.isNaN(dateAttempt.getTime());
  if (!isRealDate) return null;

  return { value: dateAttempt.toISOString().split("T")[0] ?? null };
}

/** Anything else declared: a JSON payload, with malformed text left as it was. */
function toJson(value: CellValue): Converted {
  if (typeof value !== "string") return null;

  try {
    return { value: JSON.parse(value) };
  } catch {
    return null;
  }
}

const CONVERTERS: Record<string, (value: CellValue) => Converted> = {
  number: toNumber,
  boolean: toBoolean,
  date: toDate,
  // Image values are URLs and should remain strings.
  image: (value) => ({ value }),
};

function converterFor(type: string | undefined): ((value: CellValue) => Converted) | undefined {
  if (type === "string") return undefined;

  return CONVERTERS[type ?? ""] ?? toJson;
}

/** Converts CSV-style record values to the types declared by Dataset columns. */
export function convertDatasetRecordsToColumnTypes(
  datasetRecords: DatasetRecordInput[],
  columnTypes: DatasetColumns,
): DatasetRecordInput[] {
  const typeForColumn = Object.fromEntries(columnTypes.map((column) => [column.name, column.type]));

  return datasetRecords.map((record) => {
    const convertedRecord = { ...record };

    for (const [key, value] of Object.entries(record)) {
      const convert = converterFor(typeForColumn[key]);
      if (!convert) continue;

      const converted = convert(value);
      if (converted) convertedRecord[key] = converted.value;
    }

    return convertedRecord;
  });
}
