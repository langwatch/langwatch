/**
 * Cursor pagination for the Postgres-backed REST lists.
 *
 * Same contract the ClickHouse-backed /spend-events walk publishes: an opaque
 * cursor passed back verbatim, `limit` defaulting to 50 and capped at 200, and
 * a `next_cursor` that is null exactly when the walk is exhausted. A caller
 * writes one pagination loop for the whole surface.
 *
 * The keyset is on VALUES, not on Prisma's row cursor. A row cursor has to
 * still exist to resolve, so archiving the row a caller is paused on would
 * strand the walk; comparing values does not care whether that row survived.
 */

const CURSOR_SEPARATOR = "\x00";

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;

/** One column of the sort key, most significant first. */
export interface KeysetColumn {
  name: string;
  /** The value from the last row served. */
  value: string | number | Date;
  /** The direction this column is ordered in, matching the query's orderBy. */
  direction: "asc" | "desc";
}

/** Opaque page cursor: base64url of the sort key's values. */
export function encodePageCursor(values: Array<string | number>): string {
  return Buffer.from(values.join(CURSOR_SEPARATOR), "utf8").toString("base64url");
}

/**
 * The values a cursor names, or null when it is not a cursor this surface
 * minted or does not carry the arity the caller's sort key needs.
 *
 * Null rather than a throw, matching the spend walk: the ROUTE decides that a
 * garbled cursor is a 400, because silently restarting the walk would re-serve
 * everything the caller already has.
 */
export function decodePageCursor(encoded: string, arity: number): string[] | null {
  try {
    const parts = Buffer.from(encoded, "base64url").toString("utf8").split(CURSOR_SEPARATOR);
    if (parts.length !== arity || parts.some((p) => p.length === 0)) {
      return null;
    }
    return parts;
  } catch {
    return null;
  }
}

/**
 * The Prisma `OR` that continues a walk after the row `columns` describes.
 *
 * The tuple comparison `(a, b, c) > (x, y, z)` has no Prisma spelling, so it
 * expands to one branch per column: each branch pins the more significant
 * columns to equality and compares the current one, in that column's own
 * direction. With the last column unique, the walk can neither skip a row nor
 * serve one twice.
 */
export function keysetAfter(columns: KeysetColumn[]): Array<Record<string, unknown>> {
  return columns.map((column, index) => {
    const branch: Record<string, unknown> = {};
    for (const earlier of columns.slice(0, index)) {
      branch[earlier.name] = earlier.value;
    }
    branch[column.name] = column.direction === "desc" ? { lt: column.value } : { gt: column.value };
    return branch;
  });
}

/**
 * The cursor for the next page, or null when this page exhausted the walk.
 *
 * A page shorter than `limit` means the query had nothing more to give, which
 * is the only honest end-of-walk signal available without an extra count.
 */
export function nextPageCursor<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => Array<string | number>,
): string | null {
  const last = rows[rows.length - 1];
  return rows.length === limit && last ? encodePageCursor(keyOf(last)) : null;
}
