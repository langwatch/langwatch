import {
  convertValueToColumnType,
  datasetColumnsSchema,
  DatasetStaleColumnsError,
  InvalidColumnError,
  renameReservedColumns,
  type DatasetColumnRenames,
  type DatasetColumns,
  type DatasetConfirmColumns,
} from "@langwatch/dataset-contract";

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
  entries: readonly Record<string, unknown>[];
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

/**
 * A write keyed by columns the dataset no longer has in that order is refused: a column edit
 * landed after the caller read them. Order catches a swap, where the names stay but their
 * values trade places. Callers that name no columns are not checked.
 */
export function assertColumnsCurrent({
  columns,
  columnTypes,
}: {
  columns: readonly string[] | undefined;
  columnTypes: unknown;
}): void {
  if (!columns) return;
  const parsed = datasetColumnsSchema.safeParse(columnTypes);
  if (!parsed.success) return;
  const position = new Map(parsed.data.map((column, index) => [column.name, index]));
  let previous = -1;
  for (const column of columns) {
    const at = position.get(column);
    if (at === undefined || at <= previous) throw new DatasetStaleColumnsError();
    previous = at;
  }
}

/**
 * Why a column edit's renames are invalid; empty when they are fine. A rename must name a column
 * the dataset has and one the edit keeps, each once: a rename that misses would leave the renamed
 * column empty and drop the old one's values.
 */
export function columnRenameProblems({
  previousColumns,
  newColumns,
  renames,
}: {
  previousColumns: DatasetColumns;
  newColumns: DatasetColumns;
  renames: DatasetColumnRenames | undefined;
}): string[] {
  const previous = new Set(previousColumns.map((column) => column.name));
  const next = new Set(newColumns.map((column) => column.name));
  const list = renames ?? [];
  const repeated = (names: string[]) => [
    ...new Set(names.filter((name, index) => names.indexOf(name) !== index)),
  ];
  return [
    ...list
      .filter(({ from }) => !previous.has(from))
      .map(({ from }) => `"${from}" is not a column of this dataset`),
    ...list
      .filter(({ to }) => !next.has(to))
      .map(({ to }) => `"${to}" is not one of the new columns`),
    ...repeated(list.map(({ from }) => from)).map((name) => `"${name}" is renamed more than once`),
    ...repeated(list.map(({ to }) => to)).map(
      (name) => `"${name}" is the target of more than one rename`,
    ),
  ];
}

/**
 * Whether a column edit moves record values: a rename to another name, or an old column the new
 * list lacks.
 * A type change, a reorder or an added column leaves every stored value where it is.
 */
export function columnEditMovesValues({
  previousColumns,
  newColumns,
  renames,
}: {
  previousColumns: DatasetColumns;
  newColumns: DatasetColumns;
  renames: DatasetColumnRenames | undefined;
}): boolean {
  if (renames?.some(({ from, to }) => from !== to)) return true;
  const next = new Set(newColumns.map((column) => column.name));
  return previousColumns.some((column) => !next.has(column.name));
}

/**
 * Build the original→safe column rename map (m4). Reserved column names (`id`, etc.) are
 * renamed to a safe form (`id_`) exactly as `createDatasetFromUpload` does; only entries that
 * actually changed are kept so the common case is a no-op pass-through.
 */
export const buildRenameMap = (headers: string[]): Map<string, string> => {
  const renamed = renameReservedColumns(headers);
  const map = new Map<string, string>();
  headers.forEach((original, i) => {
    if (original !== renamed[i]) map.set(original, renamed[i]!);
  });
  return map;
};

/**
 * Rewrite a record's keys through the rename map so the stored JSONL row keys
 * match `columnTypes` (m4). Streaming — one record at a time, never buffers the
 * file. A no-op when nothing was renamed.
 */
export const applyRename = (
  record: Record<string, unknown>,
  renameMap: Map<string, string>,
): Record<string, unknown> => {
  if (renameMap.size === 0) return record;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[renameMap.get(key) ?? key] = value;
  }
  return out;
};

export type TargetBinding =
  | {
      kind: "bound";
      byCanonical: Map<string, DatasetColumns[number]>;
      /** The file headers when bound by `sourceHeader`; null on the positional path. */
      canonicalSet: Set<string> | null;
    }
  | { kind: "unbound" };

