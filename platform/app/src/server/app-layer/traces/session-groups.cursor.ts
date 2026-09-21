/**
 * The Sessions lens page cursor: what it carries, how it travels, and how a
 * page's last row turns into the next one.
 *
 * Its own module because it is the one part of the lens read that is a wire
 * contract rather than a query: clients hold these strings across requests, so
 * every rule about what a cursor may claim lives here.
 */
import { ValidationError } from "@langwatch/handled-error";
import { z } from "zod";
import type {
  SessionGroupCursor,
  SessionGroupRow,
  SessionGroupSortColumn,
} from "./repositories/session-groups.repository";

/**
 * Every sort dimension a cursor may name, keyed by the union so the compiler
 * refuses a list that has drifted in EITHER direction. A new
 * `SessionGroupSortColumn` missing from here would make the cursor schema
 * reject a cursor this very service minted, and the caller would lose the
 * page mid-walk.
 */
const SORT_COLUMN_KEYS = {
  lastActivity: true,
  started: true,
  cost: true,
  tokens: true,
  duration: true,
  traces: true,
} as const satisfies Record<SessionGroupSortColumn, true>;

const SORT_COLUMNS = Object.keys(SORT_COLUMN_KEYS) as [
  SessionGroupSortColumn,
  ...SessionGroupSortColumn[],
];

/**
 * The decoded cursor. It carries the sort it was minted under because
 * `sortValue` is meaningless without it: the repository recomputes the keyset
 * boundary from the CURRENT sort, so a cursor from a cost sort compared
 * against a timestamp aggregate would silently page through nonsense.
 */
const sessionGroupsCursorSchema = z.object({
  sortValue: z.number().finite(),
  conversationId: z.string().min(1),
  sortColumn: z.enum(SORT_COLUMNS),
  sortDirection: z.enum(["asc", "desc"]),
});

export type SessionGroupsCursor = z.infer<typeof sessionGroupsCursorSchema>;

/**
 * Opaque session page cursor. Base64url-encoded JSON so the wire shape can
 * evolve without clients ever parsing it. Client-supplied on the way back in,
 * so the decode validates rather than asserts.
 */
export function encodeSessionGroupsCursor(cursor: SessionGroupsCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeSessionGroupsCursor(
  encoded: string,
): SessionGroupsCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid sessions cursor");
  }
  const result = sessionGroupsCursorSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError("Invalid sessions cursor");
  }
  return result.data;
}

/**
 * The repository's keyset boundary for this request. A cursor minted under
 * another sort points at a boundary the repository would compare against a
 * different aggregate expression, so a dollar amount would be measured
 * against a timestamp and the caller would walk an arbitrary window with no
 * error. Refuse it instead.
 */
export function keysetCursorFor({
  encoded,
  sortColumn,
  sortDirection,
}: {
  encoded: string | undefined;
  sortColumn: SessionGroupSortColumn;
  sortDirection: "asc" | "desc";
}): SessionGroupCursor | undefined {
  if (encoded === undefined) return undefined;
  const cursor = decodeSessionGroupsCursor(encoded);
  if (
    cursor.sortColumn !== sortColumn ||
    cursor.sortDirection !== sortDirection
  ) {
    throw new ValidationError("Sessions cursor does not match the sort");
  }
  return {
    sortValue: cursor.sortValue,
    conversationId: cursor.conversationId,
  };
}

/** Keep in lockstep with SORT_EXPRESSIONS in the ClickHouse repository. */
export function cursorSortValueForRow({
  row,
  column,
}: {
  row: SessionGroupRow;
  column: SessionGroupSortColumn;
}): number {
  switch (column) {
    case "lastActivity":
      return row.lastActivityMs;
    case "started":
      return row.startedAtMs;
    case "cost":
      return row.totalCost;
    case "tokens":
      return row.totalTokens;
    case "duration":
      return row.totalDurationMs;
    case "traces":
      return row.traceCount;
  }
}
