import { nanoid } from "nanoid";
import type { DatasetRecordEntry } from "../../server/datasets/types";

export function transposeIDlessColumnsFirstToRowsFirstWithId(
  data: Record<string, string[]>
): DatasetRecordEntry[] {
  return Object.entries(data).reduce((acc, [column, values]) => {
    values.forEach((value, index) => {
      acc[index] = acc[index] ?? { id: nanoid() };
      acc[index][column] = value;
    });
    return acc;
  }, [] as DatasetRecordEntry[]);
}

export function transpostRowsFirstToColumnsFirstWithoutId(
  data: DatasetRecordEntry[]
): Record<string, string[]> {
  return data.reduce(
    (acc, row) => {
      Object.entries(row).forEach(([key, value]) => {
        if (key === "id" || key === "selected") return;
        acc[key] = acc[key] ?? [];
        acc[key].push(value);
      });
      return acc;
    },
    {} as Record<string, string[]>
  );
}
