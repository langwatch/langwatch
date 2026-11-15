import type { ProofScope, ReaderReadStatement } from "@langwatch/clickhouse-client/builder";

import type { FilterOption } from "../filter-options.repository.ts";
import type { AnalyticsFilterInput } from "./clickhouse.filter-conditions.mapper.ts";

export type ClickHouseFilterQueryParams = {
  query?: string;
  key?: string;
  subkey?: string;
  startDate: number;
  endDate: number;
  /** The other filters the picker is narrowed by, in analytics' own grammar (ADR-202 D26). */
  filters?: AnalyticsFilterInput;
  /**
   * The proof reads an aggregate's members, so an evaluation is offered only when its trace is
   * inside the member's window, not when it ran (ADR-177 v4.15).
   */
  readsMembers?: boolean;
};

/** A picker's parameters and the route proof's scope its read is built under. */
export type FilterOptionsReadInput = ClickHouseFilterQueryParams & { scope: ProofScope };

/**
 * ClickHouse tables that support filter queries.
 */
type ClickHouseFilterTable = "trace_summaries" | "stored_spans" | "evaluation_runs";

export type ClickHouseFilterDefinition = {
  /**
   * The ClickHouse table to query. If null, this filter is not supported in ClickHouse.
   */
  tableName: ClickHouseFilterTable | null;
  /**
   * Build the read for this filter. Returns null when the filter cannot be queried yet (e.g. a
   * required key/subkey is missing) — callers resolve that to an empty option list without
   * hitting ClickHouse.
   */
  buildQuery: (input: FilterOptionsReadInput) => ReaderReadStatement | null;
  /**
   * Extract filter options from the query result rows.
   */
  extractResults: (rows: unknown[]) => FilterOption[];
};

/**
 * A filter definition that is known to be supported in ClickHouse (non-null tableName).
 */
export type SupportedClickHouseFilterDefinition = ClickHouseFilterDefinition & {
  tableName: ClickHouseFilterTable;
};
