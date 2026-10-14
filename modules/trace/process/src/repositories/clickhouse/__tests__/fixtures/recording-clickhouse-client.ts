import type { ClickHouseClient } from "@clickhouse/client";

/** One `stored_spans` query the read under test issued, and the parameters it carried. */
export interface RecordedQuery {
  query: string;
  params: unknown;
}

/**
 * Wraps a client so every `stored_spans` query the read issues is recorded. The tests assert on
 * how many reads a lookup costs and whether each one was partition-bounded (carries the
 * StartTime predicate), which is invisible from the returned rows alone.
 */
export function recordStoredSpansQueries(ch: ClickHouseClient): {
  client: ClickHouseClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = new Proxy(ch, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return (args: { query: string; query_params?: unknown }) => {
          if (args.query.includes("stored_spans")) {
            queries.push({ query: args.query, params: args.query_params });
          }

          return (target as ClickHouseClient).query(args as never);
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  }) as ClickHouseClient;

  return { client, queries };
}
