import {
  GATEWAY_MAX_EPOCH_MS,
  GatewayInvalidCursorError,
  type GatewayCacheRuleCursor,
} from "@langwatch/gateway-contract";
import { Temporal, type Instant } from "@langwatch/time";

/**
 * Cursor pagination for Postgres-backed REST lists, matching the ClickHouse
 * /spend-events contract. Keyset is on VALUES, not Prisma's row cursor, so
 * an archived row a caller paused on can't strand the walk.
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
export function encodePageCursor(values: (string | number)[]): string {
  return Buffer.from(values.join(CURSOR_SEPARATOR), "utf8").toString("base64url");
}

/**
 * Values a cursor names, or null if not minted here or wrong arity. Null
 * rather than a throw, matching the spend walk — the ROUTE decides a
 * garbled cursor is a 400, since silently restarting would re-serve everything.
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
 * The Prisma OR continuing a walk past `columns`: tuple comparison
 * (a,b,c)>(x,y,z) has no Prisma spelling, so it expands to one branch per
 * column, each pinning earlier columns to equality; a unique last column means no row repeats.
 */
export function keysetAfter(columns: KeysetColumn[]): Record<string, unknown>[] {
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
 * Next-page cursor, or null when this page exhausted the walk — a page
 * shorter than `limit` is the only honest end-of-walk signal without an extra count.
 */
export function buildNextPageCursor<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => (string | number)[],
): string | null {
  const last = rows[rows.length - 1];
  return rows.length === limit && last ? encodePageCursor(keyOf(last)) : null;
}

function cursorInstant(part: string): Instant {
  const epochMs = Number(part);
  if (!Number.isFinite(epochMs) || Math.abs(epochMs) > GATEWAY_MAX_EPOCH_MS) {
    throw new GatewayInvalidCursorError();
  }
  return Temporal.Instant.fromEpochMilliseconds(epochMs);
}

/** The `(createdAt, id)` keyset a list minted, refused when this surface never issued it. */
export function decodeCreatedAtIdCursor(encoded: string): { createdAt: Instant; id: string } {
  const [createdAt, id] = decodePageCursor(encoded, 2) ?? [];
  if (createdAt === undefined || id === undefined) throw new GatewayInvalidCursorError();
  return { createdAt: cursorInstant(createdAt), id };
}

/** The `(priority, createdAt, id)` keyset the cache-rule list minted, refused otherwise. */
export function decodeCacheRuleCursor(encoded: string): GatewayCacheRuleCursor {
  const [priority, createdAt, id] = decodePageCursor(encoded, 3) ?? [];
  if (priority === undefined || createdAt === undefined || id === undefined) {
    throw new GatewayInvalidCursorError();
  }
  if (Number.isNaN(Number(priority))) throw new GatewayInvalidCursorError();
  return { priority: Number(priority), createdAt: cursorInstant(createdAt), id };
}
