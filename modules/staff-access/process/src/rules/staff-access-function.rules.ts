/**
 * The ops functions' pure decisions (ADR-202, amendment 2026-11-25): which functions fit which
 * scopes, the range limit, and keyset pages over a sort key with an opaque cursor.
 */
import type { StaffAccessScope } from "@langwatch/authz-contract";
import {
  isStaffAccessFunctionName,
  STAFF_ACCESS_FUNCTION_LIMITS,
  STAFF_ACCESS_FUNCTION_NAMES,
  STAFF_ACCESS_FUNCTIONS,
  StaffFunctionBadCursorError,
  StaffFunctionBadInputError,
  StaffFunctionScopeMismatchError,
  StaffFunctionUnknownError,
  type StaffAccessFunctionName,
} from "@langwatch/staff-access-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;
const cursorShape = z.object({ f: z.string(), k: z.string() });

/** `lookup` and `platform` functions need `ops:read`; `org` functions an organization scope. */
export function functionFitsScopes({
  name,
  scopes,
}: {
  name: StaffAccessFunctionName;
  scopes: readonly StaffAccessScope[];
}): boolean {
  const { scope } = STAFF_ACCESS_FUNCTIONS[name];
  if (scope === "org") return scopes.some((granted) => granted !== "ops:read");
  return scopes.includes("ops:read");
}

/**
 * The range a ranged input names, `until` defaulting to now.
 * @throws {StaffFunctionBadInputError} when it ends before it starts or spans over 31 days
 */
export function rangeOf({ since, until, at }: { since: string; until?: string; at: Instant }): {
  since: Instant;
  until: Instant;
} {
  const start = Temporal.Instant.from(since);
  const end = until === undefined ? at : Temporal.Instant.from(until);
  const spanMs = end.epochMilliseconds - start.epochMilliseconds;
  if (spanMs <= 0) throw new StaffFunctionBadInputError({ issues: ["until must be after since"] });
  if (spanMs > STAFF_ACCESS_FUNCTION_LIMITS.maxRangeDays * DAY_MS) {
    throw new StaffFunctionBadInputError({
      issues: [`the range spans at most ${STAFF_ACCESS_FUNCTION_LIMITS.maxRangeDays} days`],
    });
  }
  return { since: start, until: end };
}

export type StaffAccessPage<Item> = Readonly<{
  items: Item[];
  total: number;
  truncated: boolean;
  nextCursor: string | null;
}>;

/**
 * One page of `rows` in `keyOf` order, after the row the cursor names. The cursor is the last
 * key read, opaque to the caller; never an offset, so rows that arrive do not shift a page.
 * @throws {StaffFunctionBadCursorError} for a cursor this function did not hand out
 */
export function pageOf<Row>({
  rows,
  keyOf,
  limit,
  cursor,
  name,
}: {
  rows: readonly Row[];
  keyOf: (row: Row) => string;
  limit?: number;
  cursor?: string;
  name: string;
}): StaffAccessPage<Row> {
  const size = limit ?? STAFF_ACCESS_FUNCTION_LIMITS.defaultPageSize;
  const sorted = rows.toSorted((a, b) => compareKeys(keyOf(a), keyOf(b)));
  const after = cursor === undefined ? undefined : keyOfCursor({ cursor, name });
  const rest = after === undefined ? sorted : sorted.filter((row) => keyOf(row) > after);
  const items = rest.slice(0, size);
  const truncated = rest.length > items.length;
  const last = items.at(-1);
  return {
    items,
    total: sorted.length,
    truncated,
    nextCursor: truncated && last ? cursorOf({ key: keyOf(last), name }) : null,
  };
}

function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function cursorOf({ key, name }: { key: string; name: string }): string {
  return Buffer.from(JSON.stringify({ f: name, k: key })).toString("base64url");
}

function keyOfCursor({ cursor, name }: { cursor: string; name: string }): string {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const decoded = cursorShape.safeParse(parsed);
    if (decoded.success && decoded.data.f === name) return decoded.data.k;
  } catch {
    // An unreadable cursor is refused below like a foreign one.
  }
  throw new StaffFunctionBadCursorError();
}

/**
 * The functions a request names, sorted, each in the registry and within reach of its scopes.
 * @throws {StaffFunctionUnknownError} for a name the registry does not hold
 * @throws {StaffFunctionScopeMismatchError} for one the scopes cannot reach
 */
export function functionsFor({
  names,
  scopes,
}: {
  names: readonly string[];
  scopes: readonly StaffAccessScope[];
}): string[] {
  for (const name of names) {
    if (!isStaffAccessFunctionName(name)) {
      throw new StaffFunctionUnknownError({ names: STAFF_ACCESS_FUNCTION_NAMES, httpStatus: 422 });
    }
    if (!functionFitsScopes({ name, scopes })) throw new StaffFunctionScopeMismatchError({ name });
  }
  return names.toSorted();
}
