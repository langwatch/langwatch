/**
 * The trace filters the reader applied, as a capability of its own: analytics
 * lends it by declaration and the shell installs it beside copy targets.
 * ARCHITECTURE.md §10.1 "A capability travels by declaration".
 */

/** The filters a trace list read narrows by, without the project it reads in. */
export type UiTraceFilterReading = {
  startDate: number;
  endDate: number;
  filters: Record<string, unknown>;
  query?: string;
  negateFilters?: boolean;
};

/** The reader's applied trace filters, read from where they stand. */
export abstract class UiTraceFilters {
  /** Undefined while no filter narrows anything: a free-text query alone stays unfiltered. */
  abstract applied(): UiTraceFilterReading | undefined;
}
