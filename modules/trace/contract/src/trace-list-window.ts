/**
 * Position-based reads are limited by depth (ClickHouse charges for skipped rows),
 * but keyset cursor reads pay nothing. Shared so service and pagination UI agree.
 */
export const TRACE_LIST_MAX_OFFSET_ROWS = 100_000;
