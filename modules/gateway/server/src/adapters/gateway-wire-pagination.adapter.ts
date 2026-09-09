/**
 * Cursor pagination for Postgres-backed REST lists, matching the ClickHouse /spend-events contract: opaque cursor, limit defaulting to 50 capped at 200, next_cursor null iff exhausted. Keyset is on VALUES not Prisma's row cursor, so an archived row a caller paused on can't strand the walk.
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

/** Keyset page cursors for the wire-shaped list reads. */
export class GatewayWirePaginationAdapter {
  static create(): GatewayWirePaginationAdapter {
    return new GatewayWirePaginationAdapter();
  }

  private constructor() {}

  /** Opaque page cursor: base64url of the sort key's values. */
  encodePageCursor(values: Array<string | number>): string {
    return Buffer.from(values.join(CURSOR_SEPARATOR), "utf8").toString("base64url");
  }

  /**
   * Values a cursor names, or null if not minted here or wrong arity. Null rather than a throw, matching the spend walk — the ROUTE decides a garbled cursor is a 400, since silently restarting would re-serve everything.
   */
  decodePageCursor(encoded: string, arity: number): string[] | null {
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
   * The Prisma OR continuing a walk past `columns`: tuple comparison (a,b,c)>(x,y,z) has no Prisma spelling, so it expands to one branch per column, each pinning more-significant columns to equality. Last column unique means no row is skipped or served twice.
   */
  keysetAfter(columns: KeysetColumn[]): Array<Record<string, unknown>> {
    return columns.map((column, index) => {
      const branch: Record<string, unknown> = {};
      for (const earlier of columns.slice(0, index)) {
        branch[earlier.name] = earlier.value;
      }
      branch[column.name] =
        column.direction === "desc" ? { lt: column.value } : { gt: column.value };
      return branch;
    });
  }

  /**
   * Next-page cursor, or null when this page exhausted the walk — a page shorter than `limit` is the only honest end-of-walk signal without an extra count.
   */
  nextPageCursor<T>(
    rows: T[],
    limit: number,
    keyOf: (row: T) => Array<string | number>,
  ): string | null {
    const last = rows[rows.length - 1];
    return rows.length === limit && last ? this.encodePageCursor(keyOf(last)) : null;
  }
}
