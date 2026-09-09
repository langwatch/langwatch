import { InvalidColumnError } from "@langwatch/dataset-contract";

/**
 * A key the dataset does not define is refused, not dropped. The fill downstream writes only
 * defined columns, so an unknown key would vanish and the caller would read a 201 for data
 * nothing stored.
 */
export function assertKnownColumns({
  datasetName,
  columns,
  entries,
}: {
  datasetName: string;
  columns: string[];
  entries: ReadonlyArray<Record<string, unknown>>;
}): void {
  const valid = new Set(columns);
  for (const entry of entries) {
    for (const key of Object.keys(entry)) {
      if (key === "id" || valid.has(key)) {
        continue;
      }

      throw new InvalidColumnError({ columnName: key, datasetName, validColumns: columns });
    }
  }
}
