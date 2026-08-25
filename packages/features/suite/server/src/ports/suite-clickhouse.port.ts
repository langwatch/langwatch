export type SuiteClickHouseQueryResult = {
	json<T>(): Promise<T[]>;
};

/** The narrow ClickHouse capability required by Suite run projections. */
export type SuiteClickHouseClient = {
	query(input: {
		query: string;
		query_params: Record<string, unknown>;
		format: "JSONEachRow";
	}): Promise<SuiteClickHouseQueryResult>;
	insert(input: {
		table: string;
		values: unknown[];
		format: "JSONEachRow";
		clickhouse_settings?: {
			async_insert?: 0 | 1;
			wait_for_async_insert?: 0 | 1;
		};
	}): Promise<unknown>;
};
