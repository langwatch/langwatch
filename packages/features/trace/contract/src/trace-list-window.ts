/**
 * How deep the flat trace list can be read by position, counted in rows from
 * the top of the current sort. A numbered-page jump lands on
 * `(page - 1) * pageSize`, and ClickHouse pays for every row it skips to get
 * there, so position reads stop at this depth. Cursor reads are keyset and
 * pay nothing for depth, so pages walked to with Next stay reachable past it.
 *
 * Shared between the service that refuses the read and the pagination bar
 * that greys the pages out, so the two always disagree about nothing.
 */
export const TRACE_LIST_MAX_OFFSET_ROWS = 100_000;
