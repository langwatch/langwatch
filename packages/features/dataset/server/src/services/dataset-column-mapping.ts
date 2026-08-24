import type {
  DatasetColumns,
  DatasetRecordInput,
} from "@langwatch/dataset-contract";

export const tryToMapPreviousColumnsToNewColumns = (
  records: DatasetRecordInput[],
  previousColumns: DatasetColumns,
  newColumns: DatasetColumns,
): DatasetRecordInput[] => {
  const mapping: Record<string, string | undefined> = {};
  for (const previous of previousColumns) {
    const exact = newColumns.find((column) => column.name === previous.name);
    if (exact) mapping[previous.name] = exact.name;
  }
  const previousUnmapped = previousColumns.filter((column) => !(column.name in mapping));
  const newUnmapped = newColumns.filter((column) => !Object.values(mapping).includes(column.name));
  previousUnmapped.forEach((previous, index) => {
    const next = newUnmapped[index];
    if (next) mapping[previous.name] = next.name;
  });
  return records.map((record) => {
    const mapped: DatasetRecordInput = record.id ? { id: record.id } : {};
    for (const [key, value] of Object.entries(record)) {
      if (key !== "id" && mapping[key]) mapped[mapping[key]!] = value;
    }
    return mapped;
  });
};
