/**
 * Pure shaping of the data a run loads: dataset rows and columns, and the keys
 * loaded targets are cached under.
 */

/** The column type a parameter value writes into the dataset. */
function parameterColumnType(value: string | number | boolean): string {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

// Column types that store JSON and need parsing
export const JSON_COLUMN_TYPES = [
  "chat_messages",
  "json",
  "list",
  "spans",
  "rag_contexts",
] as const;

/**
 * Parses JSON string values in specified columns.
 */
export const parseJsonColumns = (
  rows: Record<string, unknown>[],
  jsonColumnKeys: Set<string>,
): Record<string, unknown>[] => {
  if (jsonColumnKeys.size === 0) {
    return rows;
  }

  return rows.map((row) => {
    const parsedRow = { ...row };
    for (const key of jsonColumnKeys) {
      const value = parsedRow[key];
      if (typeof value === "string" && value.trim()) {
        try {
          parsedRow[key] = JSON.parse(value);
        } catch {
          // Keep original string if not valid JSON
        }
      }
    }

    return parsedRow;
  });
};

/**
 * Normalizes inline dataset records from column IDs to column names.
 */
export const normalizeColumnIdsToNames = (
  rows: Record<string, unknown>[],
  columns: { id: string; name: string }[],
): Record<string, unknown>[] => {
  const idToName = Object.fromEntries(columns.map((c) => [c.id, c.name]));

  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      // Use name if we have a mapping, otherwise keep the key as-is
      normalized[idToName[key] ?? key] = value;
    }

    return normalized;
  });
};

/**
 * Result of loading a dataset.
 */
export type LoadedDataset = {
  rows: Record<string, unknown>[];
  columns: { id: string; name: string; type: string }[];
};

/**
 * Normalizes inline row-first data (from the run API or an SDK) into the
 * loaded dataset shape. Columns are derived from the union of keys across
 * rows.
 */
export const rowsFromInlineData = (data: Record<string, unknown>[]): LoadedDataset => {
  const columnNames: string[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columnNames.push(key);
      }
    }
  }

  return {
    rows: data,
    columns: columnNames.map((name) => ({ id: name, name, type: "string" })),
  };
};

/**
 * Applies caller-provided parameters as constant columns across every row.
 */
export function applyParametersToRows({
  rows,
  columns,
  parameters,
}: {
  rows: Record<string, unknown>[];
  columns: { id: string; name: string; type: string }[];
  parameters?: Record<string, string | number | boolean>;
}): {
  rows: Record<string, unknown>[];
  columns: { id: string; name: string; type: string }[];
} {
  if (!parameters || Object.keys(parameters).length === 0) {
    return { rows, columns };
  }

  const existingNames = new Set(columns.map((c) => c.name));
  // A parameter overriding an existing column rewrites every row's value below,
  // so the column's declared type must follow the parameter or the rows and the
  // column metadata would disagree (e.g. a number written into a "string" column).
  const columnsWithParameters = [
    ...columns.map((column) =>
      Object.hasOwn(parameters, column.name)
        ? { ...column, type: parameterColumnType(parameters[column.name]!) }
        : column,
    ),
    ...Object.entries(parameters)
      .filter(([key]) => !existingNames.has(key))
      .map(([key, value]) => ({
        id: key,
        name: key,
        type: parameterColumnType(value),
      })),
  ];

  // With no rows, the parameters themselves form a single synthetic row.
  const baseRows = rows.length === 0 ? [{}] : rows;
  const rowsWithParameters = baseRows.map((row) => ({ ...row, ...parameters }));

  return { rows: rowsWithParameters, columns: columnsWithParameters };
}

/**
 * Cache key for a loaded workflow. Two targets that pin the same workflow to
 * different versions must not share a loaded DSL, so the key includes the
 * requested version (or "published" when following the latest committed one).
 */
export function workflowLoadKey(target: {
  workflowId?: string;
  workflowVersionId?: string;
}): string {
  return `${target.workflowId ?? ""}::${target.workflowVersionId ?? "published"}`;
}

/**
 * Cache key for a loaded prompt. Two targets that pin the same prompt to
 * different versions must not share a loaded prompt, so the key includes the
 * requested version (or "latest" when the target follows the newest one).
 */
export function promptLoadKey(target: { promptId?: string; promptVersionNumber?: number }): string {
  return `${target.promptId ?? ""}@${target.promptVersionNumber ?? "latest"}`;
}