/** Binds the confirmed columns to the file's canonical headers, or degrades to unbound. */
export const bindTargetColumns = ({
  targetColumns,
  canonical,
}: {
  targetColumns: DatasetConfirmColumns | DatasetColumns | null | undefined;
  canonical: string[];
}): TargetBinding => {
  // An empty confirmed list can't produce a 0-column dataset; degrade instead.
  if (!targetColumns || targetColumns.length === 0) return { kind: "unbound" };
  // Confirmed names become the stored record keys (`out[target.name]` below), so a blank or
  // duplicated name would collapse two columns onto one key (silent per-record data loss) or
  // write an `""`-keyed column. The upload route's schema already rejects this, so reaching
  // here means a malformed stored row — degrade to a derived all-`string` schema rather than
  // emit the corruption.
  const names = targetColumns.map((c) => c.name);
  if (names.some((name) => name.trim() === "") || new Set(names).size !== names.length) {
    return { kind: "unbound" };
  }
  // Prefer binding by the immutable `sourceHeader` (survives drag-reorder +
  // rename + exclusion); fall back to positional binding for legacy bare
  // name+type lists (which require an exact 1:1 count — no exclusion).
  const hasSourceHeaders = targetColumns.every(
    (c) => typeof (c as DatasetConfirmColumns[number]).sourceHeader === "string",
  );
  // A PARTIAL confirm payload (some items carry `sourceHeader`, some don't) is
  // a client bug, not a legacy list — positional-binding it could silently map
  // values to the wrong column. Mirror the upload route (which rejects any
  // "looks like confirm" payload) and degrade rather than fall through to the
  // positional branch below.
  const hasAnySourceHeaders = targetColumns.some(
    (c) => typeof (c as DatasetConfirmColumns[number]).sourceHeader === "string",
  );
  if (hasAnySourceHeaders && !hasSourceHeaders) return { kind: "unbound" };
  if (hasSourceHeaders) {
    const byHeader = new Map(
      (targetColumns as DatasetConfirmColumns).map((c) => [c.sourceHeader, c]),
    );
    // Duplicate `sourceHeader`s collapse in the Map (last wins), which would
    // bind fewer columns than `targetColumns` claims while `appliedColumnTypes`
    // still persists the phantom duplicate. Degrade rather than emit that.
    if (byHeader.size !== targetColumns.length) return { kind: "unbound" };
    // Every confirmed column must reference a real file header (no phantom).
    // A SUBSET is allowed — headers absent from the confirmed list are the
    // columns the user excluded, and are dropped per-record below.
    const canonicalHeaders = new Set(canonical);
    const confirmedHeaders = [...byHeader.keys()];
    const everyHeaderIsReal = confirmedHeaders.every((h) => canonicalHeaders.has(h));
    if (!everyHeaderIsReal) return { kind: "unbound" };
    return { kind: "bound", byCanonical: byHeader, canonicalSet: canonicalHeaders };
  }
  if (targetColumns.length !== canonical.length) return { kind: "unbound" };
  return {
    kind: "bound",
    byCanonical: new Map(canonical.map((h, i) => [h, targetColumns[i]!])),
    canonicalSet: null,
  };
};

// Rename confirmed keys to their new names and convert their values to the
// confirmed types; drop excluded file headers; keep stray keys untouched.
// Identity when nothing was confirmed (or on a mismatch) — preserving the
// pre-v19 all-`string` pass-through. Streaming: one record at a time.
export const applyTargetBinding = (
  record: Record<string, unknown>,
  binding: TargetBinding,
): Record<string, unknown> => {
  if (binding.kind !== "bound") return record;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const target = binding.byCanonical.get(key);
    if (target) {
      // Kept column: rename + type-convert.
      out[target.name] = convertValueToColumnType(value, target.type);
      continue;
    }
    // An excluded file header is dropped; a stray key (not a file header) is kept as-is.
    if (binding.canonicalSet?.has(key)) continue;
    out[key] = value;
  }
  return out;
};

/**
 * Derive `columnTypes` from the (already reserved-renamed) headers, mirroring
 * `createDatasetFromUpload`: a column that held an inline picture is `"image"`,
 * every other one `"string"`.
 */
export const deriveColumnTypes = (
  headers: string[],
  pictureColumns: ReadonlySet<string>,
): DatasetColumns =>
  headers.map((name) => ({
    name,
    type: pictureColumns.has(name) ? ("image" as const) : ("string" as const),
  }));
