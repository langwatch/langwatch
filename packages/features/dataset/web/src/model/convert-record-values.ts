import type { DatasetColumns, DatasetRecordInput } from "@langwatch/dataset-contract";

const TRUE_VALUES = new Set(["true", "1", "yes", "y", "on", "ok"]);
const FALSE_VALUES = new Set(["false", "0", "null", "undefined", "nan", "inf", "no", "n", "off"]);

/** Converts CSV-style record values to the types declared by Dataset columns. */
export function convertDatasetRecordsToColumnTypes(
  datasetRecords: DatasetRecordInput[],
  columnTypes: DatasetColumns,
): DatasetRecordInput[] {
  const typeForColumn = Object.fromEntries(columnTypes.map((column) => [column.name, column.type]));

  return datasetRecords.map((record) => {
    const convertedRecord = { ...record };

    for (const [key, value] of Object.entries(record)) {
      const type = typeForColumn[key];
      if (type === "number") {
        if (!value) {
          convertedRecord[key] = null;
        } else if (!Number.isNaN(Number(value))) {
          convertedRecord[key] = Number.parseFloat(String(value));
        }
      } else if (type === "boolean") {
        const normalizedValue = String(value ?? "").toLowerCase();
        if (TRUE_VALUES.has(normalizedValue)) {
          convertedRecord[key] = true;
        } else if (FALSE_VALUES.has(normalizedValue)) {
          convertedRecord[key] = false;
        }
      } else if (type === "date") {
        const dateAttempt = new Date(String(value));
        if (!Number.isNaN(dateAttempt.getTime())) {
          convertedRecord[key] = dateAttempt.toISOString().split("T")[0];
        }
      } else if (type === "image") {
        // Image values are URLs and should remain strings.
        convertedRecord[key] = value;
      } else if (type !== "string" && typeof value === "string") {
        try {
          convertedRecord[key] = JSON.parse(value);
        } catch {
          // Keep malformed JSON as the original string.
        }
      }
    }

    return convertedRecord;
  });
}
