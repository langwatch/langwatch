/** One project's distinct traces over a UTC window, read from the trace_summaries projection. */
export abstract class TraceUsageCountRepository {
  abstract countDistinctTraces(input: {
    tenantId: string;
    /** UTC ClickHouse DateTime64(3): `YYYY-MM-DD HH:mm:ss.SSS`, inclusive. */
    startDate: string;
    /** UTC ClickHouse DateTime64(3): `YYYY-MM-DD HH:mm:ss.SSS`, exclusive. */
    endDate: string;
  }): Promise<number>;
}
